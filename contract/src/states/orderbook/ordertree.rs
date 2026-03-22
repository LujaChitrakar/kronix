use bytemuck::{
    Pod, Zeroable,
    checked::{cast, cast_mut, cast_ref},
};
use num_enum::{IntoPrimitive, TryFromPrimitive};
use pinocchio::error::ProgramError;

use crate::{
    constants::MAX_ORDERTREE_NODES,
    states::{
        AnyNode, FreeNode, InnerNode, LeafNode, NodeHandle, NodeRef, NodeTag, OrderTreeIter, Side,
    },
};

#[derive(PartialEq, Eq, Copy, Clone, Debug, TryFromPrimitive, IntoPrimitive)]
#[repr(u8)]
pub enum OrderTreeType {
    Bids,
    Asks,
}

impl OrderTreeType {
    pub fn side(&self) -> Side {
        match *self {
            Self::Bids => Side::Bid,
            Self::Asks => Side::Ask,
        }
    }
}

#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct OrderTreeRoot {
    pub maybe_node: NodeHandle,
    pub leaf_count: u32,
}
const _: () = assert!(size_of::<OrderTreeRoot>() == 8);
const _: () = assert!(size_of::<OrderTreeRoot>() % 8 == 0);

impl OrderTreeRoot {
    pub fn node(&self) -> Option<NodeHandle> {
        if self.leaf_count == 0 {
            None
        } else {
            Some(self.maybe_node)
        }
    }
}

// a binary tree on AnyNode::key()
#[derive(Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct OrderTreeNodes {
    pub order_tree_type: u8,
    pub padding: [u8; 3],
    pub bump_index: u32,
    pub free_list_len: u32,
    pub free_list_head: NodeHandle,
    pub reserved: [u8; 512],
    pub nodes: [AnyNode; MAX_ORDERTREE_NODES],
}
const _: () = assert!(size_of::<OrderTreeNodes>() == 1 + 3 + 4 + 4 + 4 + 512 + 88 * 1024);
const _: () = assert!(size_of::<OrderTreeNodes>() % 8 == 0);

impl OrderTreeNodes {
    pub fn order_tree_type(&self) -> OrderTreeType {
        OrderTreeType::try_from(self.order_tree_type).unwrap()
    }

    pub fn node(&self, handle: NodeHandle) -> Option<&AnyNode> {
        let node = &self.nodes[handle as usize];
        let tag = NodeTag::try_from(node.tag);
        match tag {
            Ok(NodeTag::InnerNode) | Ok(NodeTag::LeafNode) => Some(node),
            _ => None,
        }
    }

    pub fn node_mut(&mut self, handle: NodeHandle) -> Option<&mut AnyNode> {
        let node = &mut self.nodes[handle as usize];
        let tag = NodeTag::try_from(node.tag);
        match tag {
            Ok(NodeTag::InnerNode) | Ok(NodeTag::LeafNode) => Some(node),
            _ => None,
        }
    }

    // iter over all entries including invalid orders
    // Smallest to highest for bid
    // Highest to smallest for ask
    pub fn iter(&self, root: &OrderTreeRoot) -> OrderTreeIter {
        OrderTreeIter::new(self, root)
    }

