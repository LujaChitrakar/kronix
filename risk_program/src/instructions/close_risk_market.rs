use bytemuck::{Pod, Zeroable};
use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use shank::ShankType;

use crate::{
    constants::{FUNDING_SEED, MARKET_CONFIG_SEED},
    errors::RiskProgramError,
    helper::{
        close_account, verify_account_owner, verify_initialized, verify_pda, verify_signer,
        verify_writtable,
    },
    state::{FundingState, MarketConfig},
};

#[derive(Pod, Zeroable, Clone, Copy, PartialEq, Eq, ShankType)]
#[repr(C)]
pub struct CloseRiskMarketParams {
    pub market_index: u16,
    pub padding: [u8; 6],
}

pub fn process_close_risk_market(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [admin, market_config, funding_state, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(admin)?;
    verify_writtable(admin)?;
    unsafe {
        verify_account_owner(market_config, &crate::ID)?;
        verify_account_owner(funding_state, &crate::ID)?;
    }
    verify_initialized(market_config)?;
    verify_initialized(funding_state)?;
    verify_writtable(market_config)?;
    verify_writtable(funding_state)?;

    let params = bytemuck::try_pod_read_unaligned::<CloseRiskMarketParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let market_index_bytes = params.market_index.to_le_bytes();

    {
        let market_config_data = market_config.try_borrow()?;
        if market_config_data.len() < MarketConfig::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        let config = bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);
        if config.market_index != params.market_index {
            return Err(RiskProgramError::InvalidMarketIndex.into());
        }
        verify_pda(
            market_config,
            &[
                MARKET_CONFIG_SEED,
                market_index_bytes.as_ref(),
                &[config.bump],
            ],
            &crate::ID,
        )?;
    }
    {
        let funding_data = funding_state.try_borrow()?;
        if funding_data.len() < FundingState::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        let funding = bytemuck::from_bytes::<FundingState>(&funding_data[..FundingState::LEN]);
        if funding.market_index != params.market_index {
            return Err(RiskProgramError::InvalidMarketIndex.into());
        }
        verify_pda(
            funding_state,
            &[FUNDING_SEED, market_index_bytes.as_ref(), &[funding.bump]],
            &crate::ID,
        )?;
    }
    close_account(funding_state, admin)?;
    close_account(market_config, admin)?;
    Ok(())
}
