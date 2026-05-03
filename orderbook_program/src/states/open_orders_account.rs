use bytemuck::{Pod, Zeroable};
use margin_math::consumed_margin;
use pinocchio::error::ProgramError;
use shank::{ShankAccount, ShankType};

use crate::{
    constants::MAX_OPEN_ORDERS,
    errors::OrderBookError,
    states::{BookSide, LeafNode, Side},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankAccount)]
#[repr(C)]
pub struct OpenOrdersAccount {
    pub owner: [u8; 32],    // 32
    pub market: [u8; 32],   // 32
    pub delegate: [u8; 32], // 32 — [0;32] = no delegate
    pub bump: u8,           // 1
    pub padding: [u8; 7],   // 7
    pub open_orders: [OpenOrder; 24],
    pub reserved: [u8; 32], // 32
}

const _: () = assert!(
    size_of::<OpenOrdersAccount>()
        == 32 + 32 + 32 + 1 + 7 + (size_of::<OpenOrder>() * MAX_OPEN_ORDERS) + 32
);
const _: () = assert!(size_of::<OpenOrdersAccount>() % 8 == 0);

impl OpenOrdersAccount {
    pub const LEN: usize = size_of::<OpenOrdersAccount>();
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
        reserved_margin: i64,
        original_base_lots: i64,
        filled_base_lots: i64,
        slot: usize,
    ) {
        let oo = self.open_order_mut_by_raw_index(slot);

        oo.is_free = false.into();
        oo.side = side as u8;
        oo.id = order.key;
        oo.client_id = client_order_id;
        oo.reserved_margin = reserved_margin;
        oo.original_base_lots = original_base_lots;
        oo.filled_base_lots = filled_base_lots;
        // oo.filled_qty = 0;
        // oo.fill_price = 0;
        // oo.is_filled = 0;
        oo.maker_out = 0;
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

        // if oo.filled_qty == 0 {
        //     // first fill — just set directly
        //     oo.filled_qty = filled_qty;
        //     oo.fill_price = fill_price;
        // } else {
        //     // subsequent fill — accumulate qty, VWAP price
        //     let total_qty = oo.filled_qty + filled_qty;
        //     let vwap = (oo.filled_qty as i128 * oo.fill_price as i128
        //         + filled_qty as i128 * fill_price as i128)
        //         / total_qty as i128;

        //     oo.filled_qty = total_qty;
        //     oo.fill_price = vwap as i64;
        // }

        // oo.is_filled = 1;
        oo.filled_base_lots = oo.filled_base_lots.saturating_add(filled_qty);
        oo.maker_out = maker_out as u8;
    }

    pub fn cleanup_stale_orders(&mut self, bookside_bids: &BookSide, bookside_asks: &BookSide) {
        for i in 0..self.open_orders.len() {
            let oo = &self.open_orders[i];
            if oo.is_free() {
                continue;
            }
            // Check if order still exists in book
            let side = oo.side();
            let bookside = match side {
                Side::Bid => bookside_bids,
                Side::Ask => bookside_asks,
            };
            let id = u128::from_le_bytes(oo.id);
            if bookside.node_by_key(id).is_none() {
                // Order gone from book — free the slot
                self.open_orders[i] = OpenOrder::default();
            }
        }
    }
}

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct OpenOrder {
    pub id: [u8; 16],
    pub client_id: u64,
    pub reserved_margin: i64,
    pub original_base_lots: i64,
    pub filled_base_lots: i64,
    // pub filled_qty: i64, // base lots filled, pending claim
    // pub fill_price: i64, // fill price, pending claim
    pub is_free: u8, // 1 = free slot
    pub side: u8,    // Side as u8
    // pub is_filled: u8,
    pub maker_out: u8,
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
            reserved_margin: 0,
            original_base_lots: 0,
            filled_base_lots: 0,
            id: [0u8; 16],
            // filled_qty: 0,
            // fill_price: 0,
            // is_filled: 0,
            maker_out: 0,
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

    pub fn consumed_margin(&self) -> Result<i64, ProgramError> {
        consumed_margin(
            self.reserved_margin,
            self.filled_base_lots,
            self.original_base_lots,
        )
        .map_err(|_| ProgramError::InvalidArgument)
    }

    pub fn releasable_margin(&self) -> Result<i64, ProgramError> {
        self.reserved_margin
            .checked_sub(self.consumed_margin()?)
            .ok_or(ProgramError::ArithmeticOverflow)
    }

    // pub fn has_pending_fill(&self) -> bool {
    //     self.is_filled == 1
    // }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn make_account(owner: [u8; 32]) -> OpenOrdersAccount {
        let mut oo = OpenOrdersAccount::zeroed();
        oo.owner = owner;
        // initialize all slots to free state
        for slot in oo.open_orders.iter_mut() {
            *slot = OpenOrder::default(); // sets is_free = 1
        }
        oo
    }

    fn make_leaf(key: u128, qty: i64, owner: [u8; 32]) -> LeafNode {
        LeafNode::new(0, 0, 0, qty, 1000, key, owner)
    }

    #[test]
    fn open_order_size() {
        assert_eq!(core::mem::size_of::<OpenOrder>(), 56);
        assert_eq!(core::mem::size_of::<OpenOrder>() % 8, 0);
    }

    #[test]
    fn new_account_has_no_orders() {
        let oo = make_account([1u8; 32]);
        assert!(oo.has_no_orders());
        assert_eq!(oo.all_orders_in_use().count(), 0);
    }
    #[test]
    fn all_slots_free_on_init() {
        let oo = make_account([1u8; 32]);
        assert!(oo.open_orders.iter().all(|o| o.is_free()));
    }
    #[test]
    fn owner_is_valid_signer() {
        let owner = [1u8; 32];
        let oo = make_account(owner);
        assert!(oo.is_owner_or_delegate(owner));
    }

    #[test]
    fn non_owner_rejected() {
        let oo = make_account([1u8; 32]);
        assert!(!oo.is_owner_or_delegate([2u8; 32]));
    }

    #[test]
    fn delegate_is_valid_signer() {
        let mut oo = make_account([1u8; 32]);
        oo.delegate = [3u8; 32];
        assert!(oo.is_owner_or_delegate([3u8; 32]));
    }

    #[test]
    fn zero_delegate_not_valid() {
        let oo = make_account([1u8; 32]);
        // delegate is [0;32] by default — should not be treated as valid
        assert!(!oo.is_owner_or_delegate([0u8; 32]));
    }

    #[test]
    fn next_slot_is_zero_on_empty() {
        let oo = make_account([1u8; 32]);
        assert_eq!(oo.next_order_slot().unwrap(), 0);
    }

    #[test]
    fn next_slot_advances_after_add() {
        let mut oo = make_account([1u8; 32]);
        let leaf = make_leaf(100, 10, [0u8; 32]);
        oo.add_order(Side::Bid, &leaf, 1, 100, 0);
        assert_eq!(oo.next_order_slot().unwrap(), 1);
    }

    #[test]
    fn next_slot_error_when_full() {
        let mut oo = make_account([1u8; 32]);
        for i in 0..MAX_OPEN_ORDERS {
            let leaf = make_leaf(i as u128, 1, [0u8; 32]);
            oo.add_order(Side::Bid, &leaf, i as u64, 100, i);
        }
        assert!(oo.next_order_slot().is_err());
    }

    #[test]
    fn add_order_fills_slot() {
        let mut oo = make_account([1u8; 32]);
        let leaf = make_leaf(42, 10, [0u8; 32]);

        oo.add_order(Side::Ask, &leaf, 99, 200, 0);

        let slot = oo.open_order_by_raw_index(0);
        assert!(!slot.is_free());
        assert_eq!(slot.client_id, 99);
        assert_eq!(slot.reserved_margin, 200);
        assert_eq!(slot.side(), Side::Ask);
        assert_eq!(u128::from_le_bytes(slot.id), 42);
    }

    #[test]
    fn remove_order_frees_slot() {
        let mut oo = make_account([1u8; 32]);
        let leaf = make_leaf(1, 5, [0u8; 32]);
        oo.add_order(Side::Bid, &leaf, 1, 100, 0);
        assert!(!oo.open_order_by_raw_index(0).is_free());

        oo.remove_order(0);
        assert!(oo.open_order_by_raw_index(0).is_free());
        assert!(oo.has_no_orders());
    }

    #[test]
    #[should_panic]
    fn remove_free_slot_panics() {
        let mut oo = make_account([1u8; 32]);
        oo.remove_order(0); // slot is already free
    }

    #[test]
    fn record_fill_sets_fields() {
        let mut oo = make_account([1u8; 32]);
        let leaf = make_leaf(1, 10, [0u8; 32]);
        oo.add_order(Side::Ask, &leaf, 1, 100, 0);

        oo.record_fill(0, 5, 100, false);

        let slot = oo.open_order_by_raw_index(0);
        // assert_eq!(slot.filled_qty, 5);
        // assert_eq!(slot.fill_price, 100);
        // assert!(slot.has_pending_fill());
        assert!(!slot.is_free()); // not free until claimed
    }

    #[test]
    fn find_by_client_id_found() {
        let mut oo = make_account([1u8; 32]);
        let leaf = make_leaf(1, 5, [1u8; 32]);
        oo.add_order(Side::Bid, &leaf, 42, 100, 0);

        assert_eq!(oo.find_order_with_client_id(42), Some(0));
    }

    #[test]
    fn find_by_order_id_found() {
        let mut oo = make_account([1u8; 32]);
        let leaf = make_leaf(999, 5, [1u8; 32]);
        oo.add_order(Side::Ask, &leaf, 1, 100, 0);

        assert!(oo.find_order_with_order_id(999).is_some());
    }

    #[test]
    fn all_orders_in_use_count() {
        let mut oo = make_account([1u8; 32]);

        assert_eq!(oo.all_orders_in_use().count(), 0);

        oo.add_order(Side::Bid, &make_leaf(1, 5, [1u8; 32]), 1, 100, 0);
        assert_eq!(oo.all_orders_in_use().count(), 1);

        oo.add_order(Side::Ask, &make_leaf(2, 5, [1u8; 32]), 2, 200, 1);
        assert_eq!(oo.all_orders_in_use().count(), 2);

        oo.remove_order(0);
        assert_eq!(oo.all_orders_in_use().count(), 1);
    }

    #[test]
    fn open_order_default_is_free() {
        let oo = OpenOrder::default();
        assert!(oo.is_free());
        // assert!(!oo.has_pending_fill());
    }

    #[test]
    fn open_order_side_bid() {
        let mut oo = OpenOrder::default();
        oo.side = Side::Bid as u8;
        assert_eq!(oo.side(), Side::Bid);
    }

    #[test]
    fn open_order_side_ask() {
        let mut oo = OpenOrder::default();
        oo.side = Side::Ask as u8;
        assert_eq!(oo.side(), Side::Ask);
    }
}
