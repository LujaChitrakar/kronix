use std::{
    collections::HashMap,
    sync::Arc,
};

use chrono::{DateTime, Utc};
use rust_decimal::prelude::*;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::{broadcast, RwLock};
use sqlx::PgPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Asset {
    Btc,
    Eth,
    Sol,
    Bnb,
    Xrp,
    Ltc,
    Xmr,
}

impl Asset {
    pub fn all() -> &'static [Asset] {
        &[Asset::Btc, Asset::Eth, Asset::Sol, Asset::Bnb, Asset::Xrp, Asset::Ltc, Asset::Xmr]
    }

    pub fn index_assets() -> &'static [Asset] {
        &[Asset::Btc, Asset::Eth, Asset::Sol, Asset::Bnb, Asset::Xrp]
    }

    pub fn binance_symbol(&self) -> &'static str {
        match self {
            Asset::Btc => "BTCUSDT",
            Asset::Eth => "ETHUSDT",
            Asset::Sol => "SOLUSDT",
            Asset::Bnb => "BNBUSDT",
            Asset::Xrp => "XRPUSDT",
            Asset::Ltc => "LTCUSDT",
            Asset::Xmr => "XMRUSDT",
        }
    }
}

impl std::str::FromStr for Asset {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_uppercase().as_str() {
            "BTC" | "BTCUSDT" => Ok(Asset::Btc),
            "ETH" | "ETHUSDT" => Ok(Asset::Eth),
            "SOL" | "SOLUSDT" => Ok(Asset::Sol),
            "BNB" | "BNBUSDT" => Ok(Asset::Bnb),
            "XRP" | "XRPUSDT" => Ok(Asset::Xrp),
            "LTC" | "LTCUSDT" => Ok(Asset::Ltc),
            "XMR" | "XMRUSDT" => Ok(Asset::Xmr),
            _ => Err(anyhow::anyhow!("Invalid asset symbol: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetPrice {
    pub asset: Asset,
    pub price_usd: Decimal,
    pub market_cap_usd: Decimal,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexValue {
    pub price: Decimal,
    pub weights: HashMap<Asset, Decimal>,
    pub components: Vec<AssetContribution>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetContribution {
    pub asset: Asset,
    pub weight: Decimal,
    pub price_usd: Decimal,
    pub market_cap_usd: Decimal,
}

#[derive(Debug, Error)]
pub enum IndexError {
    #[error("Invalid market cap")]
    InvalidMarketCap,
    #[error("Missing asset")]
    MissingAsset(Asset),
    #[error("Calculation error")]
    Calculation,
}

pub fn sqrt_weights(prices: &HashMap<Asset, AssetPrice>) -> Result<HashMap<Asset, Decimal>, IndexError> {
    let mut sqrt_values: HashMap<Asset, f64> = HashMap::new();
    for (&asset, ap) in prices {
        sqrt_values.insert(asset, ap.market_cap_usd.to_f64().unwrap_or(0.0).sqrt());
    }
    let total_sqrt: f64 = sqrt_values.values().sum();
    if total_sqrt <= 0.0 { return Err(IndexError::Calculation); }
    let mut bps_weights: HashMap<Asset, i64> = sqrt_values.iter()
        .map(|(&a, &v)| (a, ((v / total_sqrt) * 10000.0).floor() as i64))
        .collect();
    let current_sum: i64 = bps_weights.values().sum();
    let diff = 10000 - current_sum;
    if let Some(w) = bps_weights.get_mut(&Asset::Btc) { *w += diff; }
    Ok(bps_weights.into_iter()
        .map(|(a, bps)| (a, Decimal::from(bps) / dec!(10000)))
        .collect())
}

pub fn calc_index_price(prices: &HashMap<Asset, AssetPrice>, weights: &HashMap<Asset, Decimal>) -> Result<Decimal, IndexError> {
    let mut index = Decimal::ZERO;
    for (&asset, weight) in weights {
        let ap = prices.get(&asset).ok_or(IndexError::MissingAsset(asset))?;
        index += weight * ap.price_usd;
    }
    Ok(index)
}

pub struct IndexEngine {
    state: Arc<RwLock<HashMap<Asset, AssetPrice>>>,
    tx: broadcast::Sender<IndexValue>,
    pool: PgPool,
}

impl IndexEngine {
    pub fn new(pool: PgPool) -> Self {
        let (tx, _) = broadcast::channel(1024);
        Self { state: Arc::new(RwLock::new(HashMap::new())), tx, pool }
    }
    pub async fn update_price(&self, update: AssetPrice, override_ts: Option<DateTime<Utc>>) -> Result<Option<IndexValue>, IndexError> {
        let mut state = self.state.write().await;
        state.insert(update.asset, update);
        
        let mut index_prices = HashMap::new();
        for &a in Asset::index_assets() {
            if let Some(ap) = state.get(&a) {
                index_prices.insert(a, ap.clone());
            } else {
                return Ok(None);
            }
        }

        let weights = sqrt_weights(&index_prices)?;
        let price = calc_index_price(&index_prices, &weights)?;
        let ts = override_ts.unwrap_or_else(Utc::now);
        let components = Asset::index_assets().iter().map(|&a| {
            let ap = index_prices.get(&a).unwrap();
            AssetContribution { asset: a, weight: *weights.get(&a).unwrap(), price_usd: ap.price_usd, market_cap_usd: ap.market_cap_usd }
        }).collect();
        let iv = IndexValue { price, weights, components, timestamp: ts };
        let _ = self.tx.send(iv.clone());

        Ok(Some(iv))
    }
    pub fn subscribe(&self) -> broadcast::Receiver<IndexValue> { self.tx.subscribe() }
    pub fn get_sender(&self) -> broadcast::Sender<IndexValue> { self.tx.clone() }
}
