'use client';

import { useEffect, useRef, useState } from 'react';
import { KLineChartPro, Datafeed, SymbolInfo, Period } from '@klinecharts/pro';
import '@klinecharts/pro/dist/klinecharts-pro.css';
import { fetchIndexHistory, fetchAssetHistory, createMarketWS, PriceTick } from '@/lib/api';
import { useStore } from '@/lib/store';

// To prevent duplicate charts in React StrictMode/Next.js Dev, 
// we maintain a module-level reference to the active chart.
let activeChartInstance: KLineChartPro | null = null;

interface ChartProps {
  symbol?: string;
}

export default function Chart({ symbol = 'KXI' }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Force cleanup of any existing instance on this or previous mount
    if (activeChartInstance) {
      console.log('Kronix Chart: Disposing existing instance...');
      try {
        // Unfortunately KLineChartPro doesn't consistently expose a top-level dispose()
        // so we manually clear the DOM as a fallback if instance-level dispose fails.
        // We also check for 'dispose' method on the class if available.
        if ((activeChartInstance as any).dispose) {
           (activeChartInstance as any).dispose();
        }
      } catch (e) {
        console.warn('Kronix Chart: Dispose failed', e);
      }
      activeChartInstance = null;
    }

    // Always clear the container before creating a new chart to avoid stacking
    containerRef.current.innerHTML = '';

    let unsubWS: (() => void) | null = null;
    let liveTickCallback: ((data: any) => void) | null = null;
    let lastCandle: any = null;

    // Build the datafeed adapter for KLineChartPro
    const datafeed: Datafeed = {
      searchSymbols: async () => {
        const assets = ['KXI', 'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'LTC', 'XMR'];
        return assets.map(s => ({
          ticker: s,
          name: s === 'KXI' ? 'Kronix Index Perpetual KXI' : `${s} Perpetual`,
          shortName: s,
          exchange: 'Kronix',
          pricePrecision: 2,
          volumePrecision: 0,
          type: s === 'KXI' ? 'index' : 'crypto'
        }));
      },
      getHistoryKLineData: async (symbol: SymbolInfo, period: Period, from: number, to: number) => {
        // Map KLineChart periods to our stored resolution strings
        let resolution = '1d';
        const { multiplier, timespan } = period;
        
        let intervalSecs = 86400;
        if (timespan === 'minute') {
          intervalSecs = multiplier * 60;
          if (multiplier === 1) resolution = '1m';
          else if (multiplier === 5) resolution = '5m';
          else if (multiplier === 15) resolution = '15m';
          else if (multiplier === 30) resolution = '30m';
          else resolution = '5m';
        } else if (timespan === 'hour') {
          intervalSecs = multiplier * 3600;
          if (multiplier === 1) resolution = '1h';
          else if (multiplier === 4) resolution = '4h';
          else resolution = '1h';
        } else if (timespan === 'day') {
          resolution = '1d';
        } else if (timespan === 'week') {
          intervalSecs = 604800;
          resolution = '1w';
        } else if (timespan === 'month') {
          intervalSecs = 2592000;
          resolution = '1M';
        }

        try {
          const toSecs = Math.floor(to / 1000);
          const fromSecs = Math.floor(from / 1000);
          
          // Request at least a minimum number of bars to fill the view if range is small
          const rangeWidth = toSecs - fromSecs;
          const barsNeeded = Math.max(Math.ceil(rangeWidth / intervalSecs), 1500);

          const ticker = symbol.ticker || 'KXI';
          console.log(`Kronix Chart: Fetching ${ticker} ${resolution} from ${fromSecs} to ${toSecs} (bars: ${barsNeeded})`);
          const data = ticker === 'KXI'
            ? await fetchIndexHistory(resolution, fromSecs, toSecs, barsNeeded)
            : await fetchAssetHistory(ticker, resolution, fromSecs, toSecs, barsNeeded);

          const mapped = data
            .filter((d: any) => d.time && d.open && d.close)
            .map((d: any) => ({
              timestamp: d.time * 1000,
              open:  parseFloat(String(d.open)),
              high:  parseFloat(String(d.high)),
              low:   parseFloat(String(d.low)),
              close: parseFloat(String(d.close)),
            }));

          // Deduplicate by timestamp (prevents rendering glitches)
          const seen = new Set<number>();
          const deduped = mapped.filter((c: any) => {
            if (seen.has(c.timestamp)) return false;
            seen.add(c.timestamp);
            return true;
          });

          if (deduped.length > 0) {
            lastCandle = { ...deduped[deduped.length - 1], intervalSecs };
          }

          return deduped;
        } catch (e) {
          console.error('Failed to load chart data', e);
          return [];
        }
      },
      subscribe: (symbol: SymbolInfo, period: Period, callback: (data: any) => void) => {
        liveTickCallback = callback;
        const ticker = symbol.ticker || (typeof symbol === 'string' ? symbol : symbol.name);
        unsubWS = createMarketWS({
          onIndexPrice: (tick: PriceTick) => {
            if (ticker !== 'KXI') return;
            handleTick(tick);
          },
          onAssetPrice: (tick: PriceTick) => {
            if (tick.symbol !== ticker) return;
            handleTick(tick);
          },
          onCandleUpdate: (candle: any) => {
            if (candle.symbol !== ticker) return;
            console.log(`Kronix Chart: Candle Update for ${ticker}`, candle);
            
            if (!candle.data) return;

            // Round timestamp to current resolution to prevent "future" ghost candles
            const roundedTs = Math.floor(candle.data.timestamp / (intervalSecs * 1000)) * (intervalSecs * 1000);

            // Map backend candle to chart format
            const update = {
              timestamp: roundedTs,
              open:  parseFloat(String(candle.data.open)),
              high:  parseFloat(String(candle.data.high)),
              low:   parseFloat(String(candle.data.low)),
              close: parseFloat(String(candle.data.close)),
            };
            
            if (liveTickCallback) {
               liveTickCallback(update);
            }
          }
        });

        const handleTick = (tick: PriceTick) => {
          if (!lastCandle || !liveTickCallback) return;
          
          const tickTime = new Date(tick.timestamp).getTime();
          const candleStart = lastCandle.timestamp;
          const candleEnd = candleStart + (lastCandle.intervalSecs * 1000);

          if (tickTime >= candleStart && tickTime < candleEnd) {
            // Same candle: Update
            lastCandle.close = tick.price;
            lastCandle.high = Math.max(lastCandle.high, tick.price);
            lastCandle.low = Math.min(lastCandle.low, tick.price);
            liveTickCallback(lastCandle);
          } else if (tickTime >= candleEnd) {
            // New candle: Create and update lastCandle
            const newCandle = {
              timestamp: Math.floor(tickTime / (lastCandle.intervalSecs * 1000)) * (lastCandle.intervalSecs * 1000),
              open: tick.price,
              high: tick.price,
              low: tick.price,
              close: tick.price,
              volume: 1000,
              intervalSecs: lastCandle.intervalSecs
            };
            lastCandle = newCandle;
            liveTickCallback(newCandle);
          }
        };
      },
      unsubscribe: () => {
        if (unsubWS) unsubWS();
        unsubWS = null;
        liveTickCallback = null;
      },
    };

    console.log('Kronix Chart: Initializing new instance...');
    const chart = new KLineChartPro({
      container: containerRef.current,
      watermark: '',
      theme: 'dark',
      locale: 'en-US',
      timezone: 'Etc/UTC',
      drawingBarVisible: false,
      symbol: {
        exchange: 'KRONIX',
        market: symbol,
        name: symbol === 'KXI' ? 'Kronix Index Perpetual KXI' : `${symbol} Perpetual`,
        shortName: symbol,
        ticker: symbol,
        pricePrecision: 2,
        volumePrecision: 0,
        type: symbol === 'KXI' ? 'index' : 'crypto'
      },
      period: { multiplier: 1, timespan: 'day', text: '1d' },
      periods: [
        { multiplier: 1, timespan: 'minute', text: '1m' },
        { multiplier: 5, timespan: 'minute', text: '5m' },
        { multiplier: 15, timespan: 'minute', text: '15m' },
        { multiplier: 1, timespan: 'hour', text: '1h' },
        { multiplier: 4, timespan: 'hour', text: '4h' },
        { multiplier: 1, timespan: 'day', text: '1d' },
        { multiplier: 1, timespan: 'week', text: '1W' },
        { multiplier: 1, timespan: 'month', text: '1M' }
      ],
      mainIndicators: ['MA'],
      subIndicators: [],
      datafeed,
    });

    setTimeout(() => {
      try {
          if ((chart as any).removeIndicator) {
              (chart as any).removeIndicator('candle_pane', 'VOL');
              (chart as any).removeIndicator('candle_pane', 'Volume');
          }
      } catch (e) {
          (chart as any).removeIndicator('VOL');
          (chart as any).removeIndicator('Volume');
      }

      // Hack to hide screenshot, fullscreen, and timezone elements
      try {
         const container = document.getElementById('super-crypto-chart');
         if (container) {
             // Hide any elements containing "UTC", "screenshot", "full screen"
             const items = container.querySelectorAll('*');
             items.forEach(el => {
                 const text = (el.textContent || '').toLowerCase().trim();
                 const title = (el.getAttribute('title') || '').toLowerCase();
                 const className = (el.className || '').toString().toLowerCase();
                 
                 // Hide timezone
                 if (text === 'utc' || text === 'etc/utc' || text.includes('(utc')) {
                     (el as HTMLElement).style.display = 'none';
                 }
                 // Hide screenshot, fullscreen, and symbol search
                 // Hide screenshot and fullscreen
                 if (
                     className.includes('screenshot') || 
                     className.includes('fullscreen') ||
                     className.includes('timezone') ||
                     title.includes('screenshot') ||
                     title.includes('full screen') ||
                     title.includes('fullscreen')
                 ) {
                     (el as HTMLElement).style.display = 'none';
                 }
             });
         }
      } catch (e) {
          console.warn('Kronix Chart: Failed to hide UI elements', e);
      }
    }, 100);

    chart.setStyles({
      grid: {
        show: false,
        horizontal: { show: false, size: 1, color: '#f0f3fa', style: 'dashed' as any, dashedValue: [2, 2] },
        vertical: { show: false, size: 1, color: '#f0f3fa', style: 'dashed' as any, dashedValue: [2, 2] },
      },
      candle: {
        bar: {
          upColor: '#26a69a',        
          downColor: '#ef5350',      
          noChangeColor: '#888888',
          upBorderColor: '#26a69a',
          downBorderColor: '#ef5350',
          upWickColor: '#26a69a',
          downWickColor: '#ef5350',
        },
        priceMark: {
          show: true,
          high: { show: true, color: '#26a69a' },
          low: { show: true, color: '#ef5350' },
          last: {
            show: true,
            upColor: '#26a69a',
            downColor: '#ef5350',
            noChangeColor: '#888888',
            text: { show: true, color: '#ffffff', size: 12, family: 'var(--font-ibm-mono)', weight: 'bold' }
          }
        }
      },
      xAxis: {
        tickText: { color: '#787b86', size: 11 },
      },
      yAxis: {
        tickText: { color: '#787b86', size: 11 },
      },
      separator: { size: 1, color: '#e0e3eb', fill: true, activeBackgroundColor: '#d1d4dc' },
      crosshair: {
        show: true,
        horizontal: {
          show: true,
          line: { show: true, style: 'dashed' as any, dashedValue: [4, 2], size: 1, color: '#787b86' },
          text: { show: true, color: '#ffffff', size: 12, backgroundColor: '#131722' },
        },
        vertical: {
          show: true,
          line: { show: true, style: 'dashed' as any, dashedValue: [4, 2], size: 1, color: '#787b86' },
          text: { show: true, color: '#ffffff', size: 12, backgroundColor: '#131722' },
        },
      },
    });

    activeChartInstance = chart;

    // ── Click to select price ─────────────────────────────────────────────
    try {
      const klineChart = (chart as any).getChart?.();
      if (klineChart) {
        klineChart.subscribeAction('click', (event: any) => {
          if (event.price) {
            console.log('Kronix Chart: Selected price', event.price);
            useStore.getState().setSelectedPrice(event.price);
            
            // Clear previous price lines
            klineChart.removeShape('selected-price-line');
            
            // Add a horizontal line at the selected price
            klineChart.createShape({
              name: 'horizontalLine',
              id: 'selected-price-line',
              points: [{ price: event.price }],
              styles: {
                line: {
                  color: '#f0b90b',
                  size: 1,
                  style: 'dashed',
                  dashedValue: [4, 4]
                },
                text: {
                  show: true,
                  color: '#f0b90b',
                  size: 12,
                  family: 'JetBrains Mono',
                  weight: 'bold',
                  text: `PICKED: $${event.price.toFixed(2)}`
                }
              }
            });
          }
        });
      }
    } catch (e) {
      console.warn('Kronix Chart: Failed to subscribe to click events', e);
    }

    return () => {
      console.log('Kronix Chart: Cleaning up scroll events and instances...');
      if (unsubWS) unsubWS();
      if (activeChartInstance) {
          try {
            if ((activeChartInstance as any).dispose) (activeChartInstance as any).dispose();
          } catch {}
          activeChartInstance = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol]);

  return (
    <div className="chart-container" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        id="super-crypto-chart"
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#131722', 
        }}
      />
    </div>
  );
}
