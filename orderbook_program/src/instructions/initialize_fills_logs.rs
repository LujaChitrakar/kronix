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
    constants::FILLS_LOG_SEED,
    helper::{
        verify_initialized, verify_pda, verify_program_id, verify_signer, verify_uninitialized,
    },
    states::FillsLog,
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct InitializeFillsLogParams {
    pub bump: u8,
    pub padding: [u8; 7],
    pub client_order_id: u64,
}

pub fn process_initialize_fills_logs(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, fills_log, market, system_program, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    verify_signer(signer)?;
    verify_uninitialized(fills_log)?;
    verify_initialized(market)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;

    let params = bytemuck::try_from_bytes::<InitializeFillsLogParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let signer_key = signer.address().as_array();
    let market_key = market.address().as_array();
    let client_id_bytes = params.client_order_id.to_le_bytes();
    let bump_bytes = [params.bump];

    verify_pda(
        fills_log,
        &[
            FILLS_LOG_SEED,
            signer_key.as_ref(),
            client_id_bytes.as_ref(),
            &bump_bytes,
        ],
        &crate::ID,
    )?;

    let seeds = [
        Seed::from(FILLS_LOG_SEED),
        Seed::from(signer_key.as_ref()),
        Seed::from(client_id_bytes.as_ref()),
        Seed::from(bump_bytes.as_ref()),
    ];

    CreateAccount {
        from: signer,
        to: fills_log,
        lamports: Rent::get()?.try_minimum_balance(FillsLog::LEN)?,
        space: FillsLog::LEN as u64,
        owner: &Address::from(crate::ID),
    }
    .invoke_signed(&[Signer::from(&seeds)])?;

    {
        let mut log_data = fills_log.try_borrow_mut()?;
        let log = bytemuck::from_bytes_mut::<FillsLog>(&mut log_data[..FillsLog::LEN]);
        *log = FillsLog {
            market: *market_key,
            taker: *signer_key,
            client_order_id: params.client_order_id,
            created_slot: 0,
            fill_count: 0,
            all_settled: 1, // ready to use
            bump: params.bump,
            padding: [0; 5],
            fills: [bytemuck::Zeroable::zeroed(); 8],
            reserved: [0; 32],
        };
    }

    Ok(())
}
