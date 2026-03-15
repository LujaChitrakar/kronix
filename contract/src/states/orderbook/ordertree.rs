use bytemuck::checked::cast;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use pinocchio::error::ProgramError;

use crate::{
    constants::MAX_ORDERTREE_NODES,
    states::{AnyNode, FreeNode, LeafNode, NodeHandle, NodeRef, NodeTag, OrderTreeIter, Side},
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

#[derive(Debug)]
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
#[derive(Copy, Clone)]
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
        root.leaf_count
            .checked_sub(1)
            .ok_or(ProgramError::ArithmeticOverflow)
            .unwrap();
        let removed_leaf: LeafNode = cast(self.remove(child_h).unwrap());

        let outdated_expiry = removed_leaf.expiry();
        stack.pop();
        self.update_parent_earliest_expiry(&stack, outdated_expiry, new_expiry);
        Some(removed_leaf)
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
            if parent.child_earliest_expiry[!crit_bit as usize] != outdated_expiry {
                break;
            }
            outdated_expiry = parent.earliest_expiry();
            parent.child_earliest_expiry[!crit_bit as usize] = new_expiry;
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