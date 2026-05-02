use pinocchio::{error::ProgramError, AccountView};
use switchboard_on_demand::prelude::rust_decimal::prelude::ToPrimitive;
use switchboard_on_demand::{get_slot, AccountInfo, QuoteVerifier};

// Switchboard still expects AccountInfo (pinocchio ^0.9.x)
// Cast AccountView pointer to AccountInfo to bridge the version gap
unsafe fn as_account_info<'a>(account: &'a AccountView) -> &'a AccountInfo {
    &*(account as *const AccountView as *const AccountInfo)
}

pub struct OracleAccounts<'a> {
    pub quote: &'a AccountView,
    pub queue: &'a AccountView,
    pub clock: &'a AccountView,
    pub slothashes: &'a AccountView,
    pub instructions: &'a AccountView,
}

impl<'a> OracleAccounts<'a> {
    pub fn read_price(&self) -> Result<i64, ProgramError> {
        let quote_data = unsafe {
            QuoteVerifier::new()
                .slothash_sysvar(as_account_info(self.slothashes))
                .ix_sysvar(as_account_info(self.instructions))
                .clock_slot(get_slot(as_account_info(self.clock)))
                .queue(as_account_info(self.queue))
                .max_age(30)
                .verify_account(as_account_info(self.quote))
                .map_err(|_| ProgramError::InvalidAccountData)?
        };

        quote_data.feeds()[0]
            .value()
            .to_i64()
            .ok_or(ProgramError::InvalidAccountData)
    }
}
