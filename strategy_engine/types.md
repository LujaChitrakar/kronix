use chrono::{DateTime, Duration, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candle {
    pub open: Decimal,
    pub high: Decimal,
    pub low: Decimal,
    pub close: Decimal,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Signal {
    Buy,
    Sell,
    Hold,
}

impl std::fmt::Display for Signal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Signal::Buy => write!(f, "Buy"),
            Signal::Sell => write!(f, "Sell"),
            Signal::Hold => write!(f, "Hold"),
        }
    }
}

/// RSI-based entry — buys on oversold, sells on overbought.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RsiConfig {
    #[serde(default = "default_rsi_period")]
    pub period: usize,
    #[serde(default = "default_oversold")]
    pub oversold: Decimal,
    #[serde(default = "default_overbought")]
    pub overbought: Decimal,
    pub quantity: Decimal,
    pub limit_price: Decimal,
    #[serde(default = "default_symbol")]
    pub symbol: String,
    #[serde(default = "default_resolution")]
    pub resolution: String,
    pub take_profit: Option<Decimal>,
    pub stop_loss: Option<Decimal>,
    #[serde(default = "default_cooldown")]
    pub cooldown_secs: u64,
    pub max_executions_per_day: Option<u32>,
    #[serde(default = "default_leverage")]
    pub leverage: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "config")]
pub enum StrategyKind {
    RsiBased(RsiConfig),
    EmaBased(EmaConfig),
    RangeDca(RangeDcaConfig),
    SupportResistance(SupportResistanceConfig),
    SmartMoney(SmartMoneyConfig),
}

impl StrategyKind {
    pub fn discriminant(&self) -> &'static str {
        match self {
            StrategyKind::RsiBased(_) => "RsiBased",
            StrategyKind::EmaBased(_) => "EmaBased",
            StrategyKind::RangeDca(_) => "RangeDca",
            StrategyKind::SupportResistance(_) => "SupportResistance",
            StrategyKind::SmartMoney(_) => "SmartMoney",
        }
    }

    /// Number of candles needed for the indicator to be accurate.
    pub fn required_lookback(&self) -> usize {
        match self {
            StrategyKind::RangeDca(_) => 1,
            StrategyKind::RsiBased(c) => c.period * 4, // RSI needs a buffer for smoothing
            StrategyKind::EmaBased(c) => c.slow_period * 3, // EMA needs a buffer
            StrategyKind::SupportResistance(_) => 1,
            StrategyKind::SmartMoney(c) => c.structure_lookback + 10,
        }
    }

    pub fn symbol(&self) -> &str {
        match self {
            StrategyKind::RangeDca(c) => &c.symbol,
            StrategyKind::RsiBased(c) => &c.symbol,
            StrategyKind::EmaBased(c) => &c.symbol,
            StrategyKind::SupportResistance(c) => &c.symbol,
            StrategyKind::SmartMoney(c) => &c.symbol,
        }
    }

    pub fn resolution(&self) -> &str {
        match self {
            StrategyKind::RangeDca(c) => &c.resolution,
            StrategyKind::RsiBased(c) => &c.resolution,
            StrategyKind::EmaBased(c) => &c.resolution,
            StrategyKind::SupportResistance(c) => &c.resolution,
            StrategyKind::SmartMoney(c) => &c.resolution,
        }
    }

    pub fn resolution_duration(&self) -> Duration {
        match self.resolution() {
            "1m" => Duration::minutes(1),
            "5m" => Duration::minutes(5),
            "15m" => Duration::minutes(15),
            "1h" => Duration::hours(1),
            "1d" => Duration::days(1),
            _ => Duration::hours(1),
        }
    }

    pub fn leverage(&self) -> u32 {
        match self {
            StrategyKind::RangeDca(c) => c.leverage,
            StrategyKind::SupportResistance(c) => c.leverage,
            StrategyKind::RsiBased(c) => c.leverage,
            StrategyKind::EmaBased(c) => c.leverage,
            StrategyKind::SmartMoney(c) => c.leverage,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrategyStatus {
    Active,
    Paused,
    Completed,
    Error,
}

impl std::fmt::Display for StrategyStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StrategyStatus::Active => write!(f, "active"),
            StrategyStatus::Paused => write!(f, "paused"),
            StrategyStatus::Completed => write!(f, "completed"),
            StrategyStatus::Error => write!(f, "error"),
        }
    }
}

