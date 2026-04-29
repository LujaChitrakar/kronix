use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use order_book::{Order, OrderBook, OrderType, Side as BookSide};
use risk_engine::RiskEngine;
use rust_decimal::Decimal;
use sqlx::PgPool;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use trigger_engine::{Side as TrigSide, Trigger, TriggerEngine, TriggerType};
use uuid::Uuid;

use crate::{
    error::StrategyError,
    evaluator,
    types::{Candle, ExecutionRecord, OrderSide, Signal, Strategy, StrategyKind, StrategyStatus},
};

// ------------------------------------------------------------------------------//
// ─────────────────────────── Cooldown tracker ----------------──────────────── //
// ----------------------------------------------------------------------------- //

#[derive(Debug, Clone)]
struct CooldownState {
    last_execution: Option<DateTime<Utc>>,
    executions_today: u32,
    day_start: DateTime<Utc>,
    last_signal_candle_timestamp: Option<DateTime<Utc>>,
}

impl CooldownState {
    fn new() -> Self {
        Self {
            last_execution: None,
            executions_today: 0,
            day_start: Utc::now(),
            last_signal_candle_timestamp: None,
        }
    }

    fn is_ready(
        &self,
        cooldown_secs: u64,
        max_per_day: Option<u32>,
        current_candle_ts: Option<DateTime<Utc>>,
    ) -> bool {
        if let (Some(last_ts), Some(curr_ts)) =
            (self.last_signal_candle_timestamp, current_candle_ts)
        {
            if last_ts == curr_ts {
                return false;
            }
        }
        let now = Utc::now();

        if let Some(last) = self.last_execution {
            let elapsed = (now - last).num_seconds();
            if elapsed < cooldown_secs as i64 {
                return false;
            }
        }

        if let Some(cap) = max_per_day {
            if (now - self.day_start) < Duration::hours(24) && self.executions_today >= cap {
                return false;
            }
        }

        true
    }

    fn record_execution(&mut self, candle_ts: Option<DateTime<Utc>>) {
        let now = Utc::now();
        if (now - self.day_start) >= Duration::hours(24) {
            self.day_start = now;
            self.executions_today = 0;
        }
        self.executions_today += 1;
        self.last_execution = Some(now);
        self.last_signal_candle_timestamp = candle_ts;
    }
}

// ------------------------------------------------------------------------------//
// ───────────────────────────--- Engine -----------------------──────────────── //
// ----------------------------------------------------------------------------- //

/// Maximum concurrent per-strategy evaluations in the run loop.
const MAX_CONCURRENT_EVALS: usize = 64;

pub struct StrategyEngine {
    strategies: DashMap<Uuid, Strategy>,
    cooldowns: DashMap<Uuid, tokio::sync::Mutex<CooldownState>>,
    db: PgPool,
    order_book: Arc<OrderBook>,
    risk_engine: Arc<RiskEngine>,
    trigger_engine: Arc<TriggerEngine>,
}

impl StrategyEngine {
    pub fn new(
        db: PgPool,
        order_book: Arc<OrderBook>,
        risk_engine: Arc<RiskEngine>,
        trigger_engine: Arc<TriggerEngine>,
    ) -> Self {
        Self {
            strategies: DashMap::new(),
            cooldowns: DashMap::new(),
            db,
            order_book,
            risk_engine,
            trigger_engine,
        }
    }

    // ------------------------------------------------------------------------------//
    // ----------------------------------------------------------------------------- //

