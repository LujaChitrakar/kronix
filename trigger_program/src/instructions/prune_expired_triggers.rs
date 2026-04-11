use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{helpers::verify_signer, states::TriggerOrder};

pub fn prune_expired_triggers(accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    let [keeper, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(keeper)?;

    let clock = Clock::get()?;

    for account in _remaining {
        unsafe {
            if account.owner() != &Address::from(crate::ID) {
                continue;
            }
            if account.is_data_empty() {
                continue;
            }

            let mut data = match account.try_borrow_mut() {
                Ok(d) => d,
                Err(_) => continue,
            };

            let order = bytemuck::from_bytes_mut::<TriggerOrder>(&mut data[..TriggerOrder::LEN]);

            if order.is_active() && order.is_expired(clock.unix_timestamp) {
                order.status = 2; // Cancelled
            }
        }
    }
    Ok(())
}
