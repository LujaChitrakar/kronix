use pinocchio::{error::ProgramError, AccountView};
use switchboard_on_demand::{get_slot, AccountInfo, QuoteVerifier};

use crate::constants::{SB_MAX_QUOTE_AGE_SLOTS, SB_PRICE_DIVISOR, SB_QUEUE, SOL_USD_FEED_HASH};

// Switchboard SDK was compiled against pinocchio 0.9.x's `AccountInfo`.
// This crate uses pinocchio 0.10.x's `AccountView`. Both are `#[repr(C)]`
// single-pointer wrappers around an identical-layout raw account struct
// (borrow_state/is_signer/is_writable/executable/resize_delta + key/owner/
// lamports/data_len), so the pointer cast is layout-safe.
unsafe fn as_account_info<'a>(account: &'a AccountView) -> &'a AccountInfo {
    &*(account as *const AccountView as *const AccountInfo)
}

pub struct OracleAccounts<'a> {
    pub queue: &'a AccountView,
    pub clock: &'a AccountView,
    pub slothashes: &'a AccountView,
    pub instructions: &'a AccountView,
}

impl<'a> OracleAccounts<'a> {
    /// Verifies the Switchboard Ed25519 sigverify instruction at index
    /// `ed25519_ix_idx` of the current transaction and returns the SOL/USD
    /// price scaled by 10^6 (matching risk_program's price scale).
    ///
    /// The keeper must include the Ed25519 ix produced by
    /// `queue.fetchQuoteIx(crossbar, [SOL_USD_FEED_HASH], { instructionIdx })`
    /// at that index in the same transaction.
    pub fn read_price(&self, ed25519_ix_idx: u8) -> Result<i64, ProgramError> {
        if self.queue.address().as_array() != &SB_QUEUE {
            return Err(ProgramError::InvalidAccountData);
        }

        let quote_data = unsafe {
            QuoteVerifier::new()
                .slothash_sysvar(as_account_info(self.slothashes))
                .ix_sysvar(as_account_info(self.instructions))
                .clock_slot(get_slot(as_account_info(self.clock)))
                .queue(as_account_info(self.queue))
                .max_age(SB_MAX_QUOTE_AGE_SLOTS)
                .verify_instruction_at(ed25519_ix_idx as i64)
                .map_err(|_| ProgramError::InvalidAccountData)?
        };

        let feeds = quote_data.feeds();
        if feeds.is_empty() {
            return Err(ProgramError::InvalidAccountData);
        }
        let feed = &feeds[0];
        if feed.feed_id() != &SOL_USD_FEED_HASH {
            return Err(ProgramError::InvalidAccountData);
        }

        let scaled = feed
            .feed_value()
            .checked_div(SB_PRICE_DIVISOR)
            .ok_or(ProgramError::InvalidAccountData)?;
        i64::try_from(scaled).map_err(|_| ProgramError::InvalidAccountData)
    }
}
