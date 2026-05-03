use pinocchio::{error::ProgramError, AccountView, ProgramResult};

use crate::states::StrategyAccount;

pub fn process_pause_strategy(accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    let [signer, strategy_account, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !signer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut data = strategy_account.try_borrow_mut()?;
    let strategy = bytemuck::from_bytes_mut::<StrategyAccount>(&mut data[..StrategyAccount::LEN]);
    if strategy.owner != *signer.address().as_array() {
        return Err(ProgramError::InvalidAccountOwner);
    }
    strategy.status = 1; // Paused
    Ok(())
}
