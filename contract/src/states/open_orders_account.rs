use bytemuck::{Pod, Zeroable};
use pinocchio::error::ProgramError;

use crate::{
    constants::MAX_OPEN_ORDERS,
    errors::OrderBookError,
    states::{BookSideOrderTree, LeafNode, Side, SideAndOrderTree},
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

    pub fn is_settle_destination_allowed(
        &self,
        ix_signer: [u8; 32],
        account_owner: [u8; 32],
    ) -> bool {
        // delegate can withdraw to owner accounts
        let delegate_option: Option<[u8; 32]> = Option::from(self.delegate);
        if Some(ix_signer) == delegate_option {
            return self.owner == account_owner;
        }

        // owner can withdraw to anywhere
        ix_signer == self.owner
    }

    pub fn all_orders(&self) -> impl Iterator<Item = &OpenOrder> {
        self.open_orders.iter()
    }

    pub fn has_no_order(&self) -> bool {
        self.open_orders.iter().count() == 0
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
            .position(|oo| !oo.is_free() && u64::from_le_bytes(oo.client_id) == client_id)
    }
    pub fn find_order_with_order_id(&self, order_id: u128) -> Option<&OpenOrder> {
        self.all_orders_in_use()
            .find(|&oo| u128::from_le_bytes(oo.id) == order_id)
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
        order_tree: BookSideOrderTree,
        order: &LeafNode,
        client_order_id: u64,
        locked_price: i64,
    ) {
        let slot = order.owner_slot as usize;
        let oo = self.open_order_mut_by_raw_index(slot);

        oo.is_free = false.into();
        oo.side_and_tree = SideAndOrderTree::new(side, order_tree).into();
        oo.id = order.key;
        oo.client_id = client_order_id.to_le_bytes();
        oo.locked_price = locked_price.to_le_bytes();
    }

    pub fn remove_order(&mut self, slot: usize) {
        let oo = self.open_order_by_raw_index(slot);
        assert!(!oo.is_free());

        *self.open_order_mut_by_raw_index(slot) = OpenOrder::default();
    }
}

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct OpenOrder {
    pub id: [u8; 16],
    pub client_id: [u8; 8],
    pub locked_price: [u8; 8],
    pub is_free: u8,
    pub side_and_tree: u8,
    pub reserved: [u8; 6],
}

const _: () = assert!(size_of::<OpenOrder>() == 16 + 8 + 8 + 1 + 1 + 6);
const _: () = assert!(size_of::<OpenOrder>() % 8 == 0);

impl Default for OpenOrder {
    fn default() -> Self {
        Self {
            is_free: 1,
            side_and_tree: SideAndOrderTree::BidFixed as u8,
            client_id: [0u8; 8],
            locked_price: [0u8; 8],
            id: [0u8; 16],
            reserved: [0; 6],
        }
    }
}

impl OpenOrder {
    pub fn is_free(&self) -> bool {
        self.is_free == u8::from(true)
    }

    pub fn side_and_tree(&self) -> SideAndOrderTree {
        SideAndOrderTree::try_from(self.side_and_tree).unwrap()
    }
}
