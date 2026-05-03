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
    pub taker_reserved_margin: i64,
    pub taker_filled_base_lots: i64,
    pub taker_original_base_lots: i64,
    pub maker_reserved_margin: i64,
    pub maker_filled_base_lots: i64,
    pub maker_original_base_lots: i64,
    pub maker_pubkey: [u8; 32],
    pub taker_pubkey: [u8; 32],
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
        taker_reserved_margin: i64,
        taker_filled_base_lots: i64,
        taker_original_base_lots: i64,
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
            taker_reserved_margin,
            taker_filled_base_lots,
            taker_original_base_lots,
            maker_reserved_margin: 0,
            maker_filled_base_lots: 0,
            maker_original_base_lots: 0,
            maker_pubkey,
            taker_pubkey,
            _padding: [0u8; 4],
        }
    }

    pub fn taker_side(&self) -> Side {
        self.taker_side.try_into().unwrap()
    }

    pub fn maker_out(&self) -> bool {
        self.maker_out == 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_event_size() {
        assert_eq!(size_of::<FillEvent>(), EVENT_SIZE);
        assert_eq!(size_of::<FillEvent>() % 8, 0);
    }

    #[test]
    fn fill_event_default_is_zeroed() {
        let event = FillEvent::default();
        assert_eq!(event.event_type, 0);
        assert_eq!(event.price, 0);
        assert_eq!(event.quantity, 0);
        assert_eq!(event.maker_pubkey, [0u8; 32]);
        assert_eq!(event.taker_pubkey, [0u8; 32]);
    }

    #[test]
    fn fill_event_new() {
        let maker = [1u8; 32];
        let taker = [1u8; 32];
        let event = FillEvent::new(
            Side::Bid, // taker_side
            true,      // maker_out
            3,         // maker_slot
            1000,      // timestamp
            42,        // seq_num
            900,       // maker_timestamp
            10,        // maker_client_order_id
            20,        // taker_client_order_id
            500,       // price
            100,       // quantity
            maker,
            taker,
        );

        assert_eq!(event.event_type, EventType::Fill as u8);
        assert_eq!(event.taker_side, Side::Bid as u8);
        assert_eq!(event.maker_out, 1);
        assert_eq!(event.maker_slot, 3);
        assert_eq!(event.timestamp, 1000);
        assert_eq!(event.maker_seq_num, 42);
        assert_eq!(event.maker_timestamp, 900);
        assert_eq!(event.maker_client_order_id, 10);
        assert_eq!(event.taker_client_order_id, 20);
        assert_eq!(event.price, 500);
        assert_eq!(event.quantity, 100);
        assert_eq!(event.maker_pubkey, maker);
        assert_eq!(event.taker_pubkey, taker);
    }

    #[test]
    fn maker_out_helper() {
        let mut event = FillEvent::default();
        event.maker_out = 0;
        assert!(!event.maker_out());

        event.maker_out = 1;
        assert!(event.maker_out());
    }

    #[test]
    fn taker_side_helper() {
        let mut event = FillEvent::default();
        event.taker_side = Side::Bid as u8;
        assert_eq!(event.taker_side(), Side::Bid);

        event.taker_side = Side::Ask as u8;
        assert_eq!(event.taker_side(), Side::Ask);
    }

    #[test]
    fn fill_event_pod_roundtrip() {
        let maker = [3u8; 32];
        let taker = [4u8; 32];
        let original = FillEvent::new(
            Side::Ask,
            false,
            1,
            2000,
            99,
            1900,
            5,
            6,
            1000,
            50,
            maker,
            taker,
        );

        let bytes = bytemuck::bytes_of(&original);
        let recovered: &FillEvent = bytemuck::from_bytes(bytes);

        assert_eq!(recovered.price, original.price);
        assert_eq!(recovered.quantity, original.quantity);
        assert_eq!(recovered.maker_pubkey, original.maker_pubkey);
        assert_eq!(recovered.taker_pubkey, original.taker_pubkey);
        assert_eq!(recovered.maker_out, original.maker_out);
    }
}
