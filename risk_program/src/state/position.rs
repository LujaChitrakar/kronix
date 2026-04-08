use std::i64;

use bytemuck::{Pod, Zeroable};
use shank::ShankAccount;

#[derive(Pod, Zeroable, Copy, Clone, ShankAccount)]
#[repr(C)]
pub struct Position {
    pub size: i64,                // base lots
    pub entry_price: i64,         // price lots at entry
    pub entry_funding_index: i64, // snapshot of FundingState::cumulative_index
    pub initial_margin: i64,      // locked margin in USDC native
    pub market_index: u16,
    pub bump: u8,
    pub side: u8, // 0=long, 1=short
    pub padding: [u8; 4],
    pub owner: [u8; 32],
    pub reserved: [u8; 32],
}

const _: () = assert!(size_of::<Position>() == 8 + 8 + 8 + 8 + 2 + 1 + 1 + 4 + 32 + 32);
const _: () = assert!(size_of::<Position>() % 8 == 0);

impl Position {
    pub const LEN: usize = size_of::<Position>();

    pub fn is_long(&self) -> bool {
        self.side == 0
    }

    pub fn is_short(&self) -> bool {
        self.side == 1
    }

    pub fn unrealised_pnl(&self, mark_price: i64, quote_lot_size: i64) -> i64 {
        let price_diff = mark_price - self.entry_price;
        let pnl_lots = if self.is_long() {
            self.size * price_diff
        } else {
            self.size * (-price_diff)
        };
        pnl_lots.checked_mul(quote_lot_size).unwrap_or(i64::MIN)
    }

    pub fn liquidation_price(
        &self,
        collateral: i64,
        mainteinance_margin_bps: u16,
        // quote_lot_size: i64,
        // base_lot_size: i64,
    ) -> i64 {
        if self.size == 0 {
            return 0;
        }

        let maintenance_margin =
            self.initial_margin as i128 * mainteinance_margin_bps as i128 / 10_000;
        let buffer = collateral as i128 - maintenance_margin;

        let price_move = buffer.checked_div(self.size.abs() as i128).unwrap_or(0);

        if self.is_long() {
            (self.entry_price as i128 - price_move) as i64
        } else {
            (self.entry_price as i128 + price_move) as i64
        }
    }
}
