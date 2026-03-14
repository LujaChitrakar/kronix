use crate::{errors::OrderBookError, states::Side};
use bytemuck::{Pod, Zeroable, cast_mut, cast_ref};
use core::mem::size_of;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use pinocchio::error::ProgramError;
use std::u64;

pub type NodeHandle = u32;
const NODE_SIZE: usize = 88;

#[derive(Debug, Clone, Copy, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
pub enum NodeTag {
    Uninitialized = 0,
    InnerNode = 1,
    LeafNode = 2,
    FreeNode = 3,
    LastFreeNode = 4,
}

// Creates binary tree node key from side, price data, and sequence number
// seq_num is used for time priority; Ascending for Ask, Descending for Bid
pub fn new_node_key(side: Side, price_data: u64, seq_num: u64) -> u128 {
    let seq_num = if side == Side::Bid { !seq_num } else { seq_num };
    let upper = (price_data as u128) << 64;
    upper | (seq_num as u128)
}

// Create price data for a fixed order price
pub fn fixed_price_data(price_lots: i64) -> Result<u64, ProgramError> {
    if price_lots < 1 {
        return Err(OrderBookError::InvalidPriceLots.into());
    }
    Ok(price_lots as u64)
}

// Get price from the fixed orders price data
pub fn fixed_price_lots(price_data: u64) -> Result<i64, ProgramError> {
    if price_data <= i64::MAX as u64 {
        return Err(OrderBookError::InvalidPriceData.into());
    }
    Ok(price_data as i64)
}

// InnerNodes and leaf Nodes compose the binary tree structure
// Each innerNode has 2 children, either a leaf node or another inner node
// The children share the top "prefix_len" bits of the key, the left child has a 0 bit and the right child has a 1 bit
#[derive(Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct InnerNode {
    pub tag: u8,
    pub padding: [u8; 3],
    // number of highest key bits shared by children
    pub prefix_len: u32,
    // only the top bits of key are relevant
    pub key: [u8; 16],
    // The earliest expiry of the children(left and right subtrees)
    pub child_earliest_expiry: [u64; 2],
    // right child index
    pub children: [NodeHandle; 2],
    pub reserved1: [u8; 32],
    pub reserved2: [u8; 8],
}
const _: () = assert!(size_of::<InnerNode>() == 16 + 8 * 2 + 4 * 2 + 1 + 3 + 4 + 32 + 8);
const _: () = assert!(size_of::<InnerNode>() == NODE_SIZE);
const _: () = assert!(size_of::<InnerNode>() % 8 == 0);

impl InnerNode {
    pub fn new(prefix_len: u32, key: u128) -> Self {
        Self {
            key: key.to_le_bytes(),
            child_earliest_expiry: [u64::MAX; 2],
            children: [0; 2],
            tag: NodeTag::InnerNode.into(),
            padding: [0; 3],
            prefix_len,
            reserved1: [0; 32],
            reserved2: [0; 8],
        }
    }

    // Returns the handle of the child that may contain the search key, and whether the crit bit is set
    pub(crate) fn walk_down(&self, search_key: u128) -> (NodeHandle, bool) {
        let crit_bit_mask = 1u128 << (127 - self.prefix_len);
        let crit_bit = (search_key & crit_bit_mask) != 0;
        (self.children[crit_bit as usize], crit_bit)
    }

    // lowest timestamp at which a leafnode expires
    pub fn earliest_expiry(&self) -> u64 {
        std::cmp::min(self.child_earliest_expiry[0], self.child_earliest_expiry[1])
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Pod, Zeroable)]
#[repr(C)]
pub struct LeafNode {
    pub tag: u8,
    // Index into the owning OpenOrderAccount's openOrders
    pub owner_slot: u8,
    // Time in seconds after "timestamp" at which the order expires. 0 = no expiration
    pub time_in_force: u16,
    pub padding: [u8; 4],
    // binary tree key
    pub key: [u8; 16],
    // Address of the owning OpenOrderAccount
    pub owner: [u8; 32],
    // User defined id for this order
    pub client_order_id: u64,
    // No of base lot to buy/sell
    pub quantity: i64,
    pub timestamp: u64,
    // only applicable for oracle_pegged ordertree
    pub peg_limit: i64,
}
const _: () = assert!(size_of::<LeafNode>() == 16 + 32 + 8 + 8 + 8 + 8 + 1 + 1 + 2 + 4);
const _: () = assert!(size_of::<LeafNode>() == NODE_SIZE);
const _: () = assert!(size_of::<LeafNode>() % 8 == 0);

