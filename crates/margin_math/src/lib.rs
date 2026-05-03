#![no_std]

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarginMathError {
    InvalidInput,
}

pub fn consumed_margin(reserved: i64, filled: i64, original: i64) -> Result<i64, MarginMathError> {
    if reserved <= 0 || original <= 0 || filled < 0 || filled > original {
        return Err(MarginMathError::InvalidInput);
    }
    if filled == 0 {
        return Ok(0);
    }
    if filled == original {
        return Ok(reserved);
    }

    let mul = reserved as i128 * filled as i128;
    let v = (mul + original as i128 - 1) / original as i128;
    i64::try_from(v).map_err(|_| MarginMathError::InvalidInput)
}

pub fn fill_margin(
    reserved: i64,
    before_filled: i64,
    after_filled: i64,
    original: i64,
) -> Result<i64, MarginMathError> {
    if before_filled > after_filled {
        return Err(MarginMathError::InvalidInput);
    }
    let before = consumed_margin(reserved, before_filled, original)?;
    let after = consumed_margin(reserved, after_filled, original)?;
    after
        .checked_sub(before)
        .ok_or(MarginMathError::InvalidInput)
}
