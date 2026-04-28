use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{debug, error, info};
use uuid::Uuid;

use order_book::{Order, OrderBook, OrderType, Side as OrderSide};
use risk_engine::RiskEngine;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TriggerType {
    StopLoss,
    TakeProfit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trigger {
    pub id: Uuid,
    pub account_id: String,
    pub trigger_price: Decimal,
    pub trigger_type: TriggerType,
    pub side: Side,
    pub size: Decimal,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Error)]
pub enum TriggerError {
    #[error("Database error: {0}")]
    DbError(#[from] sqlx::Error),
    #[error("Risk error: {0}")]
    RiskError(String),
}

pub struct TriggerEngine {
    triggers_above: Arc<RwLock<BTreeMap<Decimal, Vec<Trigger>>>>,
    triggers_below: Arc<RwLock<BTreeMap<Decimal, Vec<Trigger>>>>,
    risk_engine: Arc<RiskEngine>,
    orderbook: Arc<OrderBook>,
    db: Option<sqlx::PgPool>,
}

impl TriggerEngine {
    pub fn new(
        risk_engine: Arc<RiskEngine>,
        orderbook: Arc<OrderBook>,
        db: Option<sqlx::PgPool>,
    ) -> Self {
        Self {
            triggers_above: Arc::new(RwLock::new(BTreeMap::new())),
            triggers_below: Arc::new(RwLock::new(BTreeMap::new())),
            risk_engine,
            orderbook,
            db,
        }
    }

    pub async fn add_trigger(&self, trigger: Trigger) -> Result<(), TriggerError> {
        if let Some(db) = &self.db {
            sqlx::query(
                "INSERT INTO triggers (id, account_id, trigger_price, trigger_type, side, size, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)"
            )
            .bind(trigger.id)
            .bind(&trigger.account_id)
            .bind(trigger.trigger_price)
            .bind(serde_json::to_string(&trigger.trigger_type).unwrap().replace("\"", ""))
            .bind(serde_json::to_string(&trigger.side).unwrap().replace("\"", ""))
            .bind(trigger.size)
            .bind(trigger.created_at)
            .execute(db)
            .await?;
        }

        let is_above = match trigger.trigger_type {
            TriggerType::StopLoss => trigger.side == Side::Buy,
            TriggerType::TakeProfit => trigger.side == Side::Sell,
        };

        if is_above {
            self.triggers_above
                .write()
                .await
                .entry(trigger.trigger_price)
                .or_default()
                .push(trigger);
        } else {
            self.triggers_below
                .write()
                .await
                .entry(trigger.trigger_price)
                .or_default()
                .push(trigger);
        }
        Ok(())
    }

    pub async fn active_triggers_count(&self) -> usize {
        let above = self.triggers_above.read().await;
        let below = self.triggers_below.read().await;
        let count_above: usize = above.values().map(|v| v.len()).sum();
        let count_below: usize = below.values().map(|v| v.len()).sum();
        count_above + count_below
    }

    pub async fn restore_from_db(&self) -> Result<(), TriggerError> {
        let db = match &self.db {
            Some(d) => d,
            None => return Ok(()),
        };

        let rows = sqlx::query(
            "SELECT id, account_id, trigger_price, trigger_type, side, size, created_at FROM triggers"
        )
        .fetch_all(db)
        .await?;

        let mut triggers_above = self.triggers_above.write().await;
        let mut triggers_below = self.triggers_below.write().await;
        let mut count = 0;

        for row in rows {
            use sqlx::Row;
            let trigger_type_str: String = row.get("trigger_type");
            let side_str: String = row.get("side");

            let trigger = Trigger {
                id: row.get("id"),
                account_id: row.get("account_id"),
                trigger_price: row.get("trigger_price"),
                trigger_type: match trigger_type_str.as_str() {
                    "STOP_LOSS" => TriggerType::StopLoss,
                    _ => TriggerType::TakeProfit,
                },
                side: match side_str.as_str() {
                    "BUY" => Side::Buy,
                    _ => Side::Sell,
                },
                size: row.get("size"),
                created_at: row.get("created_at"),
            };

            let is_above = match trigger.trigger_type {
                TriggerType::StopLoss => trigger.side == Side::Buy,
                TriggerType::TakeProfit => trigger.side == Side::Sell,
            };

            if is_above {
                triggers_above
                    .entry(trigger.trigger_price)
                    .or_default()
                    .push(trigger);
            } else {
                triggers_below
                    .entry(trigger.trigger_price)
                    .or_default()
                    .push(trigger);
            }
            count += 1;
        }
        info!("Restored {} triggers from DB", count);
        Ok(())
    }

