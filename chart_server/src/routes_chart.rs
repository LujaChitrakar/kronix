use actix_web::{get, web, HttpResponse, Responder};
use chrono::TimeZone;
use chrono::{DateTime, Utc};
use rust_decimal::prelude::ToPrimitive;
use serde::Deserialize;
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct ChartQuery {
    pub symbol: Option<String>,
    pub resolution: String,
    pub from: i64,
    pub to: i64,
}

#[get("/chart/index")]
pub async fn get_index_chart(
    pool: web::Data<PgPool>,
    query: web::Query<ChartQuery>,
) -> impl Responder {
    let res = sqlx::query(
        "SELECT timestamp, open, high, low, close FROM index_candles WHERE resolution = $1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp ASC"
    )
    .bind(&query.resolution)
    .bind(Utc.timestamp_opt(query.from, 0).unwrap())
    .bind(Utc.timestamp_opt(query.to, 0).unwrap())
    .fetch_all(pool.get_ref())
    .await;

    match res {
        Ok(rows) => {
            let candles: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    use sqlx::Row;
                    let ts: DateTime<Utc> = r.get("timestamp");
                    let o: rust_decimal::Decimal = r.get("open");
                    let h: rust_decimal::Decimal = r.get("high");
                    let l: rust_decimal::Decimal = r.get("low");
                    let c: rust_decimal::Decimal = r.get("close");
                    serde_json::json!({
                        "time": ts.timestamp(),
                        "open": o.to_string(),
                        "high": h.to_string(),
                        "low": l.to_string(),
                        "close": c.to_string()
                    })
                })
                .collect();
            HttpResponse::Ok().json(candles)
        }
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/chart/asset")]
pub async fn get_asset_chart(
    pool: web::Data<PgPool>,
    query: web::Query<ChartQuery>,
) -> impl Responder {
    let symbol = query.symbol.clone().unwrap_or_else(|| "BTC".to_string());
    let res = sqlx::query(
        "SELECT timestamp, open_usd, high_usd, low_usd, close_usd FROM asset_price_history WHERE asset = $1 AND resolution = $2 AND timestamp >= $3 AND timestamp <= $4 ORDER BY timestamp ASC"
    )
    .bind(symbol)
    .bind(&query.resolution)
    .bind(Utc.timestamp_opt(query.from, 0).unwrap())
    .bind(Utc.timestamp_opt(query.to, 0).unwrap())
    .fetch_all(pool.get_ref())
    .await;

    match res {
        Ok(rows) => {
            let candles: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    use sqlx::Row;
                    let ts: DateTime<Utc> = r.get("timestamp");
                    let o: rust_decimal::Decimal = r.get("open_usd");
                    let h: rust_decimal::Decimal = r.get("high_usd");
                    let l: rust_decimal::Decimal = r.get("low_usd");
                    let c: rust_decimal::Decimal = r.get("close_usd");
                    serde_json::json!({
                        "time": ts.timestamp(),
                        "open": o.to_string(),
                        "high": h.to_string(),
                        "low": l.to_string(),
                        "close": c.to_string()
                    })
                })
                .collect();
            HttpResponse::Ok().json(candles)
        }
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/index/price/value")]
pub async fn get_current_index_value(pool: web::Data<PgPool>) -> impl Responder {
    let res =
        sqlx::query("SELECT timestamp, close FROM index_candles ORDER BY timestamp DESC LIMIT 1")
            .fetch_optional(pool.get_ref())
            .await;

    match res {
        Ok(Some(row)) => {
            use sqlx::Row;
            let val: rust_decimal::Decimal = row.get("close");

            HttpResponse::Ok().body(val.to_string())
        }
        Ok(None) => HttpResponse::NotFound().body("0"),
        Err(e) => {
            eprintln!("Database error: {:?}", e);
            HttpResponse::InternalServerError().finish()
        }
    }
}