    pub fn remove_by_key(
        &mut self,
        root: &mut OrderTreeRoot,
        search_key: u128,
    ) -> Option<LeafNode> {
        // path of InnerNode handles that lead to the removed leaf
        let mut stack: Vec<(NodeHandle, bool)> = vec![];

        // special case potential to remove the root
        let mut parent_h = root.node()?;
        let (mut child_h, mut crit_bit) = match self.node(parent_h).unwrap().case().unwrap() {
            NodeRef::Leaf(&leaf) if u128::from_le_bytes(leaf.key) == search_key => {
                assert!(root.leaf_count == 1);
                root.maybe_node = 0;
                root.leaf_count = 0;
                let _old_root = self.remove(parent_h).unwrap();
                return Some(leaf);
            }
            NodeRef::Inner(inner) => inner.walk_down(search_key),
            NodeRef::Leaf(_) => return None,
        };
        stack.push((parent_h, crit_bit));

        loop {
            match self.node(child_h).unwrap().case().unwrap() {
                NodeRef::Inner(inner) => {
                    parent_h = child_h;
                    let (new_child_h, new_critbit) = inner.walk_down(search_key);
                    child_h = new_child_h;
                    crit_bit = new_critbit;
                    stack.push((parent_h, crit_bit));
                }
                NodeRef::Leaf(leaf) => {
                    if u128::from_le_bytes(leaf.key) != search_key {
                        return None;
                    }
                    break;
                }
            }
        }

        // replace the parent with its remaining child
        // free child_h and replace parent_h with other_child_h
        let other_child_h = self.node(parent_h).unwrap().children().unwrap()[!crit_bit as usize];
        let other_child_node_contents = self.remove(other_child_h).unwrap();
        let new_expiry = other_child_node_contents.earliest_expiry();
        *self.node_mut(parent_h).unwrap() = other_child_node_contents;
        root.leaf_count=root.leaf_count
            .checked_sub(1)
            .ok_or(ProgramError::ArithmeticOverflow)
            .unwrap();
        let removed_leaf: LeafNode = cast(self.remove(child_h).unwrap());

        let outdated_expiry = removed_leaf.expiry();
        stack.pop();
        self.update_parent_earliest_expiry(&stack, outdated_expiry, new_expiry);
        Some(removed_leaf)
    }

