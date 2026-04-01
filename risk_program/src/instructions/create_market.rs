use bytemuck::{Pod, Zeroable};
use pinocchio::{AccountView, ProgramResult, error::ProgramError};

use crate::{
    errors::RiskProgramError,
    helper::{verify_program_id, verify_signer, verify_uninitialized},
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct CreateMarketParams {
    pub market_index: u16,
    pub initial_margin_bps: u16,
    pub maintenance_margin_bps: u16,
    pub liquidation_fee_bps: u16,
    pub base_lot_size: i64,
    pub quote_lot_size: i64,
    pub bump_config: u8,
    pub bump_funding: u8,
    pub max_leverage: u8,
    pub padding: [u8; 5],
    pub oracle: [u8; 32],
}

pub fn process_create_market(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        payer,
        market_config,
        funding_state,
        system_program,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    verify_signer(payer)?;
    verify_uninitialized(market_config)?;
    verify_uninitialized(funding_state)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;

    let params = bytemuck::try_from_bytes::<CreateMarketParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if params.base_lot_size <= 0 || params.quote_lot_size <= 0 {
        return Err(RiskProgramError::InvalidAmount.into());
    }
    if params.max_leverage == 0 || params.max_leverage > 100 {
        return Err(RiskProgramError::ExceedsMaxLeverage.into());
    }
    if params.initial_margin_bps < params.maintenance_margin_bps {
        return Err(RiskProgramError::InvalidAmount.into());
    }
    
    
    Ok(())
}
