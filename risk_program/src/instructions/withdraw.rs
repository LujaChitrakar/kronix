use bytemuck::{Pod, Zeroable};
use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, ProgramResult,
};
use pinocchio_token::{instructions::Transfer, state::TokenAccount};
use shank::ShankType;

use crate::{
    constants::{USER_ACCOUNT_SEED, VAULT_AUTHORITY_SEED, VAULT_SEED},
    errors::RiskProgramError,
    helper::{verify_initialized, verify_pda, verify_program_id, verify_signer, verify_writtable},
    state::UserAccount,
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct WithdrawParams {
    pub amount: u64,
    pub bump_user: u8,
    pub bump_vault: u8,
    pub bump_authority: u8,
    pub padding: [u8; 5],
}

pub fn process_withdraw(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, user_account, user_token_account, vault, vault_authority, token_program, _remaining @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    verify_signer(signer)?;
    verify_program_id(token_program, &pinocchio_token::ID)?;
    verify_initialized(user_account)?;
    verify_writtable(user_account)?;

    let params = bytemuck::try_pod_read_unaligned::<WithdrawParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if params.amount == 0 {
        return Err(RiskProgramError::InvalidAmount.into());
    }
    let signer_key = signer.address().as_array();
    let amount = params.amount;
    let token_mint = {
        let user_token = TokenAccount::from_account_view(user_token_account)?;
        *user_token.mint().as_array()
    };

    {
        verify_pda(
            user_account,
            &[USER_ACCOUNT_SEED, signer_key.as_ref(), &[params.bump_user]],
            &crate::ID,
        )?;
        verify_pda(
            vault,
            &[VAULT_SEED, token_mint.as_ref(), &[params.bump_vault]],
            &crate::ID,
        )?;
        verify_pda(
            vault_authority,
            &[
                VAULT_AUTHORITY_SEED,
                token_mint.as_ref(),
                &[params.bump_authority],
            ],
            &crate::ID,
        )?;
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

    let vault_authority_bump = [params.bump_authority];
    let vault_authority_seed = [
        Seed::from(VAULT_AUTHORITY_SEED),
        Seed::from(token_mint.as_ref()),
        Seed::from(vault_authority_bump.as_ref()),
    ];

    Transfer {
        from: vault,
        to: user_token_account,
        amount,
        authority: vault_authority,
    }
    .invoke_signed(&[Signer::from(&vault_authority_seed)])?;
    Ok(())
}