    // removes only the node at the given key, not the order it contains
    fn remove(&mut self, key: NodeHandle) -> Option<AnyNode> {
        let val = *self.node(key)?;

        let tag = if self.free_list_len == 0 {
            NodeTag::LastFreeNode.into()
        } else {
            NodeTag::FreeNode.into()
        };
        self.nodes[key as usize] = cast(FreeNode {
            tag,
            padding: [0; 3],
            next: self.free_list_head,
            force_align: 0,
            reserved: [0; 72],
        });
        self.free_list_len = self
            .free_list_len
            .checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)
            .unwrap();
        self.free_list_head = key;
        Some(val)
    }

    pub fn remove_one_expired(
        &mut self,
        root: &mut OrderTreeRoot,
        now_ts: u64,
    ) -> Option<LeafNode> {
        let (handle, expires_at) = self.find_earliest_expiry(root)?;
        if expires_at <= now_ts {
            self.remove_by_key(root, self.node(handle)?.key()?)
        } else {
            None
        }
    }

    pub fn remove_worst(&mut self, root: &mut OrderTreeRoot) -> Option<LeafNode> {
        let search_key = u128::from_le_bytes(self.find_worst(root)?.1.key);
        self.remove_by_key(root, search_key)
    }

    pub fn find_worst(&self, root: &OrderTreeRoot) -> Option<(NodeHandle, &LeafNode)> {
        match self.order_tree_type() {
            OrderTreeType::Bids => self.min_leaf(root),
            OrderTreeType::Asks => self.max_leaf(root),
        }
    }

    pub fn min_leaf(&self, root: &OrderTreeRoot) -> Option<(NodeHandle, &LeafNode)> {
        self.leaf_min_max(false, root)
    }
    pub fn max_leaf(&self, root: &OrderTreeRoot) -> Option<(NodeHandle, &LeafNode)> {
        self.leaf_min_max(true, root)
    }

    pub fn leaf_min_max(
        &self,
        find_max: bool,
        root: &OrderTreeRoot,
    ) -> Option<(NodeHandle, &LeafNode)> {
        let mut node_handle: NodeHandle = root.node()?;

        let i = usize::from(find_max);
        loop {
            let node_contents = self.node(node_handle)?;
            match node_contents.case()? {
                NodeRef::Inner(inner) => {
                    node_handle = inner.children[i];
                }
                NodeRef::Leaf(leaf) => {
                    return Some((node_handle, leaf));
                }
            }
        }
    }

    // INSERT
    // Internal only add the node does not add the parent links
    fn insert(&mut self, val: &AnyNode) -> Result<NodeHandle, ProgramError> {
        match NodeTag::try_from(val.tag) {
            Ok(NodeTag::InnerNode) | Ok(NodeTag::LeafNode) => (),
            _ => unreachable!(),
        }

        if self.free_list_len == 0 {
            if (self.bump_index as usize) > self.nodes.len() && self.bump_index > u32::MAX {
                return Err(ProgramError::InvalidAccountData);
            }
            self.nodes[self.bump_index as usize] = *val;
            let key = self.bump_index;
            self.bump_index = self
                .bump_index
                .checked_add(1)
                .ok_or(ProgramError::ArithmeticOverflow)
                .unwrap();
            return Ok(key);
        }
        let key = self.free_list_head;
        let node = &mut self.nodes[key as usize];

        match NodeTag::try_from(node.tag) {
            Ok(NodeTag::FreeNode) => assert!(self.free_list_len > 1),
            Ok(NodeTag::LastFreeNode) => assert!(self.free_list_len == 1),
            _ => unreachable!(),
        }
        self.free_list_head = cast_ref::<AnyNode, FreeNode>(node).next;
        self.free_list_len = self
            .free_list_len
            .checked_sub(1)
            .ok_or(ProgramError::ArithmeticOverflow)
            .unwrap();
        *node = *val;
        Ok(key)
    }

    // insert_leaf
    pub fn insert_leaf(
        &mut self,
        root: &mut OrderTreeRoot,
        new_leaf: &LeafNode,
    ) -> Result<(NodeHandle, Option<LeafNode>), ProgramError> {
        // path of inner leaf handles that lead to new leaf
        let mut stack: Vec<(NodeHandle, bool)> = vec![];

        let mut parent_handle: NodeHandle = match root.node() {
            Some(h) => h,
            None => {
                // Create a new node if none exists
                let handle = self.insert(new_leaf.as_ref())?;
                root.maybe_node = handle;
                root.leaf_count = 1;
                return Ok((handle, None));
            }
        };

        // Walk down the tree to find the leaf node to insert into
        loop {
            // required if the new node will be child of the root
            let parent_contents = *self.node(parent_handle).unwrap();
            let parent_key = parent_contents.key().unwrap();
            let new_leaf_key = u128::from_le_bytes(new_leaf.key);
            if parent_key == new_leaf_key {
                // Should never happen as keys should be unique
                if let Some(NodeRef::Leaf(&old_parent_as_leaf)) = parent_contents.case() {
                    // clobber the existing leaf
                    *self.node_mut(parent_handle).unwrap() = *new_leaf.as_ref();
                    self.update_parent_earliest_expiry(
                        &stack,
                        old_parent_as_leaf.expiry(),
                        new_leaf.expiry(),
                    );
                    return Ok((parent_handle, Some(old_parent_as_leaf)));
                }
            }
            let shared_prefix_len: u32 = (parent_key ^ new_leaf_key).leading_zeros();
            match parent_contents.case() {
                None => unreachable!(),
                Some(NodeRef::Inner(inner)) => {
                    let keep_old_parent = shared_prefix_len >= inner.prefix_len;
                    if keep_old_parent {
                        let (child, crit_bit) = inner.walk_down(new_leaf_key);
                        stack.push((parent_handle, crit_bit));
                        parent_handle = child;
                        continue;
                    }
                }
                _ => (),
            };
            // implies parent is a leaf or inner with prefix_len>shared_prefix_len
            // We will replace parent with a new inner node
            //
            // Change the parent with a new InnerNode that has new_leaf and parent as children

            let crit_bit_mask: u128 = 1u128 << (127 - shared_prefix_len);
            let new_leaf_crit_bit = (crit_bit_mask & new_leaf_key) != 0;
            let old_parent_crit_bit = !new_leaf_crit_bit;

            let new_leaf_handle = self.insert(new_leaf.as_ref())?;
            let moved_parent_handle = match self.insert(&parent_contents) {
                Ok(h) => h,
                Err(e) => {
                    self.remove(new_leaf_handle).unwrap();
                    return Err(e);
                }
            };

            let new_parent: &mut InnerNode = cast_mut(self.node_mut(parent_handle).unwrap());
            *new_parent = InnerNode::new(shared_prefix_len, new_leaf_key);

            new_parent.children[new_leaf_crit_bit as usize] = new_leaf_handle;
            new_parent.children[old_parent_crit_bit as usize] = moved_parent_handle;

            let new_leaf_expiry = new_leaf.expiry();
            let old_parent_expiry = parent_contents.earliest_expiry();
            new_parent.child_earliest_expiry[new_leaf_crit_bit as usize] = new_leaf_expiry;
            new_parent.child_earliest_expiry[old_parent_crit_bit as usize] = old_parent_expiry;

            if new_leaf_expiry < old_parent_expiry {
                self.update_parent_earliest_expiry(&stack, old_parent_expiry, new_leaf_expiry);
            }

            root.leaf_count = root
                .leaf_count
                .checked_add(1)
                .ok_or(ProgramError::ArithmeticOverflow)
                .unwrap();
            return Ok((new_leaf_handle, None));
        }
    }

    pub fn is_full(&self) -> bool {
        self.free_list_len <= 1 && (self.bump_index as usize) >= self.nodes.len() - 1
    }

    // when node changes the parents child_earliest_expiry may need to be updated
    // This walks up to the stack of parents and udpates the prevsious child's outdated expiry
    pub fn update_parent_earliest_expiry(
        &mut self,
        stack: &[(NodeHandle, bool)],
        mut outdated_expiry: u64,
        mut new_expiry: u64,
    ) {
        // Walk from top of stack to the root of the tree
        // As stack grows by appending, iterate the slice in reverse order
        for (parent_h, crit_bit) in stack.iter().rev() {
            let parent = self.node_mut(*parent_h).unwrap().as_inner_mut().unwrap();
            if parent.child_earliest_expiry[*crit_bit as usize] != outdated_expiry {
                break;
            }
            outdated_expiry = parent.earliest_expiry();
            parent.child_earliest_expiry[*crit_bit as usize] = new_expiry;
            new_expiry = parent.earliest_expiry();
        }
    }

    // return the handle of the node with the lowest expiry timestamp
    pub fn find_earliest_expiry(&self, root: &OrderTreeRoot) -> Option<(NodeHandle, u64)> {
        let mut current: NodeHandle = match root.node() {
            Some(h) => h,
            None => return None,
        };

        loop {
            let contents = *self.node(current).unwrap();
            match contents.case() {
                Some(NodeRef::Inner(inner)) => {
                    current = inner.children[(inner.child_earliest_expiry[0]
                        > inner.child_earliest_expiry[1])
                        as usize];
                }
                None => unreachable!(),
                _ => {
                    return Some((current, contents.earliest_expiry()));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    mod tests {
        use crate::{constants::MAX_ORDERTREE_NODES, states::{LeafNode, NodeHandle, NodeRef, OrderTreeNodes, OrderTreeRoot, OrderTreeType, Side, fixed_price_data, new_node_key}};
        use bytemuck::Zeroable;

        fn new_order_tree(order_tree_type: OrderTreeType) -> OrderTreeNodes {
            let mut ot = OrderTreeNodes::zeroed();
            ot.order_tree_type = order_tree_type.into();
            ot
        }

        fn verify_order_tree(order_tree: &OrderTreeNodes, root: &OrderTreeRoot) {
            verify_tree_invariant(order_tree, root);
            verify_tree_iteration(order_tree, root);
            verify_tree_expiry(order_tree, root);
        }

        /// Critbit invariant: left child has critbit=0, right has critbit=1
        fn verify_tree_invariant(order_tree: &OrderTreeNodes, root: &OrderTreeRoot) {
            fn recursive_check(order_tree: &OrderTreeNodes, h: NodeHandle) {
                if let NodeRef::Inner(&inner) = order_tree.node(h).unwrap().case().unwrap() {
                    let left = order_tree.node(inner.children[0]).unwrap().key().unwrap();
                    let right = order_tree.node(inner.children[1]).unwrap().key().unwrap();
                    let inner_key = u128::from_le_bytes(inner.key);
                    assert!((inner_key ^ left).leading_zeros() >= inner.prefix_len);
                    assert!((inner_key ^ right).leading_zeros() >= inner.prefix_len);

                    let crit_bit_mask: u128 = 1u128 << (127 - inner.prefix_len);
                    assert!(left & crit_bit_mask == 0);
                    assert!(right & crit_bit_mask != 0);
                    recursive_check(order_tree, inner.children[0]);
                    recursive_check(order_tree, inner.children[1]);
                }
            }
            if let Some(r) = root.node() {
                recursive_check(order_tree, r);
            }
        }

        /// Iteration order: ascending for asks, descending for bids
        fn verify_tree_iteration(order_tree: &OrderTreeNodes, root: &OrderTreeRoot) {
            let mut total = 0u32;
            let ascending = order_tree.order_tree_type() == OrderTreeType::Asks;
            let mut last_key: u128 = if ascending { 0 } else { u128::MAX };

            for (_, node) in order_tree.iter(root) {
                let key = u128::from_le_bytes(node.key);
                if ascending {
                    assert!(key >= last_key, "ask must be ascending");
                } else {
                    assert!(key <= last_key, "bids must be descending");
                }
                last_key = key;
                total += 1;
            }
            assert_eq!(root.leaf_count, total);
        }

        /// child_earliest_expiry must match actual child expiries
        fn verify_tree_expiry(order_tree: &OrderTreeNodes, root: &OrderTreeRoot) {
            fn recursive_check(order_tree: &OrderTreeNodes, h: NodeHandle) {
                if let NodeRef::Inner(&inner) = order_tree.node(h).unwrap().case().unwrap() {
                    let left  = order_tree.node(inner.children[0]).unwrap().earliest_expiry();
                    let right = order_tree.node(inner.children[1]).unwrap().earliest_expiry();
        
                    // ADD THIS
                    if inner.child_earliest_expiry[0] != left {
                        panic!(
                            "LEFT mismatch at handle — stored: {}, actual: {}",
                            inner.child_earliest_expiry[0], left
                        );
                    }
                    if inner.child_earliest_expiry[1] != right {
                        panic!(
                            "RIGHT mismatch at handle — stored: {}, actual: {}",
                            inner.child_earliest_expiry[1], right
                        );
                    }
        
                    recursive_check(order_tree, inner.children[0]);
                    recursive_check(order_tree, inner.children[1]);
                }
            }
            if let Some(r) = root.node() {
                recursive_check(order_tree, r);
            }
        }
        
        // Create a leaf with a specific expiry timestamp
        /// timestamp = expiry - 1, tif = 1 → expires at exactly `expiry`
        fn new_expiring_leaf(price: i64, expiry: u64, seq_num: u64) -> LeafNode {
            let price_data = fixed_price_data(price).unwrap();
            let key = new_node_key(Side::Bid, price_data, seq_num);
            LeafNode::new(
                0,         // owner_slot
                1,         // time_in_force = 1 → expires at `expiry`
                0,         // client_order_id
                0,         // quantity
                expiry - 1, // timestamp
                key,         // key 
                [0u8; 32], // owner
            )
        }
        
        fn new_gtc_leaf(price: i64, quantity: i64, seq_num: u64) -> LeafNode {
            let price_data = fixed_price_data(price).unwrap();
                let key = new_node_key(Side::Ask, price_data, seq_num);
            LeafNode::new(
                0,         // owner_slot
                0,         // time_in_force = 0 → never expires
                0,         // client_order_id
                quantity,         // quantity
                1000,      // timestamp
                key,         // key 
                [0u8; 32], // owner
            )
         }
         #[test]
         fn order_tree_expiry_manual() {
             let mut bids = new_order_tree(OrderTreeType::Bids);
             let mut root = OrderTreeRoot::zeroed();
         
             // Empty tree — no expiry
             assert!(bids.find_earliest_expiry(&root).is_none());
         
             // Insert price=100, expiry=5000, seq=0
             bids.insert_leaf(&mut root, &new_expiring_leaf(100, 5000, 0)).unwrap();
             assert_eq!(bids.find_earliest_expiry(&root).unwrap().1, 5000);
             verify_order_tree(&bids, &root);
         
             // Insert price=200, expiry=4000, seq=1 — becomes earliest
             bids.insert_leaf(&mut root, &new_expiring_leaf(200, 4000, 1)).unwrap();
             assert_eq!(bids.find_earliest_expiry(&root).unwrap().1, 4000);
             verify_order_tree(&bids, &root);
         
             // Insert price=300, expiry=4500, seq=2 — 4000 still earliest
             bids.insert_leaf(&mut root, &new_expiring_leaf(300, 4500, 2)).unwrap();
             assert_eq!(bids.find_earliest_expiry(&root).unwrap().1, 4000);
             verify_order_tree(&bids, &root);
         
             // Insert price=400, expiry=3500, seq=3 — becomes earliest
             bids.insert_leaf(&mut root, &new_expiring_leaf(400, 3500, 3)).unwrap();
             assert_eq!(bids.find_earliest_expiry(&root).unwrap().1, 3500);
             verify_order_tree(&bids, &root);
         
             // Remove price=400 seq=3 (expiry 3500) — 4000 becomes earliest
             let key400 = new_node_key(Side::Bid, fixed_price_data(400).unwrap(), 3);
             bids.remove_by_key(&mut root, key400).unwrap();
             verify_order_tree(&bids, &root);
             assert_eq!(bids.find_earliest_expiry(&root).unwrap().1, 4000);
         
             // Remove price=100 seq=0 (expiry 5000) — 4000 still earliest
             let key100 = new_node_key(Side::Bid, fixed_price_data(100).unwrap(), 0);
             bids.remove_by_key(&mut root, key100).unwrap();
             verify_order_tree(&bids, &root);
             assert_eq!(bids.find_earliest_expiry(&root).unwrap().1, 4000);
         
             // Remove price=200 seq=1 (expiry 4000) — 4500 becomes earliest
             let key200 = new_node_key(Side::Bid, fixed_price_data(200).unwrap(), 1);
             bids.remove_by_key(&mut root, key200).unwrap();
             verify_order_tree(&bids, &root);
             assert_eq!(bids.find_earliest_expiry(&root).unwrap().1, 4500);
         
             // Remove price=300 seq=2 (expiry 4500) — tree empty
             let key300 = new_node_key(Side::Bid, fixed_price_data(300).unwrap(), 2);
             bids.remove_by_key(&mut root, key300).unwrap();
             verify_order_tree(&bids, &root);
             assert!(bids.find_earliest_expiry(&root).is_none());
         }
         
         #[test]
         fn order_tree_expiry_random() {
             use rand::Rng;
             let mut rng = rand::thread_rng();
             let mut root = OrderTreeRoot::zeroed();
             let mut bids = new_order_tree(OrderTreeType::Bids);
         
             // Track (price, seq_num) pairs so we can reconstruct keys for removal
             let mut inserted: Vec<(i64, u64)> = vec![];
             let mut seq: u64 = 0;
         
             for _ in 0..200 {
                 let price: i64 = rng.gen_range(1..10000_i64);
                 // Skip duplicate prices
                 if inserted.iter().any(|(p, _)| *p == price) {
                     continue;
                 }
                 let expiry: u64 = rng.gen_range(1..200_u64);
                 inserted.push((price, seq));
                 bids.insert_leaf(&mut root, &new_expiring_leaf(price, expiry, seq))
                     .unwrap();
                 verify_order_tree(&bids, &root);
                 seq += 1;
             }
         
             // Remove 50 at random
             for _ in 0..50 {
                 if inserted.is_empty() {
                     break;
                 }
                 let idx = rng.gen_range(0..inserted.len());
                 let (price, seq_num) = inserted[idx];
                 let key = new_node_key(
                     Side::Bid,
                     fixed_price_data(price).unwrap(),
                     seq_num,
                 );
                 bids.remove_by_key(&mut root, key).unwrap();
                 inserted.remove(idx);
                 verify_order_tree(&bids, &root);
             }
         }
         
         
         #[test]
         fn insert_and_find() {
             let mut asks = new_order_tree(OrderTreeType::Asks);
             let mut root = OrderTreeRoot::zeroed();
         
             let leaf = new_gtc_leaf(100, 10, 0);
             let (handle, replaced) = asks.insert_leaf(&mut root, &leaf).unwrap();
         
             assert!(replaced.is_none());
             assert_eq!(root.leaf_count, 1);
             assert!(asks.node(handle).is_some());
         }
         
         
         #[test]
         fn remove_by_key_works() {
             let mut asks = new_order_tree(OrderTreeType::Asks);
             let mut root = OrderTreeRoot::zeroed();
         
             asks.insert_leaf(&mut root, &new_gtc_leaf(100, 5, 0)).unwrap();
             asks.insert_leaf(&mut root, &new_gtc_leaf(200, 5, 1)).unwrap();
             assert_eq!(root.leaf_count, 2);
         
             // Must use same key as insert
             let key100 = new_node_key(Side::Ask, fixed_price_data(100).unwrap(), 0);
             let removed = asks.remove_by_key(&mut root, key100).unwrap();
             assert_eq!(
                 u128::from_le_bytes(removed.key),
                 key100
             );
             assert_eq!(root.leaf_count, 1);
             verify_order_tree(&asks, &root);
         }
         
         #[test]
         fn remove_nonexistent_returns_none() {
             let mut asks = new_order_tree(OrderTreeType::Asks);
             let mut root = OrderTreeRoot::zeroed();
             asks.insert_leaf(&mut root, &new_gtc_leaf(100, 5, 0)).unwrap();
         
             // Key 999 was never inserted
             let fake_key = new_node_key(Side::Ask, fixed_price_data(999).unwrap(), 0);
             assert!(asks.remove_by_key(&mut root, fake_key).is_none());
         }
         
         
         #[test]
         fn remove_one_expired_works() {
             let mut bids = new_order_tree(OrderTreeType::Bids);
             let mut root = OrderTreeRoot::zeroed();
         
             // expiry=100 means timestamp=99, tif=1 → expires at 100
             bids.insert_leaf(&mut root, &new_expiring_leaf(100, 100, 0)).unwrap();
             bids.insert_leaf(&mut root, &new_gtc_leaf(200, 5, 1)).unwrap();
             assert_eq!(root.leaf_count, 2);
         
             // At ts=99 — not yet expired
             let removed = bids.remove_one_expired(&mut root, 99);
             assert!(removed.is_none());
             assert_eq!(root.leaf_count, 2);
         
             // At ts=100 — exactly expired
             let removed = bids.remove_one_expired(&mut root, 100);
             assert!(removed.is_some());
             assert_eq!(root.leaf_count, 1);
             verify_order_tree(&bids, &root);
         }
         
         
         #[test]
         fn tree_is_full_at_max_nodes() {
             let mut asks = new_order_tree(OrderTreeType::Asks);
             let mut root = OrderTreeRoot::zeroed();
         
             let mut seq: u64 = 0;
             for price in 1..=(MAX_ORDERTREE_NODES as i64) {
                 if asks.is_full() {
                     break;
                 }
                 asks.insert_leaf(&mut root, &new_gtc_leaf(price, 1, seq))
                     .unwrap();
                 seq += 1;
             }
             assert!(asks.is_full());
         }
    }
}
