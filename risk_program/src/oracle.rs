use pinocchio::{error::ProgramError, AccountView};
use switchboard_on_demand::on_demand::accounts::PullFeedAccountData;

use crate::{
    constants::{KXI_MARKET_INDEX, SWITCHBOARD_KXI_USD_FEED, SWITCHBOARD_SOL_USD_FEED},
    errors::RiskProgramError,
};

const SWITCHBOARD_PULL_FEED_DISCRIMINATOR: [u8; 8] = [196, 27, 108, 196, 10, 215, 219, 40];
const SWITCHBOARD_PRICE_SCALE: i128 = 1_000_000_000_000; // 1e18 -> 1e6

/// Read market price from an existing Switchboard On-Demand pull feed.
/// Returns price in USD * 10^6.
pub fn validate_switchboard_price(
    price_account: &AccountView,
    market_index: u16,
    clock_slot: u64,
) -> Result<i64, ProgramError> {
    let expected_feed = if market_index == KXI_MARKET_INDEX {
        &SWITCHBOARD_KXI_USD_FEED
    } else {
        &SWITCHBOARD_SOL_USD_FEED
    };
    if price_account.address().as_array() != expected_feed {
        return Err(RiskProgramError::InvalidOraclePrice.into());
    }

    let data = price_account.try_borrow()?;
    let expected_len = 8 + core::mem::size_of::<PullFeedAccountData>();
    if data.len() < expected_len {
        return Err(ProgramError::InvalidAccountData);
    }
    if data[..8] != SWITCHBOARD_PULL_FEED_DISCRIMINATOR {
        return Err(ProgramError::InvalidAccountData);
    }

    let feed = bytemuck::try_from_bytes::<PullFeedAccountData>(&data[8..expected_len])
        .map_err(|_| ProgramError::InvalidAccountData)?;

    let result_slot = feed
        .result
        .result_slot()
        .ok_or(RiskProgramError::StalePriceFeed)?;
    if clock_slot == 0 || result_slot == 0 {
        return Err(RiskProgramError::StalePriceFeed.into());
    }
    let staleness = clock_slot
        .checked_sub(result_slot)
        .ok_or(RiskProgramError::StalePriceFeed)?;
    if staleness > feed.max_staleness as u64 {
        return Err(RiskProgramError::StalePriceFeed.into());
    }

    let value = feed
        .result
        .value()
        .ok_or(RiskProgramError::InvalidOraclePrice)?;

    let normalized = value
        .mantissa()
        .checked_div(SWITCHBOARD_PRICE_SCALE)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    if normalized <= 0 {
        return Err(RiskProgramError::InvalidOraclePrice.into());
    }

    i64::try_from(normalized).map_err(|_| ProgramError::ArithmeticOverflow)
}
