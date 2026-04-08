use bytemuck::{Pod, Zeroable};
use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use shank::ShankType;

use crate::{
    constants::{FUNDING_SEED, MARKET_CONFIG_SEED},
    errors::RiskProgramError,
    helper::{verify_pda, verify_program_id, verify_signer, verify_uninitialized},
    state::{FundingState, MarketConfig},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct CreateMarketParams {
    pub base_lot_size: i64,
    pub quote_lot_size: i64,
    pub market_index: u16,
    pub initial_margin_bps: u16,
    pub maintenance_margin_bps: u16,
    pub liquidation_fee_bps: u16,
    pub bump_config: u8,
    pub bump_funding: u8,
    pub max_leverage: u8,
    pub padding: [u8; 5],
    pub oracle: [u8; 32],
}

pub fn process_create_market(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [payer, market_config, funding_state, system_program, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    verify_signer(payer)?;
    verify_uninitialized(market_config)?;
    verify_uninitialized(funding_state)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;

    let params = bytemuck::try_pod_read_unaligned::<CreateMarketParams>(data)
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

    let market_index_bytes = params.market_index.to_le_bytes();
    let bump_config_bytes = [params.bump_config];
    let bump_funding_bytes = [params.bump_funding];

    {
        verify_pda(
            market_config,
            &[
                MARKET_CONFIG_SEED,
                market_index_bytes.as_ref(),
                &bump_config_bytes,
            ],
            &crate::ID,
        )?;
        verify_pda(
            funding_state,
            &[
                FUNDING_SEED,
                market_index_bytes.as_ref(),
                &bump_funding_bytes,
            ],
            &crate::ID,
        )?;
    }

    let rent = Rent::get()?;
    let clock = Clock::get()?;

    let market_config_seeds = [
        Seed::from(MARKET_CONFIG_SEED),
        Seed::from(market_index_bytes.as_ref()),
        Seed::from(bump_config_bytes.as_ref()),
    ];
    let funding_seeds = [
        Seed::from(FUNDING_SEED),
        Seed::from(market_index_bytes.as_ref()),
        Seed::from(bump_funding_bytes.as_ref()),
    ];

    CreateAccount {
        from: payer,
        to: market_config,
        space: MarketConfig::LEN as u64,
        lamports: rent.try_minimum_balance(MarketConfig::LEN)?,
        owner: &Address::from(crate::ID),
    }
    .invoke_signed(&[Signer::from(&market_config_seeds)])?;
    CreateAccount {
        from: payer,
        to: funding_state,
        space: FundingState::LEN as u64,
        lamports: rent.try_minimum_balance(FundingState::LEN)?,
        owner: &Address::from(crate::ID),
    }
    .invoke_signed(&[Signer::from(&funding_seeds)])?;

    {
        let mut market_config_data = market_config.try_borrow_mut()?;
        let market_config_state =
            bytemuck::from_bytes_mut::<MarketConfig>(&mut market_config_data[..MarketConfig::LEN]);

        *market_config_state = MarketConfig {
            base_lot_size: params.base_lot_size,
            quote_lot_size: params.quote_lot_size,
            market_index: params.market_index,
            initial_margin_bps: params.initial_margin_bps,
            maintenance_margin_bps: params.maintenance_margin_bps,
            liquidation_fee_bps: params.liquidation_fee_bps,
            bump: params.bump_config,
            max_leverage: params.max_leverage,
            padding: [0; 6],
            oracle: params.oracle,
            reserved: [0; 32],
        };
    }

    {
        let mut funding_data = funding_state.try_borrow_mut()?;
        let funding =
            bytemuck::from_bytes_mut::<FundingState>(&mut funding_data[..FundingState::LEN]);
        *funding = FundingState {
            cumulative_index: 0,
            last_funding_rate: 0,
            last_updated: clock.unix_timestamp,
            market_index: params.market_index,
            bump: params.bump_funding,
            padding: [0; 5],
            reserved: [0; 32],
        };
    }

    Ok(())
}
