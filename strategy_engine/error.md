use thiserror::Error;

#[derive(Debug, Error)]
pub enum StrategyError { #[error("Validation error: {0}")]
Validation(String),

    #[error("Risk engine error: {0}")]
    Risk(String),

    #[error("Database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Strategy not found: {0}")]
    NotFound(uuid::Uuid),

    #[error("Unauthorized: account '{0}' does not own strategy '{1}'")]
    Unauthorized(String, uuid::Uuid),

    #[error("Cooldown active: strategy fired too recently")]
    Cooldown,

    #[error("Insufficient margin: maintenance margin exceeded")]
    InsufficientMargin,

    #[error("Order placement failed: {0}")]
    OrderPlacement(String),

    #[error("Daily execution cap reached ({0} executions)")]
    DailyCapReached(u32),

    #[error("Strategy is not active (current status: {0})")]
    NotActive(String),

    #[error("Indicator computation failed: {0}")]
    Indicator(String),

}

impl From<risk_engine::RiskError> for StrategyError {
fn from(e: risk_engine::RiskError) -> Self {
StrategyError::Risk(e.to_string())
}
}
