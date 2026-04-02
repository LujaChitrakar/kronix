use pinocchio::error::ProgramError;

/// Calculate funding rate in bps
/// mark_price and index_price in same units
/// Returns rate in basis points, clamped to ±500 bps (±5%)
pub fn funding_rate_bps(mark_price: i64, index_price: i64) -> i64 {
    if index_price == 0 {
        return 0;
    }
    let premium_bps = (mark_price as i128 - index_price as i128) * 10_000 / index_price as i128;

    // Clamp to ±500 bps
    premium_bps.max(-500).min(500) as i64
}

/// Safe multiply with overflow check
pub fn checked_mul(a: i64, b: i64) -> Result<i64, ProgramError> {
    a.checked_mul(b).ok_or(ProgramError::ArithmeticOverflow)
}

/// Safe addition with overflow check
pub fn checked_add(a: i64, b: i64) -> Result<i64, ProgramError> {
    a.checked_add(b).ok_or(ProgramError::ArithmeticOverflow)
}

/// Safe subtraction with overflow check
pub fn checked_sub(a: i64, b: i64) -> Result<i64, ProgramError> {
    a.checked_sub(b).ok_or(ProgramError::ArithmeticOverflow)
}

/// Convert price lots to USDC native
pub fn lots_to_native(lots: i64, lot_size: i64) -> Result<i64, ProgramError> {
    checked_mul(lots, lot_size)
}
