use bytemuck::{Pod, Zeroable};
use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::InitializeAccount3;
use shank::ShankType;

use crate::{
    constants::{VAULT_AUTHORITY_SEED, VAULT_SEED},
    helper::{verify_pda, verify_program_id, verify_signer, verify_uninitialized},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct InitializeVaultParams {
    pub vault_bump: u8,
    pub authority_bump: u8,
    pub padding: [u8; 6],
}

pub fn process_initialize_vault(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        payer,
        vault,           // SPL token account PDA
        vault_authority, // PDA that signs for vault withdrawals
        mint,            // USDC mint
        token_program,
        system_program,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(payer)?;
    verify_program_id(token_program, &pinocchio_token::ID)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;

    verify_uninitialized(vault)?;

    let params = bytemuck::try_from_bytes::<InitializeVaultParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let vault_bump = [params.vault_bump];
    let authority_bump = [params.authority_bump];

    verify_pda(
        vault,
        &[VAULT_SEED, mint.address().as_array().as_ref(), &vault_bump],
        &crate::ID,
    )?;

    verify_pda(
        vault_authority,
        &[
            VAULT_AUTHORITY_SEED,
            mint.address().as_array().as_ref(),
            &authority_bump,
        ],
        &crate::ID,
    )?;

    let vault_seeds = [
        Seed::from(VAULT_SEED),
        Seed::from(mint.address().as_array().as_ref()),
        Seed::from(vault_bump.as_ref()),
    ];

    // SPL token account = 165 bytes
    let rent = Rent::get()?;
    CreateAccount {
        from: payer,
        to: vault,
        lamports: rent.try_minimum_balance(165)?,
        space: 165,
        owner: &Address::from(pinocchio_token::ID),
    }
    .invoke_signed(&[Signer::from(&vault_seeds)])?;

    InitializeAccount3 {
        account: vault,
        mint,
        owner: vault_authority.address(),
    }
    .invoke()?;

    Ok(())
}
