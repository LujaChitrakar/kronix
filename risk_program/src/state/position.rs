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

    pub fn unrealised_pnl(&self, mark_price: i64, quote_lot_size: i64) -> Option<i64> {
        let size = self.size as i128;
        let price_diff = (mark_price as i128).checked_sub(self.entry_price as i128)?;
        let quote_lot = quote_lot_size as i128;

        let pnl = if self.is_long() {
            size.checked_mul(price_diff)?.checked_mul(quote_lot)?
        } else {
            size.checked_mul(price_diff.checked_neg()?)?
                .checked_mul(quote_lot)?
        };

        if pnl > i64::MAX as i128 {
            Some(i64::MAX)
        } else if pnl < i64::MIN as i128 {
            Some(i64::MIN)
        } else {
            Some(pnl as i64)
        }
    }

    pub fn liquidation_price(&self, collateral: i64, maintenance_margin_bps: u16) -> Option<i64> {
        if self.size == 0 {
            return Some(0);
        }

        let initial_margin = self.initial_margin as i128;
        let maintenance_margin = initial_margin
            .checked_mul(maintenance_margin_bps as i128)?
            .checked_div(10_000)?;

        let buffer = (collateral as i128).checked_sub(maintenance_margin)?;
        let size_abs = self.size.unsigned_abs() as i128;
        let price_move = buffer.checked_div(size_abs)?;

        let liq_price = if self.is_long() {
            (self.entry_price as i128).checked_sub(price_move)?
        } else {
            (self.entry_price as i128).checked_add(price_move)?
        };

        if liq_price > i64::MAX as i128 {
            Some(i64::MAX)
        } else if liq_price < 0 {
            Some(0) // can't be negative
        } else {
            Some(liq_price as i64)
        }
    }
}
