use bytemuck::{Pod, Zeroable};
use pinocchio::{
    AccountView, ProgramResult,
    cpi::{Seed, Signer},
    error::ProgramError,
};
use pinocchio_token::instructions::Transfer;

use crate::{
    constants::{USER_ACCOUNT_SEED, VAULT_SEED},
    errors::RiskProgramError,
    helper::{verify_initialized, verify_pda, verify_program_id, verify_signer, verify_writtable},
    state::UserAccount,
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct WithdrawParams {
    pub amount: u64,
    pub bump_user: u8,
    pub bump_vault: u8,
    pub padding: [u8; 6],
}

pub fn process_withdraw(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        signer,
        user_account,
        user_token_account,
        vault,
        token_program,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    verify_signer(signer)?;
    verify_program_id(token_program, &pinocchio_token::ID)?;
    verify_initialized(user_account)?;
    verify_writtable(user_account)?;

    let params = bytemuck::try_from_bytes::<WithdrawParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if params.amount == 0 {
        return Err(RiskProgramError::InvalidAmount.into());
    }
    let signer_key = signer.address().as_array();
    let amount = params.amount;

    {
        verify_pda(
            user_account,
            &[USER_ACCOUNT_SEED, signer_key.as_ref(), &[params.bump_user]],
            &crate::ID,
        )?;
        verify_pda(vault, &[VAULT_SEED, &[params.bump_vault]], &crate::ID)?;
    }

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    if user_account_state.owner != *signer_key {
        return Err(RiskProgramError::InvalidOwner.into());
    }

    let free_collateral = user_account_state.free_collateral();

    if (amount as i64) > free_collateral {
        return Err(RiskProgramError::InsufficientCollateral.into());
    }

    user_account_state.collateral = user_account_state
        .collateral
        .checked_sub(amount as i64)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let vault_bump = [params.bump_vault];
    let vault_seed = [Seed::from(VAULT_SEED), Seed::from(vault_bump.as_ref())];

    Transfer {
        from: vault,
        to: user_token_account,
        amount,
        authority: vault,
    }
    .invoke_signed(&[Signer::from(&vault_seed)])?;
    Ok(())
}
