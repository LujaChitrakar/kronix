use bytemuck::{Pod, Zeroable};
use pinocchio::error::ProgramError;

use crate::{
    constants::MAX_OPEN_ORDERS,
    errors::OrderBookError,
    states::{BookSideOrderTree, LeafNode, Side},
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct OpenOrdersAccount {
    pub owner: [u8; 32],                           // 32
    pub market: [u8; 32],                          // 32
    pub delegate: [u8; 32],                        // 32 — [0;32] = no delegate
    pub bump: u8,                                  // 1
    pub padding: [u8; 7],                          // 7
    pub open_orders: [OpenOrder; MAX_OPEN_ORDERS], // 24 * 40 = 960
    pub reserved: [u8; 32],                        // 32
}

const _: () = assert!(
    size_of::<OpenOrdersAccount>()
        == 32 + 32 + 32 + 1 + 7 + (size_of::<OpenOrder>() * MAX_OPEN_ORDERS) + 32
);
const _: () = assert!(size_of::<OpenOrdersAccount>() % 8 == 0);

impl OpenOrdersAccount {
    // no of bytes required for space including disc
    pub fn space() -> usize {
        8 + size_of::<OpenOrdersAccount>()
    }

    pub fn is_owner_or_delegate(&self, ix_signer: [u8; 32]) -> bool {
        self.owner == ix_signer || (self.delegate != [0u8; 32] && self.delegate == ix_signer)
    }

    pub fn all_orders(&self) -> impl Iterator<Item = &OpenOrder> {
        self.open_orders.iter()
    }

    pub fn has_no_orders(&self) -> bool {
        self.open_orders.iter().all(|oo| oo.is_free())
    }

    pub fn all_orders_in_use(&self) -> impl Iterator<Item = &OpenOrder> {
        self.all_orders().filter(|oo| !oo.is_free())
    }

    pub fn next_order_slot(&self) -> Result<usize, ProgramError> {
        self.open_orders
            .iter()
            .position(|oo| oo.is_free())
            .ok_or(OrderBookError::OpenOrdersFull.into())
    }

    pub fn find_order_with_client_id(&self, client_id: u64) -> Option<usize> {
        self.open_orders
            .iter()
            .position(|oo| !oo.is_free() && oo.client_id == client_id)
    }
    pub fn find_order_with_order_id(&self, order_id: u128) -> Option<&OpenOrder> {
        self.all_orders_in_use()
            .find(|oo| !oo.is_free() && u128::from_le_bytes(oo.id) == order_id)
    }

    pub fn open_order_by_raw_index(&self, raw_index: usize) -> &OpenOrder {
        &self.open_orders[raw_index]
    }

    pub fn open_order_mut_by_raw_index(&mut self, raw_index: usize) -> &mut OpenOrder {
        &mut self.open_orders[raw_index]
    }

    pub fn add_order(
        &mut self,
        side: Side,
        order: &LeafNode,
        client_order_id: u64,
        locked_price: i64,
        slot: usize,
    ) {
        let oo = self.open_order_mut_by_raw_index(slot);

        oo.is_free = false.into();
        oo.side = side as u8;
        oo.id = order.key;
        oo.client_id = client_order_id;
        oo.locked_price = locked_price;
        oo.filled_qty = 0;
        oo.fill_price = 0;
        oo.is_filled = 0;
        oo.padding = [0; 5];
    }

    pub fn remove_order(&mut self, slot: usize) {
        let oo = self.open_order_by_raw_index(slot);
        assert!(!oo.is_free());

        *self.open_order_mut_by_raw_index(slot) = OpenOrder::default();
    }

    /// Called by matching engine — records fill for maker to claim later
    pub fn record_fill(&mut self, slot: usize, filled_qty: i64, fill_price: i64, maker_out: bool) {
        let oo = &mut self.open_orders[slot];
        oo.filled_qty = filled_qty;
        oo.fill_price = fill_price;
        oo.is_filled = 1;
        if maker_out {
            // fully consumed — slot freed after claim_fill
            oo.is_free = 0; // still occupied until maker claims
        }
    }
}

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct OpenOrder {
    pub id: [u8; 16],
    pub client_id: u64,
    pub locked_price: i64,
    pub filled_qty: i64, // base lots filled, pending claim
    pub fill_price: i64, // fill price, pending claim
    pub is_free: u8,     // 1 = free slot
    pub side: u8,        // Side as u8
    pub is_filled: u8,
    pub padding: [u8; 5],
}

const _: () = assert!(size_of::<OpenOrder>() == 16 + 8 + 8 + 8 + 8 + 1 + 1 + 1 + 5);
const _: () = assert!(size_of::<OpenOrder>() % 8 == 0);

impl Default for OpenOrder {
    fn default() -> Self {
        Self {
            is_free: 1,
            side: Side::Bid as u8,
            client_id: 0,
            locked_price: 0,
            id: [0u8; 16],
            filled_qty: 0,
            fill_price: 0,
            is_filled: 0,
            padding: [0; 5],
        }
    }
}

impl OpenOrder {
    pub fn is_free(&self) -> bool {
        self.is_free == 1
    }

    pub fn side(&self) -> Side {
        match self.side {
            0 => Side::Bid,
            _ => Side::Ask,
        }
    }

    pub fn has_pending_fill(&self) -> bool {
        self.is_filled == 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn make_oo(owner: [u8; 32]) -> OpenOrdersAccount {
        let mut oo = OpenOrdersAccount::zeroed();
        oo.owner = owner;
        oo
    }

    fn make_order(id: u128, price: i64, side: Side, client_id: u64) -> OpenOrder {
        OpenOrder {
            id: id.to_be_bytes(),
            client_id: client_id,
            locked_price: price,
            filled_qty: 0,
            fill_price: 0,
            is_free: 0,
            side: side as u8,
            is_filled: 0,
            padding: [0; 5],
        }
    }

    fn dummy_leaf(slot: u8, key: u128, owner: [u8; 32], qty: i64) -> LeafNode {
        LeafNode::new(slot, 0, 0, qty, 1000, key, owner)
    }

    #[test]
    fn open_order_size() {
        assert_eq!(core::mem::size_of::<OpenOrder>(), 56);
        assert_eq!(core::mem::size_of::<OpenOrder>() % 8, 0);
    }

}
