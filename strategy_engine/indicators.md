use crate::types::Candle;
use rust_decimal::Decimal;

// RSI

/// # Formula
/// ```text
/// RS  = avg_gain / avg_loss  (Wilder's smoothing)
/// RSI = 100 - (100 / (1 + RS))
/// ```
pub fn rsi(closes: &[Decimal], period: usize) -> Option<Decimal> {
    if period == 0 || closes.len() < period + 1 {
        return None;
    }

    let hundred = Decimal::new(100, 0);
    let one = Decimal::ONE;
    let period_d = Decimal::new(period as i64, 0);

    let mut avg_gain = Decimal::ZERO;
    let mut avg_loss = Decimal::ZERO;

    for i in 1..=period {
        let delta = closes[i] - closes[i - 1];
        if delta > Decimal::ZERO {
            avg_gain += delta;
        } else {
            avg_loss += -delta;
        }
    }

    avg_gain /= period_d;
    avg_loss /= period_d;

    for i in (period + 1)..closes.len() {
        let delta = closes[i] - closes[i - 1];
        let gain = if delta > Decimal::ZERO {
            delta
        } else {
            Decimal::ZERO
        };
        let loss = if delta < Decimal::ZERO {
            -delta
        } else {
            Decimal::ZERO
        };

        avg_gain = (avg_gain * (period_d - one) + gain) / period_d;
        avg_loss = (avg_loss * (period_d - one) + loss) / period_d;
    }

    if avg_loss == Decimal::ZERO {
        return Some(hundred);
    }

    let rs = avg_gain / avg_loss;
    Some(hundred - (hundred / (one + rs)))
}

// EMA
/// The first EMA value is seeded as the SMA of the first `period` closes.
/// Subsequent values use the standard multiplier: `k = 2 / (period + 1)`.
pub fn ema(closes: &[Decimal], period: usize) -> Option<Decimal> {
    if period == 0 || closes.len() < period {
        return None;
    }

    let period_d = Decimal::new(period as i64, 0);
    let two = Decimal::new(2, 0);
    let one = Decimal::ONE;

    let seed: Decimal = closes[..period].iter().copied().sum::<Decimal>() / period_d;

    let k = two / (period_d + one);
    let mut current_ema = seed;

    for &close in &closes[period..] {
        current_ema = close * k + current_ema * (one - k);
    }

    Some(current_ema)
}

pub fn ema_prev(closes: &[Decimal], period: usize) -> Option<Decimal> {
    if closes.len() < period + 1 {
        return None;
    }
    ema(&closes[..closes.len() - 1], period)
}

// Advance Strategy

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Structure {
    Bullish,
    Bearish,
    Ranging,
}

pub fn detect_structure(candles: &[Candle]) -> Structure {
    if candles.len() < 6 {
        return Structure::Ranging;
    }

    let highs: Vec<Decimal> = candles.iter().map(|c| c.high).collect();
    let lows: Vec<Decimal> = candles.iter().map(|c| c.low).collect();

    let n = candles.len();
    let pivot_high_curr = pivot_high(&highs, n - 2);
    let pivot_low_curr = pivot_low(&lows, n - 2);
    let pivot_high_prev = find_prev_pivot_high(&highs, n - 3);
    let pivot_low_prev = find_prev_pivot_low(&lows, n - 3);

    match (
        pivot_high_curr,
        pivot_high_prev,
        pivot_low_curr,
        pivot_low_prev,
    ) {
        (Some(hh), Some(ph), Some(hl), Some(pl)) => {
            if hh > ph && hl > pl {
                Structure::Bullish
            } else if hh < ph && hl < pl {
                Structure::Bearish
            } else {
                Structure::Ranging
            }
        }
        _ => Structure::Ranging,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrderBlock {
    pub high: Decimal,
    pub low: Decimal,
    pub is_bullish: bool,
}

pub fn find_order_block(candles: &[Candle], structure: Structure) -> Option<OrderBlock> {
    if candles.len() < 3 {
        return None;
    }

    let n = candles.len();
    match structure {
        Structure::Bullish => {
            for i in (1..n - 1).rev() {
                let candle = &candles[i];
                let next = &candles[i + 1];
                if candle.close < candle.open && next.close > next.open && next.close > candle.high
                {
                    return Some(OrderBlock {
                        high: candle.high,
                        low: candle.low,
                        is_bullish: true,
                    });
                }
            }
            None
        }
        Structure::Bearish => {
            for i in (1..n - 1).rev() {
                let candle = &candles[i];
                let next = &candles[i + 1];
                if candle.close > candle.open && next.close < next.open && next.close < candle.low {
                    return Some(OrderBlock {
                        high: candle.high,
                        low: candle.low,
                        is_bullish: false,
                    });
                }
            }
            None
        }
        Structure::Ranging => None,
    }
}

// Pivot helpers

fn pivot_high(highs: &[Decimal], idx: usize) -> Option<Decimal> {
    if idx == 0 || idx + 1 >= highs.len() {
        return None;
    }
    if highs[idx] > highs[idx - 1] && highs[idx] > highs[idx + 1] {
        Some(highs[idx])
    } else {
        None
    }
}

fn pivot_low(lows: &[Decimal], idx: usize) -> Option<Decimal> {
    if idx == 0 || idx + 1 >= lows.len() {
        return None;
    }
    if lows[idx] < lows[idx - 1] && lows[idx] < lows[idx + 1] {
        Some(lows[idx])
    } else {
        None
    }
}

fn find_prev_pivot_high(highs: &[Decimal], before: usize) -> Option<Decimal> {
    for i in (1..before).rev() {
        if let Some(ph) = pivot_high(highs, i) {
            return Some(ph);
        }
    }
    None
}

fn find_prev_pivot_low(lows: &[Decimal], before: usize) -> Option<Decimal> {
    for i in (1..before).rev() {
        if let Some(pl) = pivot_low(lows, i) {
            return Some(pl);
        }
    }
    None
}
