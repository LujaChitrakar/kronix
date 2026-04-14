use pinocchio::{AccountView, ProgramResult, error::ProgramError};

use crate::{errors::StrategyProgramError, states::StrategyAccount};

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
    let dest_lamports = signer.lamports();
    let src_lamports = strategy_account.lamports();
    signer.set_lamports(dest_lamports + src_lamports);
    strategy_account.set_lamports(0);

    strategy_account.try_borrow_mut()?.fill(0);
    Ok(())
}
