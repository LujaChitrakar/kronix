use rust_decimal::Decimal;

use crate::{
    indicators::{self, Structure},
    types::{
        Candle, EmaConfig, OrderSide, RangeDcaConfig, RsiConfig, Signal, SmartMoneyConfig,
        SupportResistanceConfig,
    },
};
use serde_json::Value;

/// Evaluate an RSI-based strategy.
///
/// * RSI < `oversold`  → **Buy** signal.
/// * RSI > `overbought` → **Sell** signal.
/// * Otherwise         → Hold.
pub fn evaluate_rsi(config: &RsiConfig, candles: &[Candle]) -> (Signal, Value) {
    if candles.len() < config.period + 1 {
        return (
            Signal::Hold,
            serde_json::json!({"reason": "insufficient_data", "have": candles.len(), "need": config.period + 1}),
        );
    }

    let closes: Vec<Decimal> = candles.iter().map(|c| c.close).collect();
    let rsi_val = match indicators::rsi(&closes, config.period) {
        Some(v) => v,
        None => {
            return (
                Signal::Hold,
                serde_json::json!({"reason": "rsi_computation_failed"}),
            );
        }
    };

    let snapshot = serde_json::json!({
        "rsi": rsi_val.to_string(),
        "period": config.period,
        "oversold": config.oversold.to_string(),
        "overbought": config.overbought.to_string(),
    });

    if rsi_val < config.oversold {
        (Signal::Buy, snapshot)
    } else if rsi_val > config.overbought {
        (Signal::Sell, snapshot)
    } else {
        let mut s = snapshot;
        s["reason"] = Value::String("rsi_neutral".into());
        (Signal::Hold, s)
    }
}

/// Evaluate an EMA crossover strategy.
///
/// * Fast EMA crosses **above** slow EMA → **Buy**.
/// * Fast EMA crosses **below** slow EMA → **Sell**.
/// * No crossover → Hold.
pub fn evaluate_ema(config: &EmaConfig, candles: &[Candle]) -> (Signal, Value) {
    let closes: Vec<Decimal> = candles.iter().map(|c| c.close).collect();

    let fast_now = match indicators::ema(&closes, config.fast_period) {
        Some(v) => v,
        None => {
            return (
                Signal::Hold,
                serde_json::json!({"reason": "ema_fast_failed"}),
            );
        }
    };
    let slow_now = match indicators::ema(&closes, config.slow_period) {
        Some(v) => v,
        None => {
            return (
                Signal::Hold,
                serde_json::json!({"reason": "ema_slow_failed"}),
            );
        }
    };
    let fast_prev = match indicators::ema_prev(&closes, config.fast_period) {
        Some(v) => v,
        None => {
            return (
                Signal::Hold,
                serde_json::json!({"reason": "ema_fast_prev_failed"}),
            );
        }
    };
    let slow_prev = match indicators::ema_prev(&closes, config.slow_period) {
        Some(v) => v,
        None => {
            return (
                Signal::Hold,
                serde_json::json!({"reason": "ema_slow_prev_failed"}),
            );
        }
    };

    let bullish_cross = fast_prev <= slow_prev && fast_now > slow_now;
    let bearish_cross = fast_prev >= slow_prev && fast_now < slow_now;

    let snapshot = serde_json::json!({
        "fast_ema": fast_now.to_string(),
        "slow_ema": slow_now.to_string(),
        "fast_ema_prev": fast_prev.to_string(),
        "slow_ema_prev": slow_prev.to_string(),
        "fast_period": config.fast_period,
        "slow_period": config.slow_period,
    });

    if bullish_cross {
        (Signal::Buy, snapshot)
    } else if bearish_cross {
        (Signal::Sell, snapshot)
    } else {
        let mut s = snapshot;
        s["reason"] = Value::String("no_crossover".into());
        (Signal::Hold, s)
    }
}

