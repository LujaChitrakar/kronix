use crate::states::{
    AnyNode, BookSideIter, BookSideIterItem, LeafNode, NodeHandle, NodeRef, OrderTreeNodes,
    OrderTreeRoot, OrderTreeType, Side,
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
// const _: () = assert!(size_of::<BookSide>() == 90944);
const _: () = assert!(size_of::<BookSide>() % 8 == 0);

impl BookSide {
    pub const LEN: usize = size_of::<BookSide>();

    pub fn init(&mut self, tree_type: OrderTreeType) {
        self.roots.maybe_node = 0;
        self.roots.leaf_count = 0;
        self.nodes.order_tree_type = tree_type as u8;
        self.nodes.bump_index = 0;
        self.nodes.free_list_len = 0;
        self.nodes.free_list_head = 0;
    }

    // Iterate over all entries in the book filtering out the invalid orders
    // smallest to hightest for ask
    // highest to smallest for bid
    pub fn iter_valid(&self, now_ts: u64) -> impl Iterator<Item = BookSideIterItem<'_>> {
        BookSideIter::new(self, now_ts).filter(|item| item.is_valid())
    }

    // iter all including invalid orders
    pub fn iter_all_including_invalid(&self, now_ts: u64) -> BookSideIter<'_> {
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
    pub fn node_by_key(&self, search_key: u128) -> Option<&LeafNode> {
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
                        return Some(leaf);
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
    pub fn remove_worst(&mut self) -> Option<(LeafNode, i64)> {
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

#[cfg(test)]
mod tests {
    use crate::{
        constants::MAX_ORDERTREE_NODES,
        states::{fixed_price_data, new_node_key, OrderTreeType},
    };

    use super::*;

    fn make_bookside(order_tree_type: OrderTreeType) -> BookSide {
        let mut bs = BookSide::zeroed();
        bs.nodes.order_tree_type = order_tree_type.into();
        bs
    }

    fn make_bid_leaf(price_lots: i64, seq_num: u64, quantity: i64) -> LeafNode {
        let price_data = fixed_price_data(price_lots).unwrap();
        let key = new_node_key(Side::Bid, price_data, seq_num);

        LeafNode::new(0, 0, seq_num, quantity, 1000, key, [0u8; 32])
    }

    fn make_ask_leaf(price_lots: i64, seq_num: u64, quantity: i64) -> LeafNode {
        let price_data = fixed_price_data(price_lots).unwrap();
        let key = new_node_key(Side::Ask, price_data, seq_num);

        LeafNode::new(0, 0, seq_num, quantity, 1000, key, [0u8; 32])
    }

    fn make_expiring_bid_leaf(price_lots: i64, seq_num: u64, timestamp: u64, tif: u16) -> LeafNode {
        let price_data = fixed_price_data(price_lots).unwrap();
        let key = new_node_key(Side::Bid, price_data, seq_num);

        LeafNode::new(0, tif, seq_num, 0, timestamp, key, [0u8; 32])
    }

    #[test]
    fn insert_and_is_empty() {
        let mut bids = make_bookside(OrderTreeType::Bids);
        assert!(bids.is_empty());

        bids.insert_leaf(&make_bid_leaf(100, 1, 10)).unwrap();
        assert!(!bids.is_empty());
    }

    #[test]
    fn insert_and_remove_by_key() {
        let mut bids = make_bookside(OrderTreeType::Bids);
        let leaf = make_bid_leaf(100, 1, 5);
        let key = u128::from_le_bytes(leaf.key);

        bids.insert_leaf(&leaf).unwrap();
        assert_eq!(bids.roots.leaf_count, 1);

        let removed = bids.remove_by_key(key);
        assert!(removed.is_some());
        assert_eq!(bids.roots.leaf_count, 0);
        assert!(bids.is_empty());
    }

    #[test]
    fn remove_nonexistent_returns_none() {
        let mut bids = make_bookside(OrderTreeType::Bids);
        bids.insert_leaf(&make_bid_leaf(100, 1, 5)).unwrap();
        assert!(bids.remove_by_key(9999).is_none());
    }

    #[test]
    fn bids_iterate_descending_price() {
        let mut bids = make_bookside(OrderTreeType::Bids);

        bids.insert_leaf(&make_bid_leaf(100, 1, 5)).unwrap();
        bids.insert_leaf(&make_bid_leaf(200, 2, 5)).unwrap();
        bids.insert_leaf(&make_bid_leaf(150, 3, 5)).unwrap();

        let prices: Vec<i64> = bids.iter_valid(0).map(|item| item.price_lots).collect();

        // Best bid first — highest price
        assert_eq!(prices, vec![200, 150, 100]);
    }

    #[test]
    fn asks_iterate_ascending_price() {
        let mut asks = make_bookside(OrderTreeType::Asks);

        asks.insert_leaf(&make_ask_leaf(300, 1, 5)).unwrap();
        asks.insert_leaf(&make_ask_leaf(100, 2, 5)).unwrap();
        asks.insert_leaf(&make_ask_leaf(200, 3, 5)).unwrap();

        let prices: Vec<i64> = asks.iter_valid(0).map(|item| item.price_lots).collect();

        // Best ask first — lowest price
        assert_eq!(prices, vec![100, 200, 300]);
    }

    #[test]
    fn same_price_fifo_order() {
        let mut bids = make_bookside(OrderTreeType::Bids);

        // Same price, different seq_nums — earlier placed first
        bids.insert_leaf(&make_bid_leaf(100, 3, 5)).unwrap();
        bids.insert_leaf(&make_bid_leaf(100, 1, 5)).unwrap();
        bids.insert_leaf(&make_bid_leaf(100, 2, 5)).unwrap();

        let seq_nums: Vec<u64> = bids
            .iter_valid(0)
            .map(|item| item.node.client_order_id) // using client_id as seq proxy
            .collect();

        // seq_num 1 placed first → matched first
        assert_eq!(seq_nums, vec![1, 2, 3]);
    }

    #[test]
    fn best_price_empty_book() {
        let bids = make_bookside(OrderTreeType::Bids);
        assert!(bids.best_price(0).is_none());
    }

    #[test]
    fn best_bid_price() {
        let mut bids = make_bookside(OrderTreeType::Bids);
        bids.insert_leaf(&make_bid_leaf(100, 1, 5)).unwrap();
        bids.insert_leaf(&make_bid_leaf(200, 2, 5)).unwrap();
        bids.insert_leaf(&make_bid_leaf(150, 3, 5)).unwrap();

        assert_eq!(bids.best_price(0), Some(200));
    }

    #[test]
    fn best_ask_price() {
        let mut asks = make_bookside(OrderTreeType::Asks);
        asks.insert_leaf(&make_ask_leaf(300, 1, 5)).unwrap();
        asks.insert_leaf(&make_ask_leaf(100, 2, 5)).unwrap();
        asks.insert_leaf(&make_ask_leaf(200, 3, 5)).unwrap();

        assert_eq!(asks.best_price(0), Some(100));
    }

    #[test]
    fn expired_orders_filtered_by_iter_valid() {
        let mut bids = make_bookside(OrderTreeType::Bids);

        // GTC order — never expires
        bids.insert_leaf(&make_bid_leaf(100, 1, 5)).unwrap();
        // TIF order — expires at ts 1005 (timestamp=1000, tif=5)
        bids.insert_leaf(&make_expiring_bid_leaf(200, 2, 1000, 5))
            .unwrap();

        // Before expiry — both visible
        let valid_before: Vec<i64> = bids.iter_valid(1004).map(|i| i.price_lots).collect();
        assert_eq!(valid_before, vec![200, 100]);

        // After expiry — only GTC visible
        let valid_after: Vec<i64> = bids.iter_valid(1005).map(|i| i.price_lots).collect();
        assert_eq!(valid_after, vec![100]);
    }

    #[test]
    fn iter_all_including_invalid_returns_expired() {
        let mut bids = make_bookside(OrderTreeType::Bids);
        bids.insert_leaf(&make_expiring_bid_leaf(100, 1, 1000, 5))
            .unwrap();

        // Expired but still in tree
        let all: Vec<_> = bids.iter_all_including_invalid(9999).collect();
        assert_eq!(all.len(), 1);
        assert!(!all[0].is_valid());
    }

    #[test]
    fn remove_one_expired() {
        let mut bids = make_bookside(OrderTreeType::Bids);

        bids.insert_leaf(&make_bid_leaf(100, 1, 5)).unwrap(); // GTC
        bids.insert_leaf(&make_expiring_bid_leaf(200, 2, 1000, 5))
            .unwrap(); // expires at 1005

        // Before expiry — nothing removed
        assert!(bids.remove_one_expired(1004).is_none());
        assert_eq!(bids.roots.leaf_count, 2);

        // At expiry — removes expired order
        let removed = bids.remove_one_expired(1005);
        assert!(removed.is_some());
        assert_eq!(bids.roots.leaf_count, 1);

        // GTC order still there
        assert_eq!(bids.best_price(9999), Some(100));
    }

    #[test]
    fn remove_worst_bid_removes_lowest_price() {
        let mut bids = make_bookside(OrderTreeType::Bids);
        bids.insert_leaf(&make_bid_leaf(100, 1, 5)).unwrap();
        bids.insert_leaf(&make_bid_leaf(200, 2, 5)).unwrap();
        bids.insert_leaf(&make_bid_leaf(150, 3, 5)).unwrap();

        let (_, worst_price) = bids.remove_worst().unwrap();
        assert_eq!(worst_price, 100);
        assert_eq!(bids.roots.leaf_count, 2);
    }

    #[test]
    fn remove_worst_ask_removes_highest_price() {
        let mut asks = make_bookside(OrderTreeType::Asks);
        asks.insert_leaf(&make_ask_leaf(100, 1, 5)).unwrap();
        asks.insert_leaf(&make_ask_leaf(300, 2, 5)).unwrap();
        asks.insert_leaf(&make_ask_leaf(200, 3, 5)).unwrap();

        let (_, worst_price) = asks.remove_worst().unwrap();
        assert_eq!(worst_price, 300);
        assert_eq!(asks.roots.leaf_count, 2);
    }

    #[test]
    fn remove_worst_empty_returns_none() {
        let mut bids = make_bookside(OrderTreeType::Bids);
        assert!(bids.remove_worst().is_none());
    }

    #[test]
    fn quantity_at_price_bids() {
        let mut bids = make_bookside(OrderTreeType::Bids);
        bids.insert_leaf(&make_bid_leaf(200, 1, 10)).unwrap();
        bids.insert_leaf(&make_bid_leaf(150, 2, 20)).unwrap();
        bids.insert_leaf(&make_bid_leaf(100, 3, 30)).unwrap();

        // Quantity available at price >= 150
        assert_eq!(bids.quantity_at_price(150, 0), 30); // 200 + 150 levels
                                                        // Quantity available at price >= 200
        assert_eq!(bids.quantity_at_price(200, 0), 10);
    }

    #[test]
    fn impact_price_asks() {
        let mut asks = make_bookside(OrderTreeType::Asks);
        asks.insert_leaf(&make_ask_leaf(100, 1, 10)).unwrap();
        asks.insert_leaf(&make_ask_leaf(200, 2, 20)).unwrap();
        asks.insert_leaf(&make_ask_leaf(300, 3, 30)).unwrap();

        // Price to fill 10 lots
        assert_eq!(asks.impact_price(10, 0), Some(100));
        // Price to fill 30 lots
        assert_eq!(asks.impact_price(30, 0), Some(200));
        // Price to fill 61 lots — not enough liquidity
        assert_eq!(asks.impact_price(61, 0), None);
    }

    #[test]
    fn is_full_after_max_inserts() {
        let mut asks = make_bookside(OrderTreeType::Asks);

        for i in 0..MAX_ORDERTREE_NODES as i64 {
            if asks.is_full() {
                break;
            }
            asks.insert_leaf(&make_ask_leaf(i + 1, i as u64, 1))
                .unwrap();
        }
        assert!(asks.is_full());
    }

    #[test]
    fn random_bids_always_descending() {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let mut bids = make_bookside(OrderTreeType::Bids);

        let mut keys = std::collections::HashSet::new();
        for _ in 0..50 {
            let price: i64 = rng.gen_range(1..1000);
            let seq: u64 = rng.gen_range(0..10000);
            let leaf = make_bid_leaf(price, seq, 1);
            let key = u128::from_le_bytes(leaf.key);
            if keys.contains(&key) {
                continue;
            }
            keys.insert(key);
            bids.insert_leaf(&leaf).unwrap();
        }

        let mut last_price = i64::MAX;
        for item in bids.iter_valid(0) {
            assert!(
                item.price_lots <= last_price,
                "bids not descending: {} > {}",
                item.price_lots,
                last_price
            );
            last_price = item.price_lots;
        }
    }

    #[test]
    fn random_asks_always_ascending() {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let mut asks = make_bookside(OrderTreeType::Asks);

        let mut keys = std::collections::HashSet::new();
        for _ in 0..50 {
            let price: i64 = rng.gen_range(1..1000);
            let seq: u64 = rng.gen_range(0..10000);
            let leaf = make_ask_leaf(price, seq, 1);
            let key = u128::from_le_bytes(leaf.key);
            if keys.contains(&key) {
                continue;
            }
            keys.insert(key);
            asks.insert_leaf(&leaf).unwrap();
        }

        let mut last_price = 0_i64;
        for item in asks.iter_valid(0) {
            assert!(
                item.price_lots >= last_price,
                "asks not ascending: {} < {}",
                item.price_lots,
                last_price
            );
            last_price = item.price_lots;
        }
    }
}
