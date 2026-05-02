use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;

use crate::{
    errors::RiskProgramError,
    helper::{verify_account_owner, verify_initialized, verify_signer, verify_writtable},
    instructions::settle_funding_internal,
    oracle::validate_switchboard_price,
    state::{FundingState, MarketConfig, Position, UserAccount},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct ClosePositionParams {
    pub size_lots: i64, // how many lots to close, 0 = close all
    pub market_index: u16,
    pub padding: [u8; 6],
}

pub fn process_close_position(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, user_account, position, market_config, funding_state, oracle, _remaining @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_initialized(position)?;
    verify_initialized(user_account)?;
    verify_initialized(market_config)?;
    verify_initialized(funding_state)?;
    verify_writtable(user_account)?;
    verify_writtable(position)?;
    unsafe {
        verify_account_owner(user_account, &crate::ID)?;
        verify_account_owner(market_config, &crate::ID)?;
        verify_account_owner(position, &crate::ID)?;
        verify_account_owner(funding_state, &crate::ID)?;
    }

    let params = bytemuck::try_pod_read_unaligned::<ClosePositionParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let clock = Clock::get()?;
    let signer_key = signer.address().as_array();

    let market_config_data = market_config.try_borrow()?;
    let market_config_state =
        bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);

    if market_config_state.market_index != params.market_index {
        return Err(ProgramError::InvalidInstructionData);
    }
    // uncomment later on first testing without oracle
    let mark_price_native = validate_switchboard_price(oracle, params.market_index, clock.slot)?;
    let mark_price = mark_price_native
        .checked_div(market_config_state.quote_lot_size)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if mark_price <= 0 {
        return Err(RiskProgramError::InvalidOraclePrice.into());
    }

    let mut position_data = position.try_borrow_mut()?;
    let position_state = bytemuck::from_bytes_mut::<Position>(&mut position_data[..Position::LEN]);

    if position_state.owner != *signer_key {
        return Err(RiskProgramError::InvalidOwner.into());
    }
    if position_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }
    if position_state.size == 0 {
        return Err(RiskProgramError::InvalidPositionSize.into());
    }

    let close_size = if params.size_lots == 0 {
        position_state.size
    } else {
        if params.size_lots > position_state.size {
            return Err(RiskProgramError::InvalidPositionSize.into());
        }
        params.size_lots
    };

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    if user_account_state.owner != *signer_key {
        return Err(RiskProgramError::InvalidOwner.into());
    }

    let mut funding_data = funding_state.try_borrow_mut()?;
    let funding_state =
        bytemuck::from_bytes_mut::<FundingState>(&mut funding_data[..FundingState::LEN]);

    // settle funding before closing position
    settle_funding_internal(
        user_account_state,
        position_state,
        funding_state,
        market_config_state.quote_lot_size,
    )?;

    let price_diff = mark_price
        .checked_sub(position_state.entry_price)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let realised_pnl_i128 = if position_state.is_long() {
        // long profit when price go up
        (close_size as i128)
            .checked_mul(price_diff as i128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_mul(market_config_state.quote_lot_size as i128)
            .ok_or(ProgramError::ArithmeticOverflow)?
    } else {
        // short profit when price go down
        (close_size as i128)
            .checked_mul(-price_diff as i128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_mul(market_config_state.quote_lot_size as i128)
            .ok_or(ProgramError::ArithmeticOverflow)?
    };
    let realised_pnl =
        i64::try_from(realised_pnl_i128).map_err(|_| ProgramError::ArithmeticOverflow)?;

    // margin to release
    let margin_to_release = if close_size == position_state.size {
        position_state.initial_margin
    } else {
        (position_state.initial_margin as i128)
            .checked_mul(close_size as i128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(position_state.size as i128)
            .ok_or(ProgramError::ArithmeticOverflow)? as i64
    };

    // realise pnl to collateral and update user account
    user_account_state.collateral = user_account_state
        .collateral
        .checked_add(realised_pnl)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    user_account_state.margin_used = user_account_state
        .margin_used
        .saturating_sub(margin_to_release);

    // update or close position
    if close_size == position_state.size {
        // full close
        position_state.size = 0;
        position_state.initial_margin = 0;
        user_account_state.position_count = user_account_state.position_count.saturating_sub(1);
    } else {
        position_state.size = position_state
            .size
            .checked_sub(close_size)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        position_state.initial_margin = position_state
            .initial_margin
            .checked_sub(margin_to_release)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    Ok(())
}
