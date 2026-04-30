mod index_engine;
mod ingestion;
mod live_aggregator;
mod routes_chart;
mod ws;

use crate::index_engine::IndexEngine;
use crate::ingestion::BinanceClient;
use actix_cors::Cors;
use actix_web::{web, App, HttpServer};
use chrono::{TimeZone, Utc};
use rust_decimal::prelude::ToPrimitive;
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("Failed to connect to DB");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run DB migrations");

    tracing::info!("✅ Migrations applied successfully");

    let index_engine = Arc::new(IndexEngine::new(pool.clone()));
    let (candle_tx, _) = broadcast::channel(1024);

    let index_engine_clone = Arc::clone(&index_engine);
    let candle_tx_agg = candle_tx.clone();
    let pool_clone = pool.clone();
    tokio::spawn(async move {
        let aggregator =
            live_aggregator::Live1mAggregator::new(index_engine_clone, pool_clone, candle_tx_agg);
        aggregator.run().await;
    });

    let index_engine_poller = Arc::clone(&index_engine);
    let candle_tx_poller = candle_tx.clone();
    let pool_poller = pool.clone();
    tokio::spawn(async move {
        let client = BinanceClient::new();
        let now = Utc::now().timestamp();
        let _three_years_ago = now - (3 * 365 * 24 * 3600);

        let resolutions = [
            ("1M", 5 * 365 * 24 * 3600), // 5 years
            ("1w", 5 * 365 * 24 * 3600), // 5 years
            ("1d", 3 * 365 * 24 * 3600), // 3 years
            ("4h", 90 * 24 * 3600),      // 90 days
            ("1h", 30 * 24 * 3600),      // 30 days
            ("15m", 7 * 24 * 3600),      // 7 days
            ("5m", 3 * 24 * 3600),       // 3 days
            ("1m", 24 * 3600),           // 24 hours
        ];

        for (res, depth) in resolutions {
            tracing::info!("--- Seeding resolution: {} (depth: {}s) ---", res, depth);
            let start_ts = now - depth;

            let mut data_map: HashMap<i64, HashMap<String, (f64, f64, f64, f64, f64)>> =
                HashMap::new();

            for &asset in index_engine::Asset::all() {
                let sym = asset.binance_symbol();
                let short = sym.replace("USDT", "");
                let mcap: f64 = match sym {
                    "BTCUSDT" => 1e12,
                    "ETHUSDT" => 3e11,
                    "SOLUSDT" => 8e10,
                    "BNBUSDT" => 8e10,
                    "XRPUSDT" => 5e10,
                    _ => 6e10,
                };

                if let Ok(klines) = client.fetch_klines(sym, res, start_ts, now).await {
                    tracing::info!("  {} - fetched {} candles", short, klines.len());
                    let to_f = |d: rust_decimal::Decimal| d.to_f64().unwrap_or(0.0);
                    for c in &klines {
                        let ts = c.timestamp.timestamp();
                        data_map.entry(ts).or_default().insert(
                            short.clone(),
                            (to_f(c.open), to_f(c.high), to_f(c.low), to_f(c.close), mcap),
                        );

                        let _ = sqlx::query("INSERT INTO asset_price_history (asset, resolution, timestamp, open_usd, high_usd, low_usd, close_usd) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (asset, resolution, timestamp) DO UPDATE SET open_usd=EXCLUDED.open_usd, high_usd=EXCLUDED.high_usd, low_usd=EXCLUDED.low_usd, close_usd=EXCLUDED.close_usd")
                            .bind(&short).bind(res).bind(c.timestamp).bind(c.open).bind(c.high).bind(c.low).bind(c.close).execute(&pool_poller).await;
                    }
                }
            }

            let index_assets = ["BTC", "ETH", "SOL", "BNB", "XRP"];
            let mut sorted_ts: Vec<i64> = data_map.keys().cloned().collect();
            sorted_ts.sort();

            let mut inserted = 0;
            for ts_val in sorted_ts {
                let prices = &data_map[&ts_val];
                if !index_assets.iter().all(|a| prices.contains_key(*a)) {
                    continue;
                }

                let sqrt_caps: Vec<f64> =
                    index_assets.iter().map(|a| prices[*a].4.sqrt()).collect();
                let total_sqrt: f64 = sqrt_caps.iter().sum();

                let (o, h, l, c) = {
                    let calc = |idx: usize| {
                        index_assets
                            .iter()
                            .zip(&sqrt_caps)
                            .map(|(a, w)| {
                                let val = match idx {
                                    0 => prices[*a].0,
                                    1 => prices[*a].1,
                                    2 => prices[*a].2,
                                    3 => prices[*a].3,
                                    _ => 0.0,
                                };
                                val * (w / total_sqrt)
                            })
                            .sum::<f64>()
                    };
                    (calc(0), calc(1), calc(2), calc(3))
                };

                let ts = Utc.timestamp_opt(ts_val, 0).unwrap();
                let _ = sqlx::query("INSERT INTO index_candles (resolution, timestamp, open, high, low, close) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (resolution, timestamp) DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close")
                    .bind(res).bind(ts).bind(o).bind(h).bind(l).bind(c).execute(&pool_poller).await;
                inserted += 1;
            }
            tracing::info!("✅ KXI {} seed complete - {} candles", res, inserted);
        }

        let mut live_candles: HashMap<(String, String), (f64, f64, f64, f64, i64)> = HashMap::new();

        loop {
            let mut ticker_data = HashMap::new();
            let resolutions = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"];

            for &asset in index_engine::Asset::all() {
                if let Ok(klines) = client
                    .fetch_klines(
                        asset.binance_symbol(),
                        "1m",
                        Utc::now().timestamp() - 60,
                        Utc::now().timestamp(),
                    )
                    .await
                {
                    if let Some(c) = klines.last() {
                        let res = index_engine_poller
                            .update_price(
                                index_engine::AssetPrice {
                                    asset,
                                    price_usd: c.close,
                                    market_cap_usd: c.market_cap,
                                    timestamp: c.timestamp,
                                },
                                None,
                            )
                            .await;

                        let short = asset.binance_symbol().replace("USDT", "");
                        let price_f = c.close.to_f64().unwrap_or(0.0);

                        for &r in &resolutions {
                            let period_secs = match r {
                                "1m" => 60,
                                "5m" => 300,
                                "15m" => 900,
                                "1h" => 3600,
                                "4h" => 14400,
                                "1d" => 86400,
                                "1w" => 604800,
                                "1M" => 2592000,
                                _ => 60,
                            };
                            let ts = (c.timestamp.timestamp() / period_secs) * period_secs;
                            let key = (short.clone(), r.to_string());

                            let entry = live_candles
                                .entry(key)
                                .or_insert((price_f, price_f, price_f, price_f, ts));
                            if entry.4 == ts {
                                entry.1 = f64::max(entry.1, price_f);
                                entry.2 = f64::min(entry.2, price_f);
                                entry.3 = price_f;
                            } else {
                                *entry = (price_f, price_f, price_f, price_f, ts);
                            }

                            let _ = candle_tx_poller.send(json!({
                                "type": "candle_update",
                                "symbol": short.clone(),
                                "resolution": r,
                                "data": { "timestamp": entry.4 * 1000, "open": entry.0, "high": entry.1, "low": entry.2, "close": entry.3 }
                            }));

                            let rounded_dt = Utc.timestamp_opt(entry.4, 0).unwrap();
                            let _ = sqlx::query("INSERT INTO asset_price_history (asset, resolution, timestamp, open_usd, high_usd, low_usd, close_usd) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (asset, resolution, timestamp) DO UPDATE SET close_usd=EXCLUDED.close_usd, high_usd=GREATEST(asset_price_history.high_usd, EXCLUDED.high_usd), low_usd=LEAST(asset_price_history.low_usd, EXCLUDED.low_usd)")
                                .bind(&short).bind(r).bind(rounded_dt).bind(entry.0).bind(entry.1).bind(entry.2).bind(entry.3).execute(&pool_poller).await;
                        }

                        let day_ago = Utc::now() - chrono::Duration::hours(24);
                        let prev = sqlx::query("SELECT close_usd FROM asset_price_history WHERE asset = $1 AND resolution = '1h' AND timestamp <= $2 ORDER BY timestamp DESC LIMIT 1")
                            .bind(&short).bind(day_ago).fetch_optional(&pool_poller).await.ok().flatten();
                        let change_24h = if let Some(r) = prev {
                            let p: rust_decimal::Decimal = r.get("close_usd");
                            let p_f = p.to_f64().unwrap_or(1.0);
                            (price_f - p_f) / p_f * 100.0
                        } else {
                            0.0
                        };
                        ticker_data.insert(
                            short.clone(),
                            json!({ "price": c.close, "change24h": change_24h }),
                        );

                        if let Ok(Some(iv)) = res {
                            let kxi_f = iv.price.to_f64().unwrap_or(0.0);
                            for &r in &resolutions {
                                let period_secs = match r {
                                    "1m" => 60,
                                    "5m" => 300,
                                    "15m" => 900,
                                    "1h" => 3600,
                                    "4h" => 14400,
                                    "1d" => 86400,
                                    "1w" => 604800,
                                    "1M" => 2592000,
                                    _ => 60,
                                };
                                let ts = (iv.timestamp.timestamp() / period_secs) * period_secs;
                                let key = ("KXI".to_string(), r.to_string());
                                let entry = live_candles
                                    .entry(key)
                                    .or_insert((kxi_f, kxi_f, kxi_f, kxi_f, ts));
                                if entry.4 == ts {
                                    entry.1 = f64::max(entry.1, kxi_f);
                                    entry.2 = f64::min(entry.2, kxi_f);
                                    entry.3 = kxi_f;
                                } else {
                                    *entry = (kxi_f, kxi_f, kxi_f, kxi_f, ts);
                                }

                                let _ = candle_tx_poller.send(json!({
                                    "type": "candle_update",
                                    "symbol": "KXI",
                                    "resolution": r,
                                    "data": { "timestamp": entry.4 * 1000, "open": entry.0, "high": entry.1, "low": entry.2, "close": entry.3 }
                                }));

                                let rounded_dt = Utc.timestamp_opt(entry.4, 0).unwrap();
                                let _ = sqlx::query("INSERT INTO index_candles (resolution, timestamp, open, high, low, close) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (resolution, timestamp) DO UPDATE SET close=EXCLUDED.close, high=GREATEST(index_candles.high, EXCLUDED.high), low=LEAST(index_candles.low, EXCLUDED.low)")
                                    .bind(r).bind(rounded_dt).bind(entry.0).bind(entry.1).bind(entry.2).bind(entry.3).execute(&pool_poller).await;
                            }

                            let kxi_prev = sqlx::query("SELECT close FROM index_candles WHERE resolution = '1h' AND timestamp <= $1 ORDER BY timestamp DESC LIMIT 1")
                                .bind(day_ago).fetch_optional(&pool_poller).await.ok().flatten();
                            let kxi_change = if let Some(r) = kxi_prev {
                                let p: rust_decimal::Decimal = r.get("close");
                                let p_f = p.to_f64().unwrap_or(1.0);
                                (kxi_f - p_f) / p_f * 100.0
                            } else {
                                0.0
                            };
                            ticker_data.insert(
                                "KXI".to_string(),
                                json!({ "price": iv.price, "change24h": kxi_change }),
                            );
                        }
                    }
                }
            }

            let _ = candle_tx_poller.send(json!({ "type": "ticker_update", "data": ticker_data }));
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        }
    });

    HttpServer::new(move || {
        App::new()
            .wrap(Cors::permissive())
            .app_data(web::Data::new(pool.clone()))
            .app_data(web::Data::new(index_engine.get_sender()))
            .app_data(web::Data::new(candle_tx.clone()))
            .service(routes_chart::get_index_chart)
            .service(routes_chart::get_asset_chart)
            .service(ws::ws_handler)
    })
    // .bind(("127.0.0.1", 8081))?
    .bind(("0.0.0.0", 8080))?
    .run()
    .await
}
