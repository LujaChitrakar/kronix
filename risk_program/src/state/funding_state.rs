use bytemuck::{Pod, Zeroable};
use shank::ShankAccount;

#[derive(Pod, Zeroable, Copy, Clone, ShankAccount)]
#[repr(C)]
pub struct FundingState {
    pub cumulative_index: i64,  // grows every funding period
    pub last_funding_rate: i64, // most recent rate in bps
    pub last_updated: i64,      // unix timestamp
    pub market_index: u16,
    pub bump: u8,
    pub padding: [u8; 5],
    pub reserved: [u8; 32],
}

const _: () = assert!(size_of::<FundingState>() == 8 + 8 + 8 + 2 + 1 + 5 + 32);
const _: () = assert!(size_of::<FundingState>() % 8 == 0);

impl FundingState {
    pub const LEN: usize = size_of::<FundingState>();
    /// Funding owed by a position since it was opened
    /// Returns USDC native units — positive = trader pays, negative = trader receives
    pub fn funding_owed(
        &self,
        position_size: i64,
        entry_funding_index: i64,
        quote_lot_size: i64,
    ) -> i64 {
        let index_diff = self.cumulative_index.saturating_sub(entry_funding_index);

        // funding = size * index_diff * quote_lot_size
        // longs pay positive funding, shorts receive it
        (position_size as i128)
            .saturating_mul(index_diff as i128)
            .saturating_mul(quote_lot_size as i128) as i64
    }

    /// Update cumulative index with new funding rate
    /// rate_bps: funding rate in basis points (e.g. 10 = 0.1%)
    pub fn apply_funding_rate(&mut self, rate_bps: i64, now_ts: i64) {
        self.cumulative_index = self.cumulative_index.saturating_add(rate_bps);
        self.last_funding_rate = rate_bps;
        self.last_updated = now_ts;
    }
}
