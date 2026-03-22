use bytemuck::{Pod, Zeroable};
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{constants::EVENT_SIZE, states::Side};

#[derive(Copy, Clone, IntoPrimitive, TryFromPrimitive, Eq, PartialEq)]
#[repr(u8)]
pub enum EventType {
    Fill,
}

#[derive(Copy, Clone, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct FillEvent {
    pub event_type: u8,
    pub taker_side: u8,
    pub maker_out: u8, //1 if maker order quanity==0
    pub maker_slot: u8,
    pub _padding: [u8; 4],
    pub timestamp: u64,
    pub maker_seq_num: u64,
    // When order was placed
    pub maker_timestamp: u64,
    pub maker_client_order_id: u64,
    pub taker_client_order_id: u64,
    pub price: i64,
    pub quantity: i64, //no of base lots
    pub maker_pubkey: [u8; 32],
    pub taker_pubkey: [u8; 32],
    pub reserved: [u8; 16],
}
impl Default for FillEvent {
    fn default() -> Self {
        bytemuck::Zeroable::zeroed()
    }
}
const _: () = assert!(size_of::<FillEvent>() == EVENT_SIZE);
const _: () = assert!(size_of::<FillEvent>() % 8 == 0);

impl FillEvent {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        taker_side: Side,
        maker_out: bool,
        maker_slot: u8,
        timestamp: u64,
        maker_seq_num: u64,
        maker_timestamp: u64,
        maker_client_order_id: u64,
        taker_client_order_id: u64,
        price: i64,
        quantity: i64,
        maker_pubkey: [u8; 32],
        taker_pubkey: [u8; 32],
    ) -> Self {
        Self {
            event_type: EventType::Fill as u8,
            taker_side: taker_side as u8,
            maker_out: maker_out as u8,
            maker_slot,
            timestamp,
            maker_seq_num,
            maker_timestamp,
            maker_client_order_id,
            taker_client_order_id,
            price,
            quantity,
            maker_pubkey,
            taker_pubkey,
            _padding: [0u8; 4],
            reserved: [0u8; 16],
        }
    }

    pub fn taker_side(&self) -> Side {
        self.taker_side.try_into().unwrap()
    }

    pub fn maker_out(&self) -> bool {
        self.maker_out == 1
    }
}