impl std::str::FromStr for StrategyStatus {
    type Err = crate::error::StrategyError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(StrategyStatus::Active),
            "paused" => Ok(StrategyStatus::Paused),
            "completed" => Ok(StrategyStatus::Completed),
            "error" => Ok(StrategyStatus::Error),
            other => Err(crate::error::StrategyError::Validation(format!(
                "Unknown strategy status: {}",
                other
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Strategy {
    pub id: Uuid,
    pub account_id: String,
    pub name: String,
    pub kind: StrategyKind,
    pub status: StrategyStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Strategy {
    pub fn new(account_id: impl Into<String>, name: impl Into<String>, kind: StrategyKind) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            account_id: account_id.into(),
            name: name.into(),
            kind,
            status: StrategyStatus::Active,
            created_at: now,
            updated_at: now,
        }
    }

    /// Returns `true` if the strategy is eligible to evaluate signals.
    pub fn is_active(&self) -> bool {
        self.status == StrategyStatus::Active
    }
}

/// EMA Crossover — buys when fast EMA crosses above slow, sells on cross below.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct EmaConfig {
    #[serde(default = "default_ema_fast")]
    pub fast_period: usize,
    #[serde(default = "default_ema_slow")]
    pub slow_period: usize,
    pub quantity: Decimal,
    pub limit_price: Decimal,
    #[serde(default = "default_symbol")]
    pub symbol: String,
    #[serde(default = "default_resolution")]
    pub resolution: String,
    pub take_profit: Option<Decimal>,
    pub stop_loss: Option<Decimal>,
    #[serde(default = "default_cooldown")]
    pub cooldown_secs: u64,
    pub max_executions_per_day: Option<u32>,
    #[serde(default = "default_leverage")]
    pub leverage: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OrderSide {
    #[default]
    Buy,
    Sell,
}

/// Grid / Range DCA — buys/sells at uniform price intervals within a range.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RangeDcaConfig {
    pub lower_price: Decimal, // inclusive
    pub upper_price: Decimal, // inclusive
    /// Number of equally-spaced grid levels between lower and upper.
    pub grid_count: u32,
    pub quantity: Decimal,
    pub side: OrderSide,
    pub limit_price: Option<Decimal>,
    #[serde(default = "default_symbol")]
    pub symbol: String,
    #[serde(default = "default_resolution")]
    pub resolution: String,
    pub take_profit: Option<Decimal>,
    pub stop_loss: Option<Decimal>,
    #[serde(default = "default_cooldown")]
    pub cooldown_secs: u64,
    pub max_executions_per_day: Option<u32>,
    #[serde(default = "default_leverage")]
    pub leverage: u32,
}

/// Support / Resistance — fires when price touches a user-defined level.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SupportResistanceConfig {
    pub levels: Vec<Decimal>,
    #[serde(default = "default_tolerance_bps")]
    pub tolerance_bps: u32,
    pub quantity: Decimal,
    pub side: OrderSide,
    pub limit_price: Option<Decimal>,
    #[serde(default = "default_symbol")]
    pub symbol: String,
    #[serde(default = "default_resolution")]
    pub resolution: String,
    pub take_profit: Option<Decimal>,
    pub stop_loss: Option<Decimal>,
    #[serde(default = "default_cooldown")]
    pub cooldown_secs: u64,
    pub max_executions_per_day: Option<u32>,
    #[serde(default = "default_leverage")]
    pub leverage: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SmartMoneyConfig {
    #[serde(default = "default_smc_lookback")]
    pub structure_lookback: usize,
    #[serde(default = "default_ob_sensitivity")]
    pub order_block_sensitivity: Decimal,
    pub quantity: Decimal,
    pub limit_price: Decimal,
    #[serde(default = "default_symbol")]
    pub symbol: String,
    #[serde(default = "default_resolution")]
    pub resolution: String,
    pub take_profit: Option<Decimal>,
    pub stop_loss: Option<Decimal>,
    #[serde(default = "default_cooldown")]
    pub cooldown_secs: u64,
    pub max_executions_per_day: Option<u32>,
    #[serde(default = "default_leverage")]
    pub leverage: u32,
}

// ─────────────────────────────────────────────────── Execution Record ────────

/// Summary of a single strategy execution, written to `strategy_executions`.
#[derive(Debug, Clone, Serialize)]
pub struct ExecutionRecord {
    pub strategy_id: Uuid,
    pub account_id: String,
    pub signal: Signal,
    /// The order placed (if any).
    pub order_id: Option<Uuid>,
    pub price: Option<Decimal>,
    pub quantity: Option<Decimal>,
    pub error: Option<String>,
    pub executed_at: DateTime<Utc>,
}

// ─────────────────────── Default helpers for serde ──────────────────────────

fn default_cooldown() -> u64 {
    60
}

fn default_rsi_period() -> usize {
    14
}

fn default_oversold() -> Decimal {
    Decimal::new(30, 0)
}

fn default_overbought() -> Decimal {
    Decimal::new(70, 0)
}

fn default_symbol() -> String {
    "SCI".to_string()
}

fn default_resolution() -> String {
    "1h".to_string()
}

fn default_ema_fast() -> usize {
    9
}

fn default_ema_slow() -> usize {
    21
}

fn default_tolerance_bps() -> u32 {
    20
}

fn default_smc_lookback() -> usize {
    50
}

fn default_ob_sensitivity() -> Decimal {
    Decimal::new(2, 3)
}

fn default_leverage() -> u32 {
    1
}