    pub async fn run_loop(self: Arc<Self>, cancel_token: tokio_util::sync::CancellationToken) {
        if let Some(pool) = self.db.clone() {
            let engine = self.clone();
            let ct = cancel_token.clone();
            tokio::spawn(async move {
                let _ = engine.start_sync_listener(&pool, ct).await;
            });
        }

        let mut rx = self.risk_engine.subscribe_index();
        loop {
            tokio::select! {
                index_result = rx.recv() => {
                    if let Ok(index_val) = index_result {
                        // Latency Optimization: Drain the channel to get most recent price if lagging
                        let mut latest_price = index_val.price;
                        while let Ok(more) = rx.try_recv() {
                            latest_price = more.price;
                        }
                        self.check_triggers(latest_price).await;
                    } else {
                        break;
                    }
                }
                _ = cancel_token.cancelled() => {
                    info!("Trigger loop shutting down gracefully.");
                    break;
                }
            }
        }
    }

    async fn start_sync_listener(
        &self,
        pool: &sqlx::PgPool,
        cancel_token: tokio_util::sync::CancellationToken,
    ) -> anyhow::Result<()> {
        use sqlx::postgres::PgListener;
        let mut listener = PgListener::connect_with(pool).await?;
        listener.listen("trigger_updates").await?;

        info!("Trigger sync listener started.");

        loop {
            tokio::select! {
                notification_res = listener.recv() => {
                    if let Ok(notification) = notification_res {
                        let payload: serde_json::Value = serde_json::from_str(notification.payload())?;
                        let op = payload["op"].as_str().unwrap_or("");
                        let id_str = payload["id"].as_str().unwrap_or("");
                        let tid = Uuid::parse_str(id_str).unwrap_or(Uuid::nil());

                        match op {
                            "DELETE" => {
                                let mut above = self.triggers_above.write().await;
                                above.values_mut().for_each(|v| v.retain(|t| t.id != tid));
                                above.retain(|_, v| !v.is_empty());

                                let mut below = self.triggers_below.write().await;
                                below.values_mut().for_each(|v| v.retain(|t| t.id != tid));
                                below.retain(|_, v| !v.is_empty());
                            }
                            "INSERT" => {
                                if self.has_trigger(tid).await {
                                    continue;
                                }
                                let trigger = Trigger {
                                    id: tid,
                                    account_id: payload["account_id"].as_str().unwrap_or("").to_string(),
                                    trigger_price: payload["trigger_price"].as_str().unwrap_or("0").parse().unwrap_or_default(),
                                    trigger_type: serde_json::from_value(payload["trigger_type"].clone()).unwrap_or(TriggerType::StopLoss),
                                    side: serde_json::from_value(payload["side"].clone()).unwrap_or(Side::Buy),
                                    size: payload["size"].as_str().unwrap_or("0").parse().unwrap_or_default(),
                                    created_at: payload["created_at"].as_str().and_then(|t| t.parse().ok()).unwrap_or(Utc::now()),
                                };
                                let is_above = match trigger.trigger_type {
                                    TriggerType::StopLoss => trigger.side == Side::Buy,
                                    TriggerType::TakeProfit => trigger.side == Side::Sell,
                                };
                                if is_above {
                                    self.triggers_above.write().await.entry(trigger.trigger_price).or_default().push(trigger);
                                } else {
                                    self.triggers_below.write().await.entry(trigger.trigger_price).or_default().push(trigger);
                                }
                            }
                            _ => {}
                        }
                    } else {
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    }
                }
                _ = cancel_token.cancelled() => {
                    info!("Trigger sync listener shutting down gracefully.");
                    break;
                }
            }
        }
        Ok(())
    }

