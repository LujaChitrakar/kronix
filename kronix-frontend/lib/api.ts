const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://crypto-exchange-0ff5.onrender.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OhlcCandle {
  time: number; // unix timestamp seconds — required by lightweight-charts
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface IndexPrice {
  price: string;
  twap: string | null;
  timestamp: string;
  weights: Record<string, string>;
}

// ─── REST helpers ─────────────────────────────────────────────────────────────

export async function fetchIndexPrice(): Promise<IndexPrice> {
  try {
    const res = await fetch(`${BASE_URL}/index/price`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`fetchIndexPrice: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[api] Failed to fetch index price, using fallback:', err);
    return {
      price: "35210.45",
      twap: "35205.12",
      timestamp: new Date().toISOString(),
      weights: { "BTC": "0.65", "ETH": "0.35" }
    };
  }
}

export async function fetchIndexHistory(resolution: string = '1d', from?: number, to?: number, countback?: number): Promise<OhlcCandle[]> {
  let url = `${BASE_URL}/chart/index?resolution=${resolution}`;
  if (from !== undefined) url += `&from=${from}`;
  if (to !== undefined) url += `&to=${to}`;
  if (countback !== undefined) url += `&countback=${countback}`;
  
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchIndexHistory: ${res.status}`);
  const data: Array<{ time: number; open: string; high: string; low: string; close: string }> =
    await res.json();

  return data
    .map((c) => ({
      time: c.time,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
    }))
    .sort((a, b) => a.time - b.time);
}

export async function fetchAssetHistory(symbol: string, resolution: string = '1d', from?: number, to?: number, countback?: number): Promise<OhlcCandle[]> {
  let url = `${BASE_URL}/chart/asset?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}`;
  if (from !== undefined) url += `&from=${from}`;
  if (to !== undefined) url += `&to=${to}`;
  if (countback !== undefined) url += `&countback=${countback}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchAssetHistory: ${res.status}`);
  const data: Array<{ time: number; open: string; high: string; low: string; close: string }> =
    await res.json();

  return data
    .map((c) => ({
      time: c.time,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
    }))
    .sort((a, b) => a.time - b.time);
}

// ─── Shared WebSocket Singleton ───────────────────────────────────────────────
export type PriceTick = { symbol: string; price: number; timestamp: string };
export type CandleUpdate = { symbol: string; timestamp: number; open: number; high: number; low: number; close: number };
export interface Level { price: number; quantity: number }
export interface OrderBookData { bids: Level[]; asks: Level[]; spread?: number; }
export interface TradeFill { id: string; price: number; quantity: number; side: string; created_at: string; }

let sharedWS: WebSocket | null = null;
const priceListeners = new Set<(tick: PriceTick) => void>();
const assetPriceListeners = new Set<(tick: PriceTick) => void>();
const candleListeners = new Set<(candle: CandleUpdate) => void>();
const orderbookListeners = new Set<(book: OrderBookData) => void>();
const tradesListeners = new Set<(trades: TradeFill[]) => void>();

let reconnectTimeout: any = null;
let heartbeatInterval: any = null;

function getWSUrl() {
  const wsBase = BASE_URL.replace(/^http/, 'ws');
  return `${wsBase}/ws`;
}

function connectSharedWS() {
  if (sharedWS && (sharedWS.readyState === WebSocket.OPEN || sharedWS.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log('[Kronix WS] Connecting to:', getWSUrl());
  sharedWS = new WebSocket(getWSUrl());

  sharedWS.onopen = () => {
    console.log('[Kronix WS] Connection established.');
    // Heartbeat every 30s to keep connection alive
    clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (sharedWS?.readyState === WebSocket.OPEN) {
        sharedWS.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  };

  sharedWS.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'index_price' && msg.data) {
        const tick: PriceTick = { 
          symbol: 'KXI',
          price: parseFloat(msg.data.price), 
          timestamp: msg.data.timestamp 
        };
        priceListeners.forEach(l => l(tick));
      } else if (msg.type === 'asset_price' && msg.data) {
        const tick: PriceTick = {
          symbol: msg.symbol,
          price: parseFloat(msg.data.price),
          timestamp: msg.data.timestamp
        };
        assetPriceListeners.forEach(l => l(tick));
      } else if (msg.type === 'candle_update' && msg.data) {
        const update: CandleUpdate = {
          symbol: msg.symbol,
          timestamp: msg.data.timestamp,
          open: parseFloat(msg.data.open),
          high: parseFloat(msg.data.high),
          low: parseFloat(msg.data.low),
          close: parseFloat(msg.data.close),
        };
        candleListeners.forEach(l => l(update));
      } else if (msg.type === 'orderbook' && msg.data) {
        // Parse numbers safely
        const book: OrderBookData = {
          bids: (msg.data.bids || []).map((b: any) => ({ price: parseFloat(b[0] || b.price), quantity: parseFloat(b[1] || b.quantity) })),
          asks: (msg.data.asks || []).map((a: any) => ({ price: parseFloat(a[0] || a.price), quantity: parseFloat(a[1] || a.quantity) })),
        };
        orderbookListeners.forEach(l => l(book));
      } else if (msg.type === 'trades' && msg.data) {
        const trades = msg.data.map((t: any) => ({
          ...t,
          price: parseFloat(t.price),
          quantity: parseFloat(t.quantity),
        }));
        tradesListeners.forEach(l => l(trades));
      }
    } catch (e) {
      /* ignore */
    }
  };

  sharedWS.onclose = () => {
    console.log('[Kronix WS] Connection closed. Retrying in 3s...');
    sharedWS = null;
    clearInterval(heartbeatInterval);
    clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connectSharedWS, 3000);
  };

  sharedWS.onerror = (err) => {
    console.error('[Kronix WS] Connection error:', err);
  };
}

export function createMarketWS(callbacks: {
  onIndexPrice?: (tick: PriceTick) => void;
  onAssetPrice?: (tick: PriceTick) => void;
  onCandleUpdate?: (candle: CandleUpdate) => void;
  onOrderbook?: (book: OrderBookData) => void;
  onTrades?: (trades: TradeFill[]) => void;
  onError?: (err: Event) => void;
}): () => void {
  if (callbacks.onIndexPrice) priceListeners.add(callbacks.onIndexPrice);
  if (callbacks.onAssetPrice) assetPriceListeners.add(callbacks.onAssetPrice);
  if (callbacks.onCandleUpdate) candleListeners.add(callbacks.onCandleUpdate);
  if (callbacks.onOrderbook) orderbookListeners.add(callbacks.onOrderbook);
  if (callbacks.onTrades) tradesListeners.add(callbacks.onTrades);
  
  connectSharedWS();

  return () => {
    if (callbacks.onIndexPrice) priceListeners.delete(callbacks.onIndexPrice);
    if (callbacks.onAssetPrice) assetPriceListeners.delete(callbacks.onAssetPrice);
    if (callbacks.onCandleUpdate) candleListeners.delete(callbacks.onCandleUpdate);
    if (callbacks.onOrderbook) orderbookListeners.delete(callbacks.onOrderbook);
    if (callbacks.onTrades) tradesListeners.delete(callbacks.onTrades);
  };
}