impl LeafNode {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        owner: [u8; 32],
        key: [u8; 16],
        client_order_id: u64,
        quantity: i64,
        timestamp: u64,
        peg_limit: i64,
        owner_slot: u8,
        time_in_force: u16,
    ) -> Self {
        Self {
            tag: NodeTag::LeafNode.into(),
            owner,
            key,
            client_order_id,
            quantity,
            timestamp,
            peg_limit,
            owner_slot,
            time_in_force,
            padding: [0; 4],
        }
    }

    #[inline(always)]
    pub fn price_data(&self) -> u64 {
        (u128::from_le_bytes(self.key) >> 64) as u64
    }

    #[inline(always)]
    pub fn expiry(&self) -> u64 {
        if self.time_in_force == 0 {
            u64::MAX
        } else {
            self.timestamp + self.time_in_force as u64
        }
    }

    #[inline(always)]
    pub fn is_expired(&self, now_ts: u64) -> bool {
        self.time_in_force > 0 && now_ts >= self.timestamp + self.time_in_force as u64
    }
}

#[derive(Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct FreeNode {
    pub(crate) tag: u8,
    pub(crate) padding: [u8; 3],
    // required to make anynode alignment with other node types
    pub(crate) next: NodeHandle,
    pub(crate) reserved0: [u8; 64],
    pub(crate) reserved1: [u8; 8],
    pub(crate) force_align: u64,
}
const _: () = assert!(size_of::<FreeNode>() == NODE_SIZE);
const _: () = assert!(size_of::<FreeNode>() % 8 == 0);

#[derive(Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct AnyNode {
    pub tag: u8,
    pub data: [u8; 79],
    // required to make anynode alignment with other node types
    pub(crate) force_align: u64,
}

const _: () = assert!(size_of::<AnyNode>() == NODE_SIZE);
const _: () = assert!(size_of::<AnyNode>() % 8 == 0);
const _: () = assert!(align_of::<AnyNode>() == 8);
const _: () = assert!(size_of::<AnyNode>() == size_of::<InnerNode>());
const _: () = assert!(align_of::<AnyNode>() == align_of::<InnerNode>());
const _: () = assert!(size_of::<AnyNode>() == size_of::<LeafNode>());
const _: () = assert!(align_of::<AnyNode>() == align_of::<LeafNode>());
const _: () = assert!(size_of::<AnyNode>() == size_of::<FreeNode>());
const _: () = assert!(align_of::<AnyNode>() == align_of::<FreeNode>());

pub(crate) enum NodeRef<'a> {
    Inner(&'a InnerNode),
    Leaf(&'a LeafNode),
}
pub(crate) enum NodeRefMut<'a> {
    Inner(&'a mut InnerNode),
    Leaf(&'a mut LeafNode),
}

impl AnyNode {
    pub(crate) fn case(&self) -> Option<NodeRef> {
        match NodeTag::try_from(self.tag) {
            Ok(NodeTag::InnerNode) => Some(NodeRef::Inner(cast_ref(self))),
            Ok(NodeTag::LeafNode) => Some(NodeRef::Leaf(cast_ref(self))),
            _ => None,
        }
    }

    pub fn case_mut(&mut self) -> Option<NodeRefMut> {
        match NodeTag::try_from(self.tag) {
            Ok(NodeTag::InnerNode) => Some(NodeRefMut::Inner(cast_mut(self))),
            Ok(NodeTag::LeafNode) => Some(NodeRefMut::Leaf(cast_mut(self))),
            _ => None,
        }
    }

    pub fn key(&self) -> Option<u128> {
        match self.case()? {
            NodeRef::Inner(inner) => Some(u128::from_le_bytes(inner.key)),
            NodeRef::Leaf(leaf) => Some(u128::from_le_bytes(leaf.key)),
        }
    }

    pub(crate) fn children(&self) -> Option<[NodeHandle; 2]> {
        match self.case().unwrap() {
            NodeRef::Inner(&InnerNode { children, .. }) => Some(children),
            NodeRef::Leaf(_) => None,
        }
    }

    #[inline]
    pub fn as_leaf(&self) -> Option<&LeafNode> {
        match self.case() {
            Some(NodeRef::Leaf(leaf_ref)) => Some(leaf_ref),
            _ => None,
        }
    }

    #[inline]
    pub fn as_leaf_mut(&mut self) -> Option<&mut LeafNode> {
        match self.case_mut() {
            Some(NodeRefMut::Leaf(leaf_ref)) => Some(leaf_ref),
            _ => None,
        }
    }

    #[inline]
    pub fn as_inner(&self) -> Option<&InnerNode> {
        match self.case() {
            Some(NodeRef::Inner(inner_ref)) => Some(inner_ref),
            _ => None,
        }
    }

    #[inline]
    pub fn as_inner_mut(&mut self) -> Option<&mut InnerNode> {
        match self.case_mut() {
            Some(NodeRefMut::Inner(inner_ref)) => Some(inner_ref),
            _ => None,
        }
    }

    #[inline]
    pub fn earliest_expiry(&self) -> u64 {
        match self.case().unwrap() {
            NodeRef::Inner(inner) => inner.earliest_expiry(),
            NodeRef::Leaf(leaf) => leaf.expiry(),
        }
    }
}
impl AsRef<AnyNode> for InnerNode {
    fn as_ref(&self) -> &AnyNode {
        cast_ref(self)
    }
}
impl AsRef<AnyNode> for LeafNode {
    fn as_ref(&self) -> &AnyNode {
        cast_ref(self)
    }
}