use actix_web::{get, web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt;
use serde_json::json;
use tokio::sync::broadcast;
use crate::index_engine::IndexValue;

#[get("/ws")]
pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    index_rx: web::Data<broadcast::Sender<IndexValue>>,
    candle_rx: web::Data<broadcast::Sender<serde_json::Value>>,
) -> Result<HttpResponse, actix_web::Error> {
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;
    let mut index_sub = index_rx.subscribe();
    let mut candle_sub = candle_rx.subscribe();

    actix_web::rt::spawn(async move {
        loop {
            tokio::select! {
                Ok(iv) = index_sub.recv() => {
                    let _ = session.text(json!({ "type": "index_price", "data": iv }).to_string()).await;
                }
                Ok(candle) = candle_sub.recv() => {
                    let _ = session.text(candle.to_string()).await;
                }
                msg = msg_stream.next() => {
                    match msg {
                        Some(Ok(Message::Ping(bytes))) => {
                            let _ = session.pong(&bytes).await;
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        _ => {}
                    }
                }
            }
        }
    });

    Ok(response)
}
