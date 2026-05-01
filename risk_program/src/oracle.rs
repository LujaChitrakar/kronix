use pinocchio::{AccountView, error::ProgramError};

use crate::{
    constants::{
        FEED_ID, MAX_CONF_RATIO_BPS, MAX_PRICE_AGE_SLOTS, PRICE_ACC_LEN, PRICE_ACC_OFFSET_CONF,
        PRICE_ACC_OFFSET_EXPONENT, PRICE_ACC_OFFSET_FEED_ID, PRICE_ACC_OFFSET_PRICE,
    },
    errors::RiskProgramError,
};

pub struct ValidatedPrice {
    pub price: i64, // price in USD * 10^6
    pub conf: u64,  // confidence interval
    pub slot: u64,  // slot when published
}

/// Validate a Pyth price feed account
/// Must be called before using any price in risk calculations
pub fn validate_pyth_price(
    price_account: &AccountView,
    _clock_unix_timestamp: i64,
) -> Result<i64, ProgramError> {
    let data = price_account.try_borrow()?;

    if data.len() < PRICE_ACC_LEN {
        return Err(ProgramError::InvalidAccountData);
    }

    let feed_id = &data[PRICE_ACC_OFFSET_FEED_ID..PRICE_ACC_OFFSET_FEED_ID + 32];

    let raw_price = i64::from_le_bytes(
        data[PRICE_ACC_OFFSET_PRICE..PRICE_ACC_OFFSET_PRICE + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );

    let _ = u64::from_le_bytes(
        data[PRICE_ACC_OFFSET_CONF..PRICE_ACC_OFFSET_CONF + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );

    let exponent = i32::from_le_bytes(
        data[PRICE_ACC_OFFSET_EXPONENT..PRICE_ACC_OFFSET_EXPONENT + 4]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );

    // let publish_time = i64::from_le_bytes(
    //     data[PRICE_ACC_OFFSET_PUBLISH_TIME..PRICE_ACC_OFFSET_PUBLISH_TIME + 8]
    //         .try_into()
    //         .map_err(|_| MakerError::InvalidAccountData)?,
    // );
    //
    // if clock_unix_timestamp.saturating_sub(publish_time) > MAX_PRICE_AGE {
    //     return Err(MakerError::StalePythPrice.into());
    // }

    let scale_exp: i32 = 6 + exponent; // target expo (6) + pyth expo

    let normalized = if scale_exp >= 0 {
        // multiply
        let scale = 10i64.pow(scale_exp as u32);
        raw_price
            .checked_mul(scale)
            .ok_or(ProgramError::ArithmeticOverflow)?
    } else {
        // divide
        let scale = 10i64.pow((-scale_exp) as u32);
        raw_price
            .checked_div(scale)
            .ok_or(ProgramError::ArithmeticOverflow)?
    };

    Ok(normalized)
}
