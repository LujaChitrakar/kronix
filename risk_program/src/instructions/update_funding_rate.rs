use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;

use crate::{
    constants::{FUNDING_INTERVAL_SECS, FUNDING_PERIOD_SECS, MAX_FUNDING_RATE_BPS},
    errors::RiskProgramError,
    helper::{verify_account_owner, verify_signer, verify_writtable},
    math::funding_rate_bps,
    oracle::validate_switchboard_price,
    state::{FundingState, MarketConfig},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct UpdateFundingRateParams {
    pub mark_price: i64, // off-chain computed mark price in price lots . Must be close to oracle — validated on-chain
    pub market_index: u16,
    pub padding: [u8; 6],
}

pub fn process_update_funding_rate(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        cranker, // permissionless — any signer
        market_config,
        funding_state,
        oracle, // Switchboard price feed
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(cranker)?;
    unsafe {
        verify_account_owner(market_config, &crate::ID)?;
        verify_account_owner(funding_state, &crate::ID)?;
        verify_writtable(funding_state)?;
    }
    let params = bytemuck::try_pod_read_unaligned::<UpdateFundingRateParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let clock = Clock::get()?;
    let now_ts = clock.unix_timestamp;

    let market_config_data = market_config.try_borrow()?;
    let market_config_state =
        bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);

    if market_config_state.market_index != params.market_index {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut funding_data = funding_state.try_borrow_mut()?;
    let funding = bytemuck::from_bytes_mut::<FundingState>(&mut funding_data[..FundingState::LEN]);

    if funding.market_index != params.market_index {
        return Err(ProgramError::InvalidInstructionData);
    }

    let elapsed_time = now_ts
        .checked_sub(funding.last_updated)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    if elapsed_time < FUNDING_INTERVAL_SECS {
        return Err(RiskProgramError::FundingNotDue.into());
    }

    let clamped_elapsed = elapsed_time.min(FUNDING_INTERVAL_SECS);

    // uncomment after oracle integration
    let index_price = validate_switchboard_price(oracle, params.market_index, clock.slot)?;
    // let index_price = validated.price;
    // let index_price = 1000;

    // ── Validate mark price is reasonable ─────────────────────────
    // Mark price passed by cranker must be within 5% of oracle
    // Prevents cranker from manipulating funding rate
    let max_deviation_bps = 500i64;
    let price_diff = (params.mark_price - index_price).abs();
    let deviation_bps = price_diff as i128 * 10_000 / index_price as i128;

    if deviation_bps > max_deviation_bps as i128 {
        return Err(RiskProgramError::InvalidOraclePrice.into());
    }

    // calculate funding rate
    let rate_bps = funding_rate_bps(params.mark_price, index_price);

    let clamped_rate = rate_bps.clamp(-MAX_FUNDING_RATE_BPS, MAX_FUNDING_RATE_BPS);

    // ── Scale rate by elapsed time ────────────────────────────────
    // Funding accumulates proportionally to elapsed time
    // Base rate is per 8 hours (28800 seconds)
    // Scaled rate = rate_bps * elapsed / 28800
    let scaled_rate = clamped_rate
        .checked_mul(clamped_elapsed)
        .ok_or(ProgramError::ArithmeticOverflow)?
        .checked_div(FUNDING_PERIOD_SECS)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    funding.apply_funding_rate(scaled_rate, now_ts);
    Ok(())
}
