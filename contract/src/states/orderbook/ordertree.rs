use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{
    constants::MAX_ORDERTREE_NODES,
    states::{AnyNode, NodeHandle, NodeTag, Side},
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

    // iter over all entries including invalid orders
    // Smallest to highest for bid
    // Highest to smallest for ask
    // pub fn iter(&self,root:&OrderTreeRoot) -> OrderTree{

    // }
}