/// Evaluate a Range DCA strategy.
///
/// Fires a Buy/Sell signal when the current price sits at (or very near) one of
/// the uniform grid levels computed between `lower_price` and `upper_price`.
pub fn evaluate_range_dca(config: &RangeDcaConfig, candles: &[Candle]) -> (Signal, Value) {
    let price = match candles.last() {
        Some(c) => c.close,
        None => {
            return (
                Signal::Hold,
                serde_json::json!({"reason": "insufficient_data"}),
            );
        }
    };

    if config.grid_count == 0
        || config.upper_price <= config.lower_price
        || config.quantity <= Decimal::ZERO
    {
        return (
            Signal::Hold,
            serde_json::json!({"price": price.to_string(), "reason": "invalid_config"}),
        );
    }

    let range = config.upper_price - config.lower_price;
    let step = range / Decimal::new(config.grid_count as i64, 0);

    // Tolerance: 0.1 % of the step size.
    let tolerance = step * Decimal::new(1, 3);

    for i in 0..=config.grid_count {
        let level = config.lower_price + step * Decimal::new(i as i64, 0);
        if (price - level).abs() <= tolerance {
            let signal = match config.side {
                OrderSide::Buy => Signal::Buy,
                OrderSide::Sell => Signal::Sell,
            };
            return (
                signal,
                serde_json::json!({
                    "price": price.to_string(),
                    "grid_level": level.to_string(),
                    "grid_index": i,
                }),
            );
        }
    }

    (
        Signal::Hold,
        serde_json::json!({"price": price.to_string(), "reason": "no_grid_hit"}),
    )
}

/// Evaluate a Support / Resistance strategy.
///
/// Fires when the current price is within `tolerance_bps` of any configured level.
pub fn evaluate_support_resistance(
    config: &SupportResistanceConfig,
    candles: &[Candle],
) -> (Signal, Value) {
    let price = match candles.last() {
        Some(c) => c.close,
        None => {
            return (
                Signal::Hold,
                serde_json::json!({"reason": "insufficient_data"}),
            );
        }
    };

    if config.levels.is_empty() || config.quantity <= Decimal::ZERO {
        return (
            Signal::Hold,
            serde_json::json!({"reason": "invalid_config"}),
        );
    }

    let bps = Decimal::new(config.tolerance_bps as i64, 4); // bps → fraction

    for level in &config.levels {
        let dist = (price - level).abs();
        let threshold = *level * bps;
        if dist <= threshold {
            let signal = match config.side {
                OrderSide::Buy => Signal::Buy,
                OrderSide::Sell => Signal::Sell,
            };
            return (
                signal,
                serde_json::json!({
                    "price": price.to_string(),
                    "level": level.to_string(),
                    "dist_bps": (dist / level * Decimal::new(10000, 0)).to_string(),
                }),
            );
        }
    }

    (
        Signal::Hold,
        serde_json::json!({"price": price.to_string(), "reason": "no_level_touched"}),
    )
}

/// Evaluate a Advance strategy.
///
/// Fires when the current price is **inside** the order block zone.
pub fn evaluate_smart_money(config: &SmartMoneyConfig, candles: &[Candle]) -> (Signal, Value) {
    let needed = config.structure_lookback.max(6);
    if candles.len() < needed {
        return (
            Signal::Hold,
            serde_json::json!({"reason": "insufficient_data", "have": candles.len(), "need": needed}),
        );
    }

    let window = &candles[candles.len() - needed..];
    let structure = indicators::detect_structure(window);

    if structure == Structure::Ranging {
        return (
            Signal::Hold,
            serde_json::json!({"reason": "ranging_market", "structure": "ranging"}),
        );
    }

    let ob = match indicators::find_order_block(window, structure) {
        Some(b) => b,
        None => {
            return (
                Signal::Hold,
                serde_json::json!({"reason": "no_order_block", "structure": format!("{:?}", structure)}),
            );
        }
    };

    let price = candles.last().unwrap().close;

    // Allow a small fuzz of `order_block_sensitivity` fraction around OB edges.
    let fuzz = price * config.order_block_sensitivity;
    let in_ob = price >= (ob.low - fuzz) && price <= (ob.high + fuzz);

    let snapshot = serde_json::json!({
        "structure": format!("{:?}", structure),
        "ob_high": ob.high.to_string(),
        "ob_low": ob.low.to_string(),
        "price": price.to_string(),
        "in_order_block": in_ob,
    });

    if in_ob {
        let signal = if ob.is_bullish {
            Signal::Buy
        } else {
            Signal::Sell
        };
        (signal, snapshot)
    } else {
        let mut s = snapshot;
        s["reason"] = Value::String("price_outside_ob".into());
        (Signal::Hold, s)
    }
}
