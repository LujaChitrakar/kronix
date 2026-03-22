use crate::states::{Side, new_node_key};
use bytemuck::{Pod, Zeroable};

#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct MarketState {
    // Identity
    pub market_index: u16,
    pub bump: u8,
    pub paused: u8, // add paused here
    pub padding: [u8; 4],
    pub name: [u8; 16],

    // Account refs — pubkeys of associated accounts
    pub bids: [u8; 32],
    pub asks: [u8; 32],

    // Lot sizes — set at market creation, never change
    pub base_lot_size: i64,  // base native per lot e.g. 100 = 0.0001 SOL
    pub quote_lot_size: i64, // quote native per lot e.g. 1 = 0.000001 USDC

    // Order ID generation — monotonically increasing
    pub seq_num: u64,

    // Market status
    pub registration_ts: i64,
    pub time_expiry: i64, // 0 = never expires

    pub reserved: [u8; 64],
}

const _: () =
    assert!(size_of::<MarketState>() == 2 + 1 + 5 + 16 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 64);
const _: () = assert!(size_of::<MarketState>() % 8 == 0);

impl MarketState {
    pub fn name(&self) -> &str {
        std::str::from_utf8(&self.name)
            .unwrap()
            .trim_matches(char::from(0))
    }

    pub fn is_expired(&self, timestamp: i64) -> bool {
        self.time_expiry != 0 && self.time_expiry <= timestamp
    }

    pub fn is_paused(&self) -> bool {
        self.paused == 1
    }

    pub fn is_active(&self, timestamp: i64) -> bool {
        !self.is_paused() && !self.is_expired(timestamp)
    }

    pub fn generate_order_id(&mut self, side: Side, price_data: u64) -> u128 {
        self.seq_num += 1;
        new_node_key(side, price_data, self.seq_num)
    }

    pub fn max_base_lots(&self) -> i64 {
        i64::MAX / self.base_lot_size
    }

    pub fn max_quote_lots(&self) -> i64 {
        i64::MAX / self.quote_lot_size
    }

    //inverse conversion, useful for UI/logging
    pub fn lot_to_native_price(&self, price_lots: i64) -> Option<i64> {
        price_lots
            .checked_mul(self.quote_lot_size)
            .map(|x| x / self.base_lot_size)
    }

    /// Convert base lots to native units
    pub fn base_lots_to_native(&self, lots: i64) -> i64 {
        lots.checked_mul(self.base_lot_size)
            .expect("base lots overflow")
    }

    /// Convert quote lots to native units
    pub fn quote_lots_to_native(&self, lots: i64) -> i64 {
        lots.checked_mul(self.quote_lot_size)
            .expect("quote lots overflow")
    }

    /// Convert native base to lots — floors
    pub fn native_to_base_lots(&self, native: i64) -> i64 {
        native / self.base_lot_size
    }

    /// Convert native quote to lots — floors
    pub fn native_to_quote_lots(&self, native: i64) -> i64 {
        native / self.quote_lot_size
    }
}

#[cfg(test)]
mod tests {
    use crate::states::fixed_price_data;

    use super::*;

    fn make_market(base_lot_size: i64, quote_lot_size: i64) -> MarketState {
        let mut m = MarketState::zeroed();
        m.base_lot_size = base_lot_size;
        m.quote_lot_size = quote_lot_size;
        m.seq_num = 0;
        m.time_expiry = 0;
        m
    }

    #[test]
    fn market_size() {
        assert_eq!(core::mem::size_of::<MarketState>(), 192);
        assert_eq!(core::mem::size_of::<MarketState>() % 8, 0);
    }

    #[test]
    fn never_expires_when_time_expiry_zero() {
        let m = make_market(1, 1);
        assert!(!m.is_expired(0));
        assert!(!m.is_expired(i64::MAX));
    }

    #[test]
    fn expires_after_time_expiry() {
        let mut m = make_market(1, 1);
        m.time_expiry = 1000;

        assert!(!m.is_expired(999));
        assert!(m.is_expired(1000));
        assert!(m.is_expired(9999));
    }

    #[test]
    fn paused_flag() {
        let mut m = make_market(1, 1);
        assert!(!m.is_paused());

        m.paused = 1;
        assert!(m.is_paused());
    }

    #[test]
    fn active_when_not_paused_and_not_expired() {
        let m = make_market(1, 1);
        assert!(m.is_active(0));
    }

    #[test]
    fn gen_order_id_increments_seq_num() {
        let mut m = make_market(1, 1);
        assert_eq!(m.seq_num, 0);

        let price_data = fixed_price_data(100).unwrap();
        m.generate_order_id(Side::Bid, price_data);
        assert_eq!(m.seq_num, 1);

        m.generate_order_id(Side::Ask, price_data);
        assert_eq!(m.seq_num, 2);
    }
    #[test]
    fn gen_order_id_unique_per_call() {
        let mut m = make_market(1, 1);
        let price_data = fixed_price_data(100).unwrap();

        let id1 = m.generate_order_id(Side::Bid, price_data);
        let id2 = m.generate_order_id(Side::Bid, price_data);
        assert_ne!(id1, id2);
    }

    #[test]
    fn max_lots_no_overflow() {
        let m = make_market(100, 10);
        assert_eq!(m.max_base_lots(), i64::MAX / 100);
        assert_eq!(m.max_quote_lots(), i64::MAX / 10);
    }

    #[test]
    fn base_lots_to_native() {
        let m = make_market(100, 1);
        assert_eq!(m.base_lots_to_native(10), 1000);
        assert_eq!(m.base_lots_to_native(0), 0);
        assert_eq!(m.base_lots_to_native(1), 100);
    }

    #[test]
    fn quote_lots_to_native() {
        let m = make_market(1, 10);
        assert_eq!(m.quote_lots_to_native(5), 50);
        assert_eq!(m.quote_lots_to_native(0), 0);
        assert_eq!(m.quote_lots_to_native(1), 10);
    }

    #[test]
    fn native_to_base_lots_floors() {
        let m = make_market(100, 1);
        assert_eq!(m.native_to_base_lots(100), 1);
        assert_eq!(m.native_to_base_lots(150), 1); // floors
        assert_eq!(m.native_to_base_lots(200), 2);
        assert_eq!(m.native_to_base_lots(0), 0);
    }

    #[test]
    fn native_to_quote_lots_floors() {
        let m = make_market(1, 10);
        assert_eq!(m.native_to_quote_lots(10), 1);
        assert_eq!(m.native_to_quote_lots(15), 1); // floors
        assert_eq!(m.native_to_quote_lots(20), 2);
    }

    #[test]
    fn name_trims_null_bytes() {
        let mut m = make_market(1, 1);
        let name = b"BTC-PERP";
        m.name[..name.len()].copy_from_slice(name);

        assert_eq!(m.name(), "BTC-PERP");
    }

    #[test]
    fn empty_name_returns_empty_str() {
        let m = make_market(1, 1);
        assert_eq!(m.name(), "");
    }
}
