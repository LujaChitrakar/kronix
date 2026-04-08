use bytemuck::{Pod, Zeroable};
use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use shank::ShankType;

use crate::{
    constants::INSURANCE_SEED,
    helper::{verify_pda, verify_program_id, verify_signer, verify_uninitialized},
    state::InsuranceFund,
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct InitInsuranceFundParams {
    pub bump: u8,
    pub padding: [u8; 7],
}

pub fn process_initialize_insurance_fund(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [payer, insurance_fund, system_program, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(payer)?;
    verify_uninitialized(insurance_fund)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;

    let params = bytemuck::try_from_bytes::<InitInsuranceFundParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let bump_bytes = [params.bump];
    {
        verify_pda(insurance_fund, &[INSURANCE_SEED, &bump_bytes], &crate::ID)?;
    }
    let seeds = [Seed::from(INSURANCE_SEED), Seed::from(bump_bytes.as_ref())];
    CreateAccount {
        from: payer,
        to: insurance_fund,
        space: InsuranceFund::LEN as u64,
        lamports: Rent::get()?.try_minimum_balance(InsuranceFund::LEN)?,
        owner: &Address::from(crate::ID),
    }
    .invoke_signed(&[Signer::from(&seeds)])?;

    {
        let mut data = insurance_fund.try_borrow_mut()?;
        let insurance_fund_state =
            bytemuck::from_bytes_mut::<InsuranceFund>(&mut data[..InsuranceFund::LEN]);

        *insurance_fund_state = InsuranceFund {
            balance: 0,
            total_collected: 0,
            total_paid_out: 0,
            bump: params.bump,
            padding: [0; 7],
            reserved: [0; 32],
        };
    }
    Ok(())
}
