use bytemuck::{Pod, Zeroable};
use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_token::instructions::Transfer;
use shank::ShankType;

use crate::{
    constants::VAULT_SEED,
    errors::RiskProgramError,
    helper::{verify_account_owner, verify_pda, verify_program_id, verify_signer},
    state::InsuranceFund,
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct DepositInsuranceParams {
    pub amount: u64, // USDC native units
    pub bump_vault: u8,
    pub padding: [u8; 7],
}

pub fn process_deposit_insurance(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        signer,
        insurance_fund,
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

    let params = bytemuck::try_pod_read_unaligned::<DepositInsuranceParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if params.amount == 0 {
        return Err(RiskProgramError::InvalidAmount.into());
    }

    let vault_bump = [params.bump_vault];

    unsafe { verify_account_owner(insurance_fund, &crate::ID)? };

    verify_pda(vault, &[VAULT_SEED, &vault_bump], &crate::ID)?;

    let mut insurance_fund_data = insurance_fund.try_borrow_mut()?;
    let insurance_fund_state =
        bytemuck::from_bytes_mut::<InsuranceFund>(&mut insurance_fund_data[..InsuranceFund::LEN]);

    Transfer {
        from: user_token_account,
        to: vault,
        amount: params.amount,
        authority: signer,
    }
    .invoke()?;

    insurance_fund_state.balance = insurance_fund_state
        .balance
        .checked_add(params.amount as u64)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}
