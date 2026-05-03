use bytemuck::{Pod, Zeroable};
use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::{instructions::Transfer, state::TokenAccount};
use shank::ShankType;

use crate::{
    constants::{USER_ACCOUNT_SEED, VAULT_SEED},
    errors::RiskProgramError,
    helper::{verify_account_owner, verify_pda, verify_program_id, verify_signer},
    state::UserAccount,
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct DepositParams {
    pub amount: u64, // USDC native units
    pub bump_user: u8,
    pub bump_vault: u8,
    pub padding: [u8; 6],
}

pub fn process_deposit(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        signer,
        user_account,
        user_token_account, // signer's USDC ATA
        vault,              // program USDC vault
        token_program,
        system_program,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_program_id(token_program, &pinocchio_token::ID)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;

    let params = bytemuck::try_pod_read_unaligned::<DepositParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if params.amount == 0 {
        return Err(RiskProgramError::InvalidAmount.into());
    }

    let signer_key = signer.address().as_array();
    let bump_bytes = [params.bump_user];

    {
        let user_token = TokenAccount::from_account_view(user_token_account)?;
        verify_pda(
            vault,
            &[
                VAULT_SEED,
                user_token.mint().as_array().as_ref(),
                &[params.bump_vault],
            ],
            &crate::ID,
        )?;
        verify_pda(
            user_account,
            &[USER_ACCOUNT_SEED, signer_key.as_ref(), &bump_bytes],
            &crate::ID,
        )?;
    }

    let seeds = [
        Seed::from(USER_ACCOUNT_SEED),
        Seed::from(signer_key.as_ref()),
        Seed::from(&bump_bytes),
    ];
    if user_account.is_data_empty() {
        CreateAccount {
            from: signer,
            to: user_account,
            space: UserAccount::LEN as u64,
            lamports: Rent::get()?.try_minimum_balance(UserAccount::LEN)?,
            owner: &Address::from(crate::ID),
        }
        .invoke_signed(&[Signer::from(&seeds)])?;

        let mut user_account_data = user_account.try_borrow_mut()?;
        let user_account_state =
            bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);
        *user_account_state = UserAccount {
            collateral: 0,
            margin_used: 0,
            bump: params.bump_user,
            position_count: 0,
            padding: [0; 6],
            owner: *signer_key,
            reserved: [0; 32],
        };
    }

    unsafe { verify_account_owner(user_account, &crate::ID)? };

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    if user_account_state.owner != *signer_key {
        return Err(RiskProgramError::InvalidOwner.into());
    }

    Transfer {
        from: user_token_account,
        to: vault,
        amount: params.amount,
        authority: signer,
    }
    .invoke()?;

    user_account_state.collateral = user_account_state
        .collateral
        .checked_add(params.amount as i64)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}