    async fn has_trigger(&self, id: Uuid) -> bool {
        let above = self.triggers_above.read().await;
        if above.values().flatten().any(|t| t.id == id) {
            return true;
        }
        let below = self.triggers_below.read().await;
        below.values().flatten().any(|t| t.id == id)
    }

    async fn check_triggers(&self, mark_price: Decimal) {
        let mut triggers_to_exec = Vec::new();

        // Check triggers_below (fire when mark_price <= trigger_price)
        {
            let mut below = self.triggers_below.write().await;
            let keys_to_remove: Vec<Decimal> = below.range(mark_price..).map(|(k, _)| *k).collect();
            for k in keys_to_remove {
                if let Some(mut triggers) = below.remove(&k) {
                    triggers_to_exec.append(&mut triggers);
                }
            }
        }

        // Check triggers_above (fire when mark_price >= trigger_price)
        {
            let mut above = self.triggers_above.write().await;
            let keys_to_remove: Vec<Decimal> =
                above.range(..=mark_price).map(|(k, _)| *k).collect();
            for k in keys_to_remove {
                if let Some(mut triggers) = above.remove(&k) {
                    triggers_to_exec.append(&mut triggers);
                }
            }
        }

        for t in triggers_to_exec {
            println!(
                "Executing trigger: {} at price {}",
                t.account_id, mark_price
            );
            info!(
                "Trigger hit for {}: Price {}, Side {:?}",
                t.account_id, mark_price, t.side
            );

            let market_order = Order {
                id: Uuid::new_v4(),
                account_id: t.account_id.clone(),
                side: match t.side {
                    Side::Buy => OrderSide::Buy,
                    Side::Sell => OrderSide::Sell,
                },
                order_type: OrderType::Market,
                price: None,
                quantity: t.size,
                leverage: rust_decimal_macros::dec!(1),
                filled: Decimal::ZERO,
                created_at: Utc::now(),
            };
            let market_order_id = market_order.id;
            let market_order_account_id = market_order.account_id.clone();
            let market_order_side = t.side;
            let market_order_quantity = t.size;

            if let Some(pool) = &self.db {
                // Try to acquire distributed lock
                let mut tx = match pool.begin().await {
                    Ok(tx) => tx,
                    Err(e) => {
                        error!("Failed to start transaction: {}", e);
                        self.reinsert_trigger(t).await;
                        continue;
                    }
                };

                // Lock the specific trigger row, skipping if another instance took it
                let lock_query = sqlx::query_as::<_, (Uuid,)>(
                    "SELECT id FROM triggers WHERE id = $1 FOR UPDATE SKIP LOCKED",
                )
                .bind(t.id)
                .fetch_optional(&mut *tx)
                .await;

                let locked_row = match lock_query {
                    Ok(row) => row,
                    Err(e) => {
                        error!("Database error while locking trigger {}: {}", t.id, e);
                        let _ = tx.rollback().await;
                        self.reinsert_trigger(t).await;
                        continue;
                    }
                };

                if locked_row.is_none() {
                    // Another instance already executing this trigger (or it was deleted).
                    // We don't re-insert it locally since it's being handled/done.
                    debug!(
                        "Trigger {} already locked or deleted by another instance",
                        t.id
                    );
                    continue;
                }

                match self.orderbook.place_order(market_order).await {
                    Err(e) => {
                        error!("Failed to execute trigger for {}: {:?}", t.account_id, e);
                        let _ = tx.rollback().await;
                        self.reinsert_trigger(t).await;
                    }
                    Ok((fills, _)) => {
                        // Persist the triggered Market Order first to satisfy FK constraints
                        if let Err(e) = sqlx::query(
                            "INSERT INTO orders (id, account_id, side, order_type, price, quantity, filled, status)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
                        )
                        .bind(market_order_id)
                        .bind(&market_order_account_id)
                        .bind(if market_order_side == Side::Buy { "buy" } else { "sell" })
                        .bind("market")
                        .bind(Option::<Decimal>::None)
                        .bind(market_order_quantity)
                        .bind(market_order_quantity) // Full fill assumed for market order if fills happen
                        .bind("filled")
                        .execute(&mut *tx)
                        .await {
                            error!("Failed to persist market order for trigger {}: {}", t.id, e);
                            let _ = tx.rollback().await;
                            self.reinsert_trigger(t).await;
                            continue;
                        }

                        for fill in &fills {
                            let (taker_delta, maker_delta) = if market_order_side == Side::Buy {
                                (fill.quantity, -fill.quantity)
                            } else {
                                (-fill.quantity, fill.quantity)
                            };

                            let _ = self
                                .risk_engine
                                .update_position_from_fill(
                                    fill.id,
                                    &fill.maker_account_id,
                                    maker_delta,
                                    fill.price,
                                    fill.maker_leverage,
                                )
                                .await;
                            let _ = self
                                .risk_engine
                                .update_position_from_fill(
                                    fill.id,
                                    &fill.taker_account_id,
                                    taker_delta,
                                    fill.price,
                                    fill.taker_leverage,
                                )
                                .await;

                            // Persist fill to DB within the same transaction
                            if let Err(e) = sqlx::query(
                                "INSERT INTO fills (id, maker_id, maker_account_id, taker_id, taker_account_id, price, quantity) VALUES ($1, $2, $3, $4, $5, $6, $7)"
                            )
                            .bind(fill.id)
                            .bind(fill.maker_id)
                            .bind(&fill.maker_account_id)
                            .bind(fill.taker_id)
                            .bind(&fill.taker_account_id)
                            .bind(fill.price)
                            .bind(fill.quantity)
                            .execute(&mut *tx)
                            .await {
                                error!("Failed to persist fill for trigger {}: {}", t.id, e);
                                let _ = tx.rollback().await;
                                self.reinsert_trigger(t).await;
                                return;
                            }
                        }

                        if let Err(e) = sqlx::query("DELETE FROM triggers WHERE id = $1")
                            .bind(t.id)
                            .execute(&mut *tx)
                            .await
                        {
                            error!("Failed to delete trigger {} after execution: {}", t.id, e);
                            let _ = tx.rollback().await;
                            self.reinsert_trigger(t).await;
                            return;
                        }

                        if let Err(e) = tx.commit().await {
                            error!("Failed to commit trigger execution for {}: {}", t.id, e);
                            self.reinsert_trigger(t).await;
                            return;
                        }
                        info!("Trigger {} executed successfully and committed", t.id);
                    }
                }
            } else {
                // Testing or non-DB mode
                match self.orderbook.place_order(market_order).await {
                    Err(e) => {
                        error!("Failed to execute trigger for {}: {:?}", t.account_id, e);
                        self.reinsert_trigger(t).await;
                    }
                    Ok((fills, _)) => {
                        for fill in fills {
                            let (taker_delta, maker_delta) = if t.side == Side::Buy {
                                (fill.quantity, -fill.quantity)
                            } else {
                                (-fill.quantity, fill.quantity)
                            };
                            let _ = self
                                .risk_engine
                                .update_position_from_fill(
                                    fill.id,
                                    &fill.maker_account_id,
                                    maker_delta,
                                    fill.price,
                                    fill.maker_leverage,
                                )
                                .await;
                            let _ = self
                                .risk_engine
                                .update_position_from_fill(
                                    fill.id,
                                    &fill.taker_account_id,
                                    taker_delta,
                                    fill.price,
                                    fill.taker_leverage,
                                )
                                .await;
                        }
                    }
                }
            }
        }
    }

    async fn reinsert_trigger(&self, t: Trigger) {
        let is_above = match t.trigger_type {
            TriggerType::StopLoss => t.side == Side::Buy,
            TriggerType::TakeProfit => t.side == Side::Sell,
        };
        if is_above {
            self.triggers_above
                .write()
                .await
                .entry(t.trigger_price)
                .or_default()
                .push(t);
        } else {
            self.triggers_below
                .write()
                .await
                .entry(t.trigger_price)
                .or_default()
                .push(t);
        }
    }
}