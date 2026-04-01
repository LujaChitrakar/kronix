use pinocchio::error::ProgramError;

use crate::{constants::{MAX_CONF_RATIO_BPS, MAX_PRICE_AGE_SLOTS}, errors::RiskProgramError};

pub struct ValidatedPrice {
    pub price: i64, // price in USD * 10^6
    pub conf: u64,  // confidence interval
    pub slot: u64,  // slot when published
}

/// Validate a Pyth price feed account
/// Must be called before using any price in risk calculations
pub fn validate_pyth_price(
    oracle_account: &pinocchio::AccountView,
    current_slot: u64,
    expected_feed: &[u8; 32],
) -> Result<ValidatedPrice, ProgramError> {
    // 1. Verify this is the expected oracle feed
    if oracle_account.address().as_array() != expected_feed {
        return Err(RiskProgramError::InvalidOracle.into());
    }

    // 2. Read raw price data
    // Pyth account layout — manual deserialization
    let data = oracle_account.try_borrow()?;

    if data.len() < 208 {
        return Err(RiskProgramError::InvalidOracle.into());
    }

    // Pyth price account magic check
    let magic = u32::from_le_bytes(data[0..4].try_into().unwrap());
    if magic != 0xa1b2c3d4 {
        return Err(RiskProgramError::InvalidOracle.into());
    }

    // Read price, conf, and publish slot
    // Offsets from Pyth price account layout
    let price = i64::from_le_bytes(data[208..216].try_into().unwrap());
    let conf = u64::from_le_bytes(data[216..224].try_into().unwrap());
    let slot = u64::from_le_bytes(data[136..144].try_into().unwrap());

    // 3. Staleness check
    let age = current_slot.saturating_sub(slot);
    if age > MAX_PRICE_AGE_SLOTS {
        return Err(RiskProgramError::StalePriceFeed.into());
    }

    // 4. Confidence interval check
    // conf/price < MAX_CONF_RATIO_BPS / 10_000
    if price <= 0 {
        return Err(RiskProgramError::InvalidOraclePrice.into());
    }
    let conf_ratio_bps = conf * 10_000 / price.unsigned_abs();
    if conf_ratio_bps > MAX_CONF_RATIO_BPS {
        return Err(RiskProgramError::OracleConfidenceTooWide.into());
    }

    Ok(ValidatedPrice { price, conf, slot })
}
