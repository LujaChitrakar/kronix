use anyhow::Result;
use chrono::{DateTime, TimeZone, Utc};
use rust_decimal::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::index_engine::{Asset, AssetPrice, calc_index_price, sqrt_weights};
use rust_decimal_macros::dec;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandleData {
    pub resolution: String,
    pub timestamp: DateTime<Utc>,
    pub open: Decimal,
    pub high: Decimal,
    pub low: Decimal,
    pub close: Decimal,
    pub market_cap: Decimal,
}

pub struct BinanceClient {
    http: reqwest::Client,
}

impl BinanceClient {
    pub fn new() -> Self { Self { http: reqwest::Client::new() } }
    pub async fn fetch_klines(&self, symbol: &str, resolution: &str, from_sec: i64, to_sec: i64) -> Result<Vec<CandleData>> {
        let interval = match resolution {
            "1m" => "1m", "5m" => "5m", "15m" => "15m", "1h" => "1h", "4h" => "4h", "1d" => "1d", "1w" => "1w", "1M" => "1M", _ => "1h",
        };
        let url = "https://api.binance.com/api/v3/klines";
        let mut all_candles: Vec<CandleData> = Vec::new();
        let mut current_from = from_sec * 1000; 
        let to_ms = to_sec * 1000;

        loop {
            let resp = self.http.get(url)
                .query(&[
                    ("symbol", symbol),
                    ("interval", interval),
                    ("startTime", &current_from.to_string()),
                    ("endTime", &to_ms.to_string()),
                    ("limit", "1000"),
                ])
                .send().await?.json::<Vec<Vec<serde_json::Value>>>().await?;

            if resp.is_empty() { break; }

            let last_ts = resp.last()
                .and_then(|k| k[0].as_i64())
                .unwrap_or(to_ms);

            let candles: Vec<CandleData> = resp.into_iter().filter_map(|k| {
                if k.len() < 6 { return None; }
                let open_time = k[0].as_i64()? / 1000;
                let parse = |idx: usize| k[idx].as_str()?.parse::<Decimal>().ok();
                Some(CandleData {
                    resolution: resolution.to_string(),
                    timestamp: Utc.timestamp_opt(open_time, 0).single()?,
                    open: parse(1)?, high: parse(2)?, low: parse(3)?, close: parse(4)?,
                    market_cap: match symbol {
                        "BTCUSDT" => dec!(1_000_000_000_000),
                        "ETHUSDT" => dec!(300_000_000_000),
                        "SOLUSDT" => dec!(80_000_000_000),
                        "BNBUSDT" => dec!(80_000_000_000),
                        "XRPUSDT" => dec!(50_000_000_000),
                        _ => dec!(60_000_000_000),
                    }
                })
            }).collect();

            let fetched = candles.len();
            all_candles.extend(candles);

            if fetched < 1000 || last_ts >= to_ms {
                break;
            }
            current_from = last_ts + 1;

            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }

        Ok(all_candles)
    }
}

pub fn compute_index_candles(
    res: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    all_data: &HashMap<Asset, Vec<CandleData>>,
) -> Vec<CandleData> {
    let mut indexed: HashMap<Asset, HashMap<i64, CandleData>> = HashMap::new();
    for (a, v) in all_data {
        let mut map = HashMap::new();
        for c in v { map.insert(c.timestamp.timestamp(), c.clone()); }
        indexed.insert(*a, map);
    }
    let mut results = Vec::new();
    let mut curr = start;
    let mut last_prices = HashMap::new();
    while curr < end {
        let ts = curr.timestamp();
        let mut prices = HashMap::new();
        let mut has_all = true;
        for &a in Asset::all() {
            if let Some(c) = indexed.get(&a).and_then(|m| m.get(&ts)) {
                let ap = AssetPrice { asset: a, price_usd: c.close, market_cap_usd: c.market_cap, timestamp: curr };
                prices.insert(a, ap.clone());
                last_prices.insert(a, ap);
            } else if let Some(lp) = last_prices.get(&a) {
                prices.insert(a, lp.clone());
            } else { has_all = false; break; }
        }
        if has_all {
            if let Ok(weights) = sqrt_weights(&prices) {
                if let Ok(p) = calc_index_price(&prices, &weights) {
                    results.push(CandleData { resolution: res.to_string(), timestamp: curr, open: p, high: p, low: p, close: p, market_cap: dec!(0) });
                }
            }
        }
        curr = curr + chrono::Duration::minutes(1);
    }
    results
}
