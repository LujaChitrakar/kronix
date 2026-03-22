use crate::states::{
    AnyNode, BookSideIter, BookSideIterItem, LeafNode, NodeHandle, NodeRef, OrderTreeNodes,
    OrderTreeRoot, Side,
};
use bytemuck::{Pod, Zeroable};
use pinocchio::error::ProgramError;

#[derive(PartialEq, Eq, Clone, Copy)]
#[repr(u8)]
pub enum BookSideOrderTree {
    Fixed = 0,
    // OraclePegged = 1,
}

// ref to node in bookside
pub struct BookSideOrderHandle {
    pub node: NodeHandle,
    pub order_tree: BookSideOrderTree,
}

#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct BookSide {
    pub roots: OrderTreeRoot,
    pub reserved_roots: [OrderTreeRoot; 5],
    pub reserved: [u8; 256],
    pub nodes: OrderTreeNodes,
}
const _: () = assert!(
    size_of::<BookSide>() == size_of::<OrderTreeNodes>() + 6 * size_of::<OrderTreeRoot>() + 256
);
const _: () = assert!(size_of::<BookSide>() == 90944);
const _: () = assert!(size_of::<BookSide>() % 8 == 0);

impl BookSide {
    // Iterate over all entries in the book filtering out the invalid orders
    // smallest to hightest for ask
    // highest to smallest for bid
    pub fn iter_valid(&self, now_ts: u64) -> impl Iterator<Item = BookSideIterItem> {
        BookSideIter::new(self, now_ts).filter(|item| item.is_valid())
    }

    // iter all including invalid orders
    pub fn iter_all_including_invalid(&self, now_ts: u64) -> BookSideIter {
        BookSideIter::new(self, now_ts)
    }

    pub fn node(&self, handle: NodeHandle) -> Option<&AnyNode> {
        self.nodes.node(handle)
    }

    pub fn node_mut(&mut self, handle: NodeHandle) -> Option<&mut AnyNode> {
        self.nodes.node_mut(handle)
    }

    pub fn node_mut_by_key(&mut self, search_key: u128) -> Option<&mut LeafNode> {
        let mut node_handle = self.roots.node()?;

        loop {
            let node = self.nodes.node(node_handle)?;
            match node.case()? {
                NodeRef::Inner(inner) => {
                    let (child, _) = inner.walk_down(search_key);
                    node_handle = child;
                }
                NodeRef::Leaf(leaf) => {
                    if u128::from_le_bytes(leaf.key) == search_key {
                        // Found — return mutable reference
                        return self.nodes.node_mut(node_handle)?.as_leaf_mut();
                    } else {
                        return None;
                    }
                }
            }
        }
    }

    pub fn root(&self) -> &OrderTreeRoot {
        &self.roots
    }

    pub fn root_mut(&mut self) -> &mut OrderTreeRoot {
        &mut self.roots
    }

    pub fn is_full(&self) -> bool {
        self.nodes.is_full()
    }

    pub fn is_empty(&self) -> bool {
        self.roots.leaf_count == 0
    }

    pub fn insert_leaf(
        &mut self,
        new_leaf: &LeafNode,
    ) -> Result<(NodeHandle, Option<LeafNode>), ProgramError> {
        let root = &mut self.roots;
        self.nodes.insert_leaf(root, new_leaf)
    }

    // Remove the overall worst-price order.
    pub fn remove_worst(&mut self, now_ts: u64) -> Option<(LeafNode, i64)> {
        let side = self.nodes.order_tree_type().side();

        let (_, worst_leaf) = self.nodes.find_worst(&self.roots)?;

        // For bids: worst = lowest price = min_leaf
        // For asks: worst = highest price = max_leaf
        // find_worst already handles this via OrderTreeType
        let price = worst_leaf.price_data() as i64;

        let key = u128::from_le_bytes(worst_leaf.key);
        let n = self.remove_by_key(key)?;
        Some((n, price))
    }

    // Remove the order with the lowest expiry timestamp in the component, if that's < now_ts.
    /// If there is none, try to remove the lowest expiry one from the other component.
    pub fn remove_one_expired(&mut self, now_ts: u64) -> Option<LeafNode> {
        let root = &mut self.roots;
        self.nodes.remove_one_expired(root, now_ts)
    }

    pub fn remove_by_key(&mut self, search_key: u128) -> Option<LeafNode> {
        let root = &mut self.roots;
        self.nodes.remove_by_key(root, search_key)
    }

    pub fn side(&self) -> Side {
        self.nodes.order_tree_type().side()
    }

    /// Return the price of the order closest to the spread
    pub fn best_price(&self, now_ts: u64) -> Option<i64> {
        Some(self.iter_valid(now_ts).next()?.price_lots)
    }

    pub fn quantity_at_price(&self, limit_price_lots: i64, now_ts: u64) -> i64 {
        let side = self.side();
        let mut sum = 0_i64;
        for item in self.iter_valid(now_ts) {
            if side.is_price_better(limit_price_lots, item.price_lots) {
                break;
            }
            sum += item.node.quantity;
        }
        sum
    }

    /// Walk up the book `quantity` units and return the price at that level. If `quantity` units
    /// not on book, return None
    pub fn impact_price(&self, quantity: i64, now_ts: u64) -> Option<i64> {
        let mut sum: i64 = 0;
        for order in self.iter_valid(now_ts) {
            sum += order.node.quantity;
            if sum >= quantity {
                return Some(order.price_lots);
            }
        }
        None
    }
}
