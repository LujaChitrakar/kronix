use pinocchio::{error::ProgramError, AccountView, ProgramResult};

use crate::{errors::StrategyProgramError, helpers::close_account, states::StrategyAccount};

pub fn process_close_strategy(accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    let [signer, strategy_account, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !signer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let data = strategy_account.try_borrow()?;
    let strategy = bytemuck::from_bytes::<StrategyAccount>(&data[..StrategyAccount::LEN]);
    if strategy.owner != *signer.address().as_array() {
        return Err(StrategyProgramError::InvalidOwner.into());
    }
    drop(data);
    close_account(strategy_account, signer)?;

    Ok(())
}
