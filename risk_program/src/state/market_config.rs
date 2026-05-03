use bytemuck::{Pod, Zeroable};
use shank::ShankAccount;

pub const QUOTE_NATIVE_UNIT: i128 = 1_000_000;

#[derive(Pod, Zeroable, Copy, Clone, ShankAccount)]
#[repr(C)]
pub struct MarketConfig {
    pub base_lot_size: i64,  // base native per lot
    pub quote_lot_size: i64, // quote native per lot
    pub market_index: u16,
    pub initial_margin_bps: u16,     // e.g. 1000 = 10%
    pub maintenance_margin_bps: u16, // e.g. 500 = 5%
    pub liquidation_fee_bps: u16,    // e.g. 100 = 1%
    pub bump: u8,
    pub max_leverage: u8, // e.g. 20 = 20x max
    pub padding: [u8; 6],
    pub oracle: [u8; 32], // Switchboard price feed pubkey
    pub reserved: [u8; 32],
}

const _: () = assert!(size_of::<MarketConfig>() == 8 + 8 + 2 + 2 + 2 + 2 + 1 + 1 + 6 + 32 + 32);
const _: () = assert!(size_of::<MarketConfig>() % 8 == 0);

impl MarketConfig {
    pub const LEN: usize = size_of::<MarketConfig>();

    pub fn required_initial_margin(&self, size_lots: i64, price_lots: i64) -> i64 {
        let notional = (size_lots.abs() as i128)
            .saturating_mul(price_lots as i128)
            .saturating_mul(self.quote_lot_size as i128);

        (notional * self.initial_margin_bps as i128 / 10_000) as i64
    }

    pub fn notional_value(&self, size_lots: i64, price_lots: i64) -> i64 {
        let notional = (size_lots.abs() as i128)
            .saturating_mul(price_lots as i128)
            .saturating_mul(QUOTE_NATIVE_UNIT);

        notional as i64
    }

    pub fn required_maintenance_margin(&self, size_lots: i64, price_lots: i64) -> i64 {
        let notional = (size_lots.abs() as i128)
            .saturating_mul(price_lots as i128)
            .saturating_mul(self.quote_lot_size as i128);

        (notional * self.maintenance_margin_bps as i128 / 10_000) as i64
    }

    pub fn liquidation_fee(&self, size_lots: i64, price_lots: i64) -> i64 {
        let notional = (size_lots.abs() as i128)
            .saturating_mul(price_lots as i128)
            .saturating_mul(self.quote_lot_size as i128);

        (notional * self.liquidation_fee_bps as i128 / 10_000) as i64
    }
}