    pub async fn add_strategy(&self, strategy: Strategy) -> Result<Uuid, StrategyError> {
        self.validate(&strategy)?;

        let config_json = match &strategy.kind {
            crate::types::StrategyKind::RangeDca(c) => serde_json::to_value(c)?,
            crate::types::StrategyKind::SupportResistance(c) => serde_json::to_value(c)?,
            crate::types::StrategyKind::RsiBased(c) => serde_json::to_value(c)?,
            crate::types::StrategyKind::EmaBased(c) => serde_json::to_value(c)?,
            crate::types::StrategyKind::SmartMoney(c) => serde_json::to_value(c)?,
        };

        sqlx::query(
            "INSERT INTO strategies (id, account_id, name, kind, config, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(strategy.id)
        .bind(&strategy.account_id)
        .bind(&strategy.name)
        .bind(strategy.kind.discriminant())
        .bind(&config_json)
        .bind(strategy.status.to_string())
        .bind(strategy.created_at)
        .bind(strategy.updated_at)
        .execute(&self.db)
        .await?;

        let id = strategy.id;
        self.cooldowns
            .insert(id, tokio::sync::Mutex::new(CooldownState::new()));
        self.strategies.insert(id, strategy);
        info!("Strategy {id} added");
        Ok(id)
    }

    pub async fn pause_strategy(&self, id: Uuid, account_id: &str) -> Result<(), StrategyError> {
        self.update_status(id, account_id, StrategyStatus::Paused)
            .await
    }

    pub async fn resume_strategy(&self, id: Uuid, account_id: &str) -> Result<(), StrategyError> {
        self.update_status(id, account_id, StrategyStatus::Active)
            .await
    }

    pub async fn delete_strategy(&self, id: Uuid, account_id: &str) -> Result<(), StrategyError> {
        self.assert_owner(id, account_id)?;

        sqlx::query("DELETE FROM strategies WHERE id = $1")
            .bind(id)
            .execute(&self.db)
            .await?;

        self.strategies.remove(&id);
        self.cooldowns.remove(&id);
        info!("Strategy {id} deleted");
        Ok(())
    }

    pub async fn list_for_account(&self, account_id: &str) -> Vec<Strategy> {
        self.strategies
            .iter()
            .filter(|e| e.account_id == account_id)
            .map(|e| e.clone())
            .collect()
    }

    pub fn get(&self, id: Uuid) -> Option<Strategy> {
        self.strategies.get(&id).map(|e| e.clone())
    }

    pub async fn restore_from_db(&self) -> Result<(), StrategyError> {
        let rows: Vec<(
            Uuid,
            String,
            String,
            String,
            serde_json::Value,
            String,
            DateTime<Utc>,
            DateTime<Utc>,
        )> = sqlx::query_as(
            "SELECT id, account_id, name, kind, config, status, created_at, updated_at
                 FROM strategies WHERE status IN ('active', 'paused')
                 ORDER BY created_at ASC",
        )
        .fetch_all(&self.db)
        .await?;

        let mut count = 0usize;
        for (id, account_id, name, kind_str, config, status_str, created_at, updated_at) in rows {
            let kind = reconstruct_kind(&kind_str, config)?;
            let status: StrategyStatus = status_str.parse()?;
            let strategy = Strategy {
                id,
                account_id,
                name,
                kind,
                status,
                created_at,
                updated_at,
            };
            self.cooldowns
                .insert(id, tokio::sync::Mutex::new(CooldownState::new()));
            self.strategies.insert(id, strategy);
            count += 1;
        }
        info!("Restored {count} strategies from DB");
        Ok(())
    }

    pub fn validate(&self, s: &Strategy) -> Result<(), StrategyError> {
        if s.name.trim().is_empty() {
            return Err(StrategyError::Validation(
                "Strategy name is required".into(),
            ));
        }
        match &s.kind {
            StrategyKind::RangeDca(c) => {
                if c.upper_price <= c.lower_price {
                    return Err(StrategyError::Validation(
                        "upper_price must be greater than lower_price".into(),
                    ));
                }
                if c.grid_count == 0 {
                    return Err(StrategyError::Validation("grid_count must be > 0".into()));
                }
                if c.quantity <= Decimal::ZERO {
                    return Err(StrategyError::Validation("quantity must be > 0".into()));
                }
            }
            StrategyKind::SupportResistance(c) => {
                if c.levels.is_empty() {
                    return Err(StrategyError::Validation(
                        "At least one price level is required".into(),
                    ));
                }
                if c.quantity <= Decimal::ZERO {
                    return Err(StrategyError::Validation("quantity must be > 0".into()));
                }
            }
            StrategyKind::RsiBased(c) => {
                if c.period < 2 {
                    return Err(StrategyError::Validation("RSI period must be ≥ 2".into()));
                }
                if c.oversold >= c.overbought {
                    return Err(StrategyError::Validation(
                        "oversold must be < overbought".into(),
                    ));
                }
                if c.quantity <= Decimal::ZERO {
                    return Err(StrategyError::Validation("quantity must be > 0".into()));
                }
                if c.limit_price <= Decimal::ZERO {
                    return Err(StrategyError::Validation("limit_price must be > 0".into()));
                }
            }
            StrategyKind::EmaBased(c) => {
                if c.fast_period >= c.slow_period {
                    return Err(StrategyError::Validation(
                        "fast_period must be < slow_period".into(),
                    ));
                }
                if c.quantity <= Decimal::ZERO {
                    return Err(StrategyError::Validation("quantity must be > 0".into()));
                }
                if c.limit_price <= Decimal::ZERO {
                    return Err(StrategyError::Validation("limit_price must be > 0".into()));
                }
            }
            StrategyKind::SmartMoney(c) => {
                if c.structure_lookback < 6 {
                    return Err(StrategyError::Validation(
                        "structure_lookback must be ≥ 6".into(),
                    ));
                }
                if c.quantity <= Decimal::ZERO {
                    return Err(StrategyError::Validation("quantity must be > 0".into()));
                }
                if c.limit_price <= Decimal::ZERO {
                    return Err(StrategyError::Validation("limit_price must be > 0".into()));
                }
            }
        }

        let leverage = s.kind.leverage();
        if leverage < 1 || leverage > 100 {
            return Err(StrategyError::Validation(
                "leverage must be between 1 and 20".into(),
            ));
        }
        Ok(())
    }

    async fn update_status(
        &self,
        id: Uuid,
        account_id: &str,
        new_status: StrategyStatus,
    ) -> Result<(), StrategyError> {
        self.assert_owner(id, account_id)?;

        sqlx::query("UPDATE strategies SET status = $1, updated_at = NOW() WHERE id = $2")
            .bind(new_status.to_string())
            .bind(id)
            .execute(&self.db)
            .await?;

        if let Some(mut e) = self.strategies.get_mut(&id) {
            e.status = new_status;
            e.updated_at = Utc::now();
        }
        info!("Strategy {id} status → {new_status}");
        Ok(())
    }

    fn assert_owner(&self, id: Uuid, account_id: &str) -> Result<(), StrategyError> {
        let e = self
            .strategies
            .get(&id)
            .ok_or(StrategyError::NotFound(id))?;
        if e.account_id != account_id {
            return Err(StrategyError::Unauthorized(account_id.into(), id));
        }
        Ok(())
    }

    // ───────────────────────────────── Execution log queries ───────────────

    pub async fn list_executions(
        &self,
        strategy_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<serde_json::Value>, StrategyError> {
        let rows: Vec<(Uuid, Uuid, String, String, Option<Uuid>, Option<Decimal>, Option<Decimal>, Option<String>, DateTime<Utc>)> =
            sqlx::query_as(
                "SELECT id, strategy_id, account_id, signal, order_id, price, quantity, error, executed_at
                 FROM strategy_executions
                 WHERE strategy_id = $1
                 ORDER BY executed_at DESC
                 LIMIT $2 OFFSET $3",
            )
            .bind(strategy_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.db)
            .await?;

        Ok(rows
            .into_iter()
            .map(|(id, sid, acc, sig, oid, price, qty, err, ts)| {
                serde_json::json!({
                    "id": id,
                    "strategy_id": sid,
                    "account_id": acc,
                    "signal": sig,
                    "order_id": oid,
                    "price": price.map(|p| p.to_string()),
                    "quantity": qty.map(|q| q.to_string()),
                    "error": err,
                    "executed_at": ts,
                })
            })
            .collect())
    }

    pub async fn list_signals(
        &self,
        strategy_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<serde_json::Value>, StrategyError> {
        let rows: Vec<(
            Uuid,
            Uuid,
            String,
            Option<serde_json::Value>,
            Decimal,
            DateTime<Utc>,
        )> = sqlx::query_as(
            "SELECT id, strategy_id, signal, indicator, price, fired_at
                 FROM strategy_signals
                 WHERE strategy_id = $1
                 ORDER BY fired_at DESC
                 LIMIT $2 OFFSET $3",
        )
        .bind(strategy_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.db)
        .await?;

        Ok(rows
            .into_iter()
            .map(|(id, sid, sig, indicator, price, ts)| {
                serde_json::json!({
                    "id": id,
                    "strategy_id": sid,
                    "signal": sig,
                    "indicator": indicator,
                    "price": price.to_string(),
                    "fired_at": ts,
                })
            })
            .collect())
    }

    /// Evaluate + optionally execute one strategy tick.
    pub async fn tick_strategy(&self, id: Uuid) -> Result<(), StrategyError> {
        let strategy = self
            .strategies
            .get(&id)
            .ok_or(StrategyError::NotFound(id))?
            .clone();

        if !strategy.is_active() {
            return Ok(());
        }

        let (cooldown_secs, max_per_day) = extract_timing(&strategy.kind);
        let symbol = strategy.kind.symbol();
        let resolution = strategy.kind.resolution();
        let resolution_dur = strategy.kind.resolution_duration();
        let lookback = strategy.kind.required_lookback();

        // Fetch candles first to check freshness/continuity/dedup-ts.
        let candles = self.fetch_candles(symbol, resolution, lookback).await?;
        if candles.is_empty() {
            return Ok(());
        }

        let last_candle = candles.last().unwrap();
        let now = Utc::now();

        // Freshness Check: Is the data too stale? (e.g. ingestion pipeline down)
        // We allow up to 2x the resolution duration as a buffer.
        if (now - last_candle.timestamp) > (resolution_dur * 2) {
            warn!(
                "Strategy {id}: skipping tick due to stale data. Last candle: {}",
                last_candle.timestamp
            );
            return Ok(());
        }

        // ontinuity Check: Are there gaps in the sequence?
        for i in 1..candles.len() {
            let diff = candles[i].timestamp - candles[i - 1].timestamp;
            if diff > resolution_dur {
                warn!(
                    "Strategy {id}: skipping tick due to candle gap at {}",
                    candles[i].timestamp
                );
                return Ok(());
            }
        }

        // Check cooldown & deduplication (cheap fast path).
        {
            let cd_entry = self.cooldowns.get(&id).ok_or(StrategyError::NotFound(id))?;
            let cd = cd_entry.lock().await;
            if !cd.is_ready(cooldown_secs, max_per_day, Some(last_candle.timestamp)) {
                return Err(StrategyError::Cooldown);
            }
        }

        let (signal, indicator_snap) = evaluate(&strategy.kind, &candles);

        let price = last_candle.close;
        self.log_signal(id, signal, &indicator_snap, price).await?;

        if signal == Signal::Hold {
            return Ok(());
        }

        let result = self.execute_signal(&strategy, signal, price).await;

        if let Err(e) = result {
            error!("Strategy {id} execution failed: {e}. Pausing strategy.");
            // Auto-pause on critical errors to prevent cascading failures.
            let _ = self
                .update_status(id, &strategy.account_id, StrategyStatus::Paused)
                .await;
            return Err(e);
        }

        {
            let cd_entry = self.cooldowns.get(&id).ok_or(StrategyError::NotFound(id))?;
            let mut cd = cd_entry.lock().await;
            cd.record_execution(Some(last_candle.timestamp));
        }

        info!("Strategy {id} executed: {signal} @ {price}");
        Ok(())
    }

    /// Fetches the last `n` candles for a given symbol and resolution from the database.
    /// If symbol is "INDEX", it fetches from `index_candles`.
    /// Otherwise, it fetches from `asset_price_history` (e.g. "BTC", "ETH").
    async fn fetch_candles(
        &self,
        symbol: &str,
        resolution: &str,
        n: usize,
    ) -> Result<Vec<Candle>, StrategyError> {
        let candles = if symbol.to_uppercase() == "INDEX" {
            let rows: Vec<(Decimal, Decimal, Decimal, Decimal, DateTime<Utc>)> = sqlx::query_as(
                "SELECT open, high, low, close, timestamp
                 FROM index_candles
                 WHERE resolution = $1
                 ORDER BY timestamp DESC
                 LIMIT $2",
            )
            .bind(resolution)
            .bind(n as i64)
            .fetch_all(&self.db)
            .await?;

            rows.into_iter()
                .rev()
                .map(|(open, high, low, close, timestamp)| Candle {
                    open,
                    high,
                    low,
                    close,
                    timestamp,
                })
                .collect()
        } else {
            let rows: Vec<(Decimal, Decimal, Decimal, Decimal, DateTime<Utc>)> = sqlx::query_as(
                "SELECT open_usd, high_usd, low_usd, close_usd, timestamp
                 FROM asset_price_history
                 WHERE asset = $1 AND resolution = $2
                 ORDER BY timestamp DESC
                 LIMIT $3",
            )
            .bind(symbol.to_uppercase())
            .bind(resolution)
            .bind(n as i64)
            .fetch_all(&self.db)
            .await?;

            rows.into_iter()
                .rev()
                .map(|(open, high, low, close, timestamp)| Candle {
                    open,
                    high,
                    low,
                    close,
                    timestamp,
                })
                .collect()
        };

        Ok(candles)
    }

    async fn log_signal(
        &self,
        strategy_id: Uuid,
        signal: Signal,
        indicator: &serde_json::Value,
        price: Decimal,
    ) -> Result<(), StrategyError> {
        sqlx::query(
            "INSERT INTO strategy_signals (id, strategy_id, signal, indicator, price, fired_at)
             VALUES ($1, $2, $3, $4, $5, NOW())",
        )
        .bind(Uuid::new_v4())
        .bind(strategy_id)
        .bind(signal.to_string())
        .bind(indicator)
        .bind(price)
        .execute(&self.db)
        .await?;
        Ok(())
    }

    /// Internal helper to group execution steps and error handling.
    async fn execute_signal(
        &self,
        strategy: &Strategy,
        signal: Signal,
        price: Decimal,
    ) -> Result<(), StrategyError> {
        // Margin safety check.
        let snapshot = self
            .risk_engine
            .margin_snapshot(&strategy.account_id)
            .await
            .map_err(StrategyError::from)?;

        if !snapshot.margin_ratio.is_zero() && snapshot.margin_ratio < Decimal::new(11, 1) {
            return Err(StrategyError::InsufficientMargin);
        }

        let order_id = self.place_limit_order(&strategy, signal, price).await?;

        self.register_tp_sl(&strategy, signal).await;

        let rec = ExecutionRecord {
            strategy_id: strategy.id,
            account_id: strategy.account_id.clone(),
            signal,
            order_id: Some(order_id),
            price: Some(price),
            quantity: Some(extract_quantity(&strategy.kind)),
            error: None,
            executed_at: Utc::now(),
        };
        self.persist_execution(&rec).await?;
        Ok(())
    }

    /// Places a limit order via the in-memory order book and persists it.
    async fn place_limit_order(
        &self,
        strategy: &Strategy,
        signal: Signal,
        _current_price: Decimal,
    ) -> Result<Uuid, StrategyError> {
        let (limit_price, quantity, side) = extract_order_params(&strategy.kind, signal);
        let leverage = strategy.kind.leverage();

        let effective_quantity = quantity * Decimal::new(leverage as i64, 0);

        let book_side = match side {
            OrderSide::Buy => BookSide::Buy,
            OrderSide::Sell => BookSide::Sell,
        };

        let order = Order::new(
            &strategy.account_id,
            book_side,
            OrderType::Limit,
            Some(limit_price),
            // quantity,
            effective_quantity,
            Decimal::new(leverage as i64, 0),
        );
        let order_id = order.id;

        let (_, resting) = self
            .order_book
            .place_order(order)
            .await
            .map_err(|e| StrategyError::OrderPlacement(e.to_string()))?;

        let status = if resting.is_some() { "open" } else { "filled" };

        sqlx::query(
            "INSERT INTO orders (id, account_id, side, order_type, price, quantity, filled, status, leverage)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(order_id)
        .bind(&strategy.account_id)
        .bind(match side {
            OrderSide::Buy => "buy",
            OrderSide::Sell => "sell",
        })
        .bind("limit")
        .bind(limit_price)
        // .bind(quantity)
        .bind(effective_quantity)
        .bind(Decimal::ZERO)
        .bind(status)
        .bind(leverage as i32)
        .execute(&self.db)
        .await?;

        Ok(order_id)
    }

    /// Registers take-profit and stop-loss triggers via TriggerEngine.
    async fn register_tp_sl(&self, strategy: &Strategy, signal: Signal) {
        let (tp, sl) = extract_tp_sl(&strategy.kind);
        let order_side = match signal {
            Signal::Buy => TrigSide::Buy,
            Signal::Sell => TrigSide::Sell,
            _ => unreachable!("register_tp_sl called with Signal::Hold"),
        };
        // For a Buy entry: SL is below (Sell to close), TP is above (Sell to close).
        let close_side = match order_side {
            TrigSide::Buy => TrigSide::Sell,
            TrigSide::Sell => TrigSide::Buy,
        };

        let qty = extract_quantity(&strategy.kind);

        if let Some(tp_price) = tp {
            let trigger = Trigger {
                id: Uuid::new_v4(),
                account_id: strategy.account_id.clone(),
                trigger_price: tp_price,
                trigger_type: TriggerType::TakeProfit,
                side: close_side,
                size: qty,
                created_at: Utc::now(),
            };
            if let Err(e) = self.trigger_engine.add_trigger(trigger).await {
                warn!(
                    "Strategy {}: failed to register TP trigger: {e}",
                    strategy.id
                );
            }
        }

        if let Some(sl_price) = sl {
            let trigger = Trigger {
                id: Uuid::new_v4(),
                account_id: strategy.account_id.clone(),
                trigger_price: sl_price,
                trigger_type: TriggerType::StopLoss,
                side: close_side,
                size: qty,
                created_at: Utc::now(),
            };
            if let Err(e) = self.trigger_engine.add_trigger(trigger).await {
                warn!(
                    "Strategy {}: failed to register SL trigger: {e}",
                    strategy.id
                );
            }
        }
    }

    async fn persist_execution(&self, rec: &ExecutionRecord) -> Result<(), StrategyError> {
        sqlx::query(
            "INSERT INTO strategy_executions
               (id, strategy_id, account_id, signal, order_id, price, quantity, error, executed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(Uuid::new_v4())
        .bind(rec.strategy_id)
        .bind(&rec.account_id)
        .bind(rec.signal.to_string())
        .bind(rec.order_id)
        .bind(rec.price)
        .bind(rec.quantity)
        .bind(&rec.error)
        .bind(rec.executed_at)
        .execute(&self.db)
        .await?;
        Ok(())
    }

    // ─────────────────────────────────── Background run loop ───────────────

    /// The main strategy evaluation loop. Runs in a background `tokio::spawn`.
    ///
    /// Every 10 seconds:
    /// Snapshot active strategies.
    /// Spawn a bounded-concurrency task per strategy.
    /// Each task: fetch candles → evaluate → execute if signal ≠ Hold.
    pub async fn run_loop(self: Arc<Self>, cancel_token: CancellationToken) {
        info!("Strategy engine run loop started");
        let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_EVALS));

        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    info!("Strategy engine loop shutting down gracefully");
                    break;
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(10)) => {
                    let ids: Vec<Uuid> = self
                        .strategies
                        .iter()
                        .filter(|e| e.status == StrategyStatus::Active)
                        .map(|e| *e.key())
                        .collect();

                    for id in ids {
                        let engine = Arc::clone(&self);
                        let sem = Arc::clone(&semaphore);
                        tokio::spawn(async move {
                            let _permit = sem.acquire_owned().await.expect("semaphore closed");
                            if let Err(e) = engine.tick_strategy(id).await {
                                match &e {
                                    StrategyError::Cooldown | StrategyError::DailyCapReached(_) => {
                                    }
                                    _ => {
                                        error!("Strategy {id} tick error: {e}");
                                    }
                                }
                            }
                        });
                    }
                }
            }
        }
    }
}

// ──────────────────────────────────────── Dispatch helpers ───────────────────

fn reconstruct_kind(
    kind_str: &str,
    config: serde_json::Value,
) -> Result<StrategyKind, StrategyError> {
    use crate::types::*;
    match kind_str {
        "RangeDca" => {
            let c: RangeDcaConfig = serde_json::from_value(config)?;
            Ok(StrategyKind::RangeDca(c))
        }
        "SupportResistance" => {
            let c: SupportResistanceConfig = serde_json::from_value(config)?;
            Ok(StrategyKind::SupportResistance(c))
        }
        "RsiBased" => {
            let c: RsiConfig = serde_json::from_value(config)?;
            Ok(StrategyKind::RsiBased(c))
        }
        "EmaBased" => {
            let c: EmaConfig = serde_json::from_value(config)?;
            Ok(StrategyKind::EmaBased(c))
        }
        "SmartMoney" => {
            let c: SmartMoneyConfig = serde_json::from_value(config)?;
            Ok(StrategyKind::SmartMoney(c))
        }
        other => Err(StrategyError::Validation(format!(
            "Unknown strategy kind: {other}"
        ))),
    }
}

fn extract_timing(kind: &StrategyKind) -> (u64, Option<u32>) {
    match kind {
        StrategyKind::RangeDca(c) => (c.cooldown_secs, c.max_executions_per_day),
        StrategyKind::SupportResistance(c) => (c.cooldown_secs, c.max_executions_per_day),
        StrategyKind::RsiBased(c) => (c.cooldown_secs, c.max_executions_per_day),
        StrategyKind::EmaBased(c) => (c.cooldown_secs, c.max_executions_per_day),
        StrategyKind::SmartMoney(c) => (c.cooldown_secs, c.max_executions_per_day),
    }
}

fn evaluate(kind: &StrategyKind, candles: &[Candle]) -> (Signal, serde_json::Value) {
    match kind {
        StrategyKind::RangeDca(c) => evaluator::evaluate_range_dca(c, candles),
        StrategyKind::SupportResistance(c) => evaluator::evaluate_support_resistance(c, candles),
        StrategyKind::RsiBased(c) => evaluator::evaluate_rsi(c, candles),
        StrategyKind::EmaBased(c) => evaluator::evaluate_ema(c, candles),
        StrategyKind::SmartMoney(c) => evaluator::evaluate_smart_money(c, candles),
    }
}

fn extract_quantity(kind: &StrategyKind) -> Decimal {
    match kind {
        StrategyKind::RangeDca(c) => c.quantity,
        StrategyKind::SupportResistance(c) => c.quantity,
        StrategyKind::RsiBased(c) => c.quantity,
        StrategyKind::EmaBased(c) => c.quantity,
        StrategyKind::SmartMoney(c) => c.quantity,
    }
}

/// Returns (limit_price, quantity, order_side) — the order_side is determined
/// by the signal direction for SR/RangeDCA (config side), and signal for
/// indicator-based strategies.
fn extract_order_params(kind: &StrategyKind, signal: Signal) -> (Decimal, Decimal, OrderSide) {
    match kind {
        StrategyKind::RangeDca(c) => {
            // Use the explicit limit_price if set, otherwise use the closest grid level (approximated by 0).
            let price = c.limit_price.unwrap_or(Decimal::ZERO);
            (price, c.quantity, c.side)
        }
        StrategyKind::SupportResistance(c) => {
            let price = c
                .limit_price
                .unwrap_or_else(|| c.levels.first().copied().unwrap_or(Decimal::ZERO));
            (price, c.quantity, c.side)
        }
        StrategyKind::RsiBased(c) => {
            let side = match signal {
                Signal::Buy => OrderSide::Buy,
                Signal::Sell => OrderSide::Sell,
                Signal::Hold => OrderSide::Buy,
            };
            (c.limit_price, c.quantity, side)
        }
        StrategyKind::EmaBased(c) => {
            let side = match signal {
                Signal::Buy => OrderSide::Buy,
                Signal::Sell => OrderSide::Sell,
                Signal::Hold => OrderSide::Buy,
            };
            (c.limit_price, c.quantity, side)
        }
        StrategyKind::SmartMoney(c) => {
            let side = match signal {
                Signal::Buy => OrderSide::Buy,
                Signal::Sell => OrderSide::Sell,
                Signal::Hold => OrderSide::Buy,
            };
            (c.limit_price, c.quantity, side)
        }
    }
}

fn extract_tp_sl(kind: &StrategyKind) -> (Option<Decimal>, Option<Decimal>) {
    match kind {
        StrategyKind::RangeDca(c) => (c.take_profit, c.stop_loss),
        StrategyKind::SupportResistance(c) => (c.take_profit, c.stop_loss),
        StrategyKind::RsiBased(c) => (c.take_profit, c.stop_loss),
        StrategyKind::EmaBased(c) => (c.take_profit, c.stop_loss),
        StrategyKind::SmartMoney(c) => (c.take_profit, c.stop_loss),
    }
}
