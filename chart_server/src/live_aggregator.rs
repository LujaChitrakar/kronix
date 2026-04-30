use std::{
    collections::HashMap,
    sync::Arc,
};
use tokio::sync::broadcast;
use sqlx::PgPool;
use crate::index_engine::IndexEngine;
use serde_json::json;

pub struct Live1mAggregator {
    index_engine: Arc<IndexEngine>,
    db: PgPool,
    candle_tx: broadcast::Sender<serde_json::Value>,
}

impl Live1mAggregator {
    pub fn new(index_engine: Arc<IndexEngine>, db: PgPool, candle_tx: broadcast::Sender<serde_json::Value>) -> Self {
        Self { index_engine, db, candle_tx }
    }
    pub async fn run(self) {
        let mut rx = self.index_engine.subscribe();
        while let Ok(iv) = rx.recv().await {
            let candle = json!({
                "type": "candle_update",
                "symbol": "KXI",
                "data": {
                    "timestamp": iv.timestamp.timestamp() * 1000,
                    "open": iv.price, "high": iv.price, "low": iv.price, "close": iv.price
                }
            });
            let _ = self.candle_tx.send(candle);
        }
    }
}
