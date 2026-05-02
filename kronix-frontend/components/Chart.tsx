"use client";

import { useEffect, useRef, useState } from "react";
import { KLineChartPro, Datafeed, SymbolInfo, Period } from "@klinecharts/pro";
import "@klinecharts/pro/dist/klinecharts-pro.css";
import {
  fetchIndexHistory,
  fetchAssetHistory,
  createMarketWS,
  PriceTick,
} from "@/lib/api";
import { useStore } from "@/lib/store";

// To prevent duplicate charts in React StrictMode/Next.js Dev,
// we maintain a module-level reference to the active chart.
let activeChartInstance: KLineChartPro | null = null;

interface ChartProps {
  symbol?: string;
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 2 }}
    >
      <span
        style={{
          color: "rgba(255,255,255,0.45)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          fontFamily: "var(--font-ibm-mono)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: color ?? "#ffffff",
          fontSize: 13.5,
          fontFamily: "var(--font-ibm-mono)",
          fontWeight: 600,
          letterSpacing: 0.2,
        }}
      >
        {value}
      </span>
    </div>
  );
}

const AVAILABLE_SYMBOLS = ["KXI", "SOL"];

export default function Chart({ symbol = "KXI" }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(symbol);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [openPrice24h, setOpenPrice24h] = useState<number | null>(null);
  const activeTickerRef = useRef<string>(symbol);

  useEffect(() => {
    setSelectedSymbol(symbol);
  }, [symbol]);

  useEffect(() => {
    activeTickerRef.current = selectedSymbol;
  }, [selectedSymbol]);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Force cleanup of any existing instance on this or previous mount
    if (activeChartInstance) {
      console.log("Kronix Chart: Disposing existing instance...");
      try {
        // Unfortunately KLineChartPro doesn't consistently expose a top-level dispose()
        // so we manually clear the DOM as a fallback if instance-level dispose fails.
        // We also check for 'dispose' method on the class if available.
        if ((activeChartInstance as any).dispose) {
          (activeChartInstance as any).dispose();
        }
      } catch (e) {
        console.warn("Kronix Chart: Dispose failed", e);
      }
      activeChartInstance = null;
    }

    // Always clear the container before creating a new chart to avoid stacking
    containerRef.current.innerHTML = "";

    let unsubWS: (() => void) | null = null;
    let liveTickCallback: ((data: any) => void) | null = null;
    let lastCandle: any = null;

    // Build the datafeed adapter for KLineChartPro
    const datafeed: Datafeed = {
      searchSymbols: async () => {
        const assets = ["KXI", "BTC", "ETH", "SOL", "BNB", "XRP", "LTC", "XMR"];
        return assets.map((s) => ({
          ticker: s,
          name: s === "KXI" ? "Kronix Index Perpetual KXI" : `${s} Perpetual`,
          shortName: s,
          exchange: "Kronix",
          pricePrecision: 2,
          volumePrecision: 0,
          type: s === "KXI" ? "index" : "crypto",
        }));
      },
      getHistoryKLineData: async (
        symbol: SymbolInfo,
        period: Period,
        from: number,
        to: number,
      ) => {
        // Map KLineChart periods to our stored resolution strings
        let resolution = "1d";
        const { multiplier, timespan } = period;

        let intervalSecs = 86400;
        if (timespan === "minute") {
          intervalSecs = multiplier * 60;
          if (multiplier === 1) resolution = "1m";
          else if (multiplier === 5) resolution = "5m";
          else if (multiplier === 15) resolution = "15m";
          else if (multiplier === 30) resolution = "30m";
          else resolution = "5m";
        } else if (timespan === "hour") {
          intervalSecs = multiplier * 3600;
          if (multiplier === 1) resolution = "1h";
          else if (multiplier === 4) resolution = "4h";
          else resolution = "1h";
        } else if (timespan === "day") {
          resolution = "1d";
        } else if (timespan === "week") {
          intervalSecs = 604800;
          resolution = "1w";
        } else if (timespan === "month") {
          intervalSecs = 2592000;
          resolution = "1M";
        }

        try {
          const toSecs = Math.floor(to / 1000);
          const fromSecs = Math.floor(from / 1000);

          // Request at least a minimum number of bars to fill the view if range is small
          const rangeWidth = toSecs - fromSecs;
          const barsNeeded = Math.max(
            Math.ceil(rangeWidth / intervalSecs),
            1500,
          );

          const ticker = symbol.ticker || "KXI";
          console.log(
            `Kronix Chart: Fetching ${ticker} ${resolution} from ${fromSecs} to ${toSecs} (bars: ${barsNeeded})`,
          );
          const data =
            ticker === "KXI"
              ? await fetchIndexHistory(
                  resolution,
                  fromSecs,
                  toSecs,
                  barsNeeded,
                )
              : await fetchAssetHistory(
                  ticker,
                  resolution,
                  fromSecs,
                  toSecs,
                  barsNeeded,
                );

          const mapped = data
            .filter((d: any) => d.time && d.open && d.close)
            .map((d: any) => ({
              timestamp: d.time * 1000,
              open: parseFloat(String(d.open)),
              high: parseFloat(String(d.high)),
              low: parseFloat(String(d.low)),
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
            if (activeTickerRef.current === ticker) {
              setCurrentPrice(deduped[deduped.length - 1].close);
              const cutoff = (Math.floor(Date.now() / 1000) - 86400) * 1000;
              const open24 = [...deduped]
                .reverse()
                .find((c: any) => c.timestamp <= cutoff);
              setOpenPrice24h(open24 ? open24.close : deduped[0].close);
            }
          }

          return deduped;
        } catch (e) {
          console.error("Failed to load chart data", e);
          return [];
        }
      },
      subscribe: (
        symbol: SymbolInfo,
        period: Period,
        callback: (data: any) => void,
      ) => {
        liveTickCallback = callback;
        const ticker =
          symbol.ticker || (typeof symbol === "string" ? symbol : symbol.name);
        unsubWS = createMarketWS({
          onIndexPrice: (tick: PriceTick) => {
            if (ticker !== "KXI") return;
            handleTick(tick);
          },
          onAssetPrice: (tick: PriceTick) => {
            if (tick.symbol !== ticker) return;
            handleTick(tick);
          },
          onCandleUpdate: (candle: any) => {
            if (candle.symbol !== ticker) return;
            if (activeTickerRef.current !== ticker) return;
            console.log(`Kronix Chart: Candle Update for ${ticker}`, candle);

            if (!candle.data) return;

            // Round timestamp to current resolution to prevent "future" ghost candles
            const roundedTs =
              Math.floor(candle.data.timestamp / (intervalSecs * 1000)) *
              (intervalSecs * 1000);

            // Map backend candle to chart format
            const update = {
              timestamp: roundedTs,
              open: parseFloat(String(candle.data.open)),
              high: parseFloat(String(candle.data.high)),
              low: parseFloat(String(candle.data.low)),
              close: parseFloat(String(candle.data.close)),
            };

            setCurrentPrice(update.close);

            if (liveTickCallback) {
              liveTickCallback(update);
            }
          },
        });

        const handleTick = (tick: PriceTick) => {
          if (!lastCandle || !liveTickCallback) return;
          if (activeTickerRef.current !== ticker) return;

          const tickTime = new Date(tick.timestamp).getTime();
          const candleStart = lastCandle.timestamp;
          const candleEnd = candleStart + lastCandle.intervalSecs * 1000;

          setCurrentPrice(tick.price);

          if (tickTime >= candleStart && tickTime < candleEnd) {
            // Same candle: Update
            lastCandle.close = tick.price;
            lastCandle.high = Math.max(lastCandle.high, tick.price);
            lastCandle.low = Math.min(lastCandle.low, tick.price);
            liveTickCallback(lastCandle);
          } else if (tickTime >= candleEnd) {
            // New candle: Create and update lastCandle
            const newCandle = {
              timestamp:
                Math.floor(tickTime / (lastCandle.intervalSecs * 1000)) *
                (lastCandle.intervalSecs * 1000),
              open: tick.price,
              high: tick.price,
              low: tick.price,
              close: tick.price,
              volume: 1000,
              intervalSecs: lastCandle.intervalSecs,
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

    console.log("Kronix Chart: Initializing new instance...");
    const chart = new KLineChartPro({
      container: containerRef.current,
      watermark: "",
      theme: "dark",
      locale: "en-US",
      timezone: "Etc/UTC",
      drawingBarVisible: false,
      symbol: {
        exchange: "KRONIX",
        market: selectedSymbol,
        name:
          selectedSymbol === "KXI"
            ? "Kronix Index Perpetual KXI"
            : `${selectedSymbol} Perpetual`,
        shortName: selectedSymbol,
        ticker: selectedSymbol,
        pricePrecision: 2,
        volumePrecision: 0,
        type: selectedSymbol === "KXI" ? "index" : "crypto",
      },
      period: { multiplier: 1, timespan: "day", text: "1d" },
      periods: [
        { multiplier: 1, timespan: "minute", text: "1m" },
        { multiplier: 5, timespan: "minute", text: "5m" },
        { multiplier: 15, timespan: "minute", text: "15m" },
        { multiplier: 1, timespan: "hour", text: "1h" },
        { multiplier: 4, timespan: "hour", text: "4h" },
        { multiplier: 1, timespan: "day", text: "1d" },
        { multiplier: 1, timespan: "week", text: "1W" },
        { multiplier: 1, timespan: "month", text: "1M" },
      ],
      mainIndicators: [],
      subIndicators: [],
      datafeed,
    });

    setTimeout(() => {
      try {
        if ((chart as any).removeIndicator) {
          (chart as any).removeIndicator("candle_pane", "VOL");
          (chart as any).removeIndicator("candle_pane", "Volume");
        }
      } catch (e) {
        (chart as any).removeIndicator("VOL");
        (chart as any).removeIndicator("Volume");
      }

      // Hack to hide screenshot, fullscreen, and timezone elements
      try {
        const container = document.getElementById("super-crypto-chart");
        if (container) {
          // Hide any elements containing "UTC", "screenshot", "full screen"
          const items = container.querySelectorAll("*");
          items.forEach((el) => {
            const text = (el.textContent || "").toLowerCase().trim();
            const title = (el.getAttribute("title") || "").toLowerCase();
            const className = (el.className || "").toString().toLowerCase();

            // Hide timezone
            if (text === "utc" || text === "etc/utc" || text.includes("(utc")) {
              (el as HTMLElement).style.display = "none";
            }
            // Hide screenshot, fullscreen, and symbol search
            // Hide screenshot and fullscreen
            if (
              className.includes("screenshot") ||
              className.includes("fullscreen") ||
              className.includes("timezone") ||
              title.includes("screenshot") ||
              title.includes("full screen") ||
              title.includes("fullscreen")
            ) {
              (el as HTMLElement).style.display = "none";
            }
          });
        }
      } catch (e) {
        console.warn("Kronix Chart: Failed to hide UI elements", e);
      }
    }, 100);

    chart.setStyles({
      grid: {
        show: true,
        horizontal: {
          show: true,
          size: 1,
          color: "rgba(77,255,180,0.04)",
          style: "dashed" as any,
          dashedValue: [2, 4],
        },
        vertical: {
          show: true,
          size: 1,
          color: "rgba(77,255,180,0.04)",
          style: "dashed" as any,
          dashedValue: [2, 4],
        },
      },
      candle: {
        bar: {
          upColor: "#4dffb4",
          downColor: "#ff5c5c",
          noChangeColor: "#888888",
          upBorderColor: "#4dffb4",
          downBorderColor: "#ff5c5c",
          upWickColor: "#4dffb4",
          downWickColor: "#ff5c5c",
        },
        priceMark: {
          show: true,
          high: { show: true, color: "#4dffb4" },
          low: { show: true, color: "#ff5c5c" },
          last: {
            show: true,
            upColor: "#4dffb4",
            downColor: "#ff5c5c",
            noChangeColor: "#888888",
            text: {
              show: true,
              color: "#0B0F0D",
              size: 11,
              family: "var(--font-ibm-mono)",
              weight: "bold",
            },
          },
        },
        tooltip: { showRule: "none" as any, custom: [] as any },
      },
      xAxis: {
        axisLine: { color: "rgba(77,255,180,0.10)", size: 1 },
        tickLine: {
          show: true,
          size: 1,
          length: 3,
          color: "rgba(255,255,255,0.25)",
        },
        tickText: {
          color: "rgba(255,255,255,0.55)",
          size: 11,
          family: "var(--font-ibm-mono)",
        },
      },
      yAxis: {
        axisLine: { color: "rgba(77,255,180,0.10)", size: 1 },
        tickLine: {
          show: true,
          size: 1,
          length: 3,
          color: "rgba(255,255,255,0.25)",
        },
        tickText: {
          color: "rgba(255,255,255,0.55)",
          size: 11,
          family: "var(--font-ibm-mono)",
        },
      },
      separator: {
        size: 1,
        color: "rgba(77,255,180,0.08)",
        fill: true,
        activeBackgroundColor: "rgba(77,255,180,0.18)",
      },
      crosshair: {
        show: true,
        horizontal: {
          show: true,
          line: {
            show: true,
            style: "dashed" as any,
            dashedValue: [4, 2],
            size: 1,
            color: "rgba(77,255,180,0.4)",
          },
          text: {
            show: true,
            color: "#0B0F0D",
            size: 11,
            backgroundColor: "#4dffb4",
            family: "var(--font-ibm-mono)",
            weight: "bold",
          },
        },
        vertical: {
          show: true,
          line: {
            show: true,
            style: "dashed" as any,
            dashedValue: [4, 2],
            size: 1,
            color: "rgba(77,255,180,0.4)",
          },
          text: {
            show: true,
            color: "#0B0F0D",
            size: 11,
            backgroundColor: "#4dffb4",
            family: "var(--font-ibm-mono)",
            weight: "bold",
          },
        },
      },
    });

    activeChartInstance = chart;

    // ── Click to select price ─────────────────────────────────────────────
    try {
      const klineChart = (chart as any).getChart?.();
      if (klineChart) {
        klineChart.subscribeAction("click", (event: any) => {
          if (event.price) {
            console.log("Kronix Chart: Selected price", event.price);
            useStore.getState().setSelectedPrice(event.price);

            // Clear previous price lines
            klineChart.removeShape("selected-price-line");

            // Add a horizontal line at the selected price
            klineChart.createShape({
              name: "horizontalLine",
              id: "selected-price-line",
              points: [{ price: event.price }],
              styles: {
                line: {
                  color: "#4dffb4",
                  size: 1,
                  style: "dashed",
                  dashedValue: [4, 4],
                },
                text: {
                  show: true,
                  color: "#0B0F0D",
                  size: 11,
                  family: "var(--font-ibm-mono)",
                  weight: "bold",
                  backgroundColor: "#4dffb4",
                  text: `PICKED: $${event.price.toFixed(2)}`,
                },
              },
            });
          }
        });
      }
    } catch (e) {
      console.warn("Kronix Chart: Failed to subscribe to click events", e);
    }

    return () => {
      console.log("Kronix Chart: Cleaning up scroll events and instances...");
      if (unsubWS) unsubWS();
      if (activeChartInstance) {
        try {
          if ((activeChartInstance as any).dispose)
            (activeChartInstance as any).dispose();
        } catch {}
        activeChartInstance = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [selectedSymbol]);

  const change24h =
    currentPrice != null && openPrice24h != null && openPrice24h !== 0
      ? ((currentPrice - openPrice24h) / openPrice24h) * 100
      : null;
  const changeColor =
    change24h == null
      ? "rgba(255,255,255,0.45)"
      : change24h >= 0
        ? "#4dffb4"
        : "#ff5c5c";

  const fmtPrice = (p: number | null) =>
    p == null
      ? "—"
      : `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div
      className="chart-container"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: "#14181A",
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
            #super-crypto-chart .klinecharts-pro {
              --klinecharts-pro-background-color: #14181A !important;
              --klinecharts-pro-popover-background-color: #181D1F !important;
              --klinecharts-pro-text-color: #ffffff !important;
              --klinecharts-pro-text-second-color: rgba(255,255,255,0.55) !important;
              --klinecharts-pro-border-color: rgba(77,255,180,0.10) !important;
              --klinecharts-pro-primary-color: #4dffb4 !important;
              --klinecharts-pro-hover-background-color: rgba(77,255,180,0.10) !important;
              --klinecharts-pro-selected-color: rgba(77,255,180,0.15) !important;
              height: 100% !important;
              width: 100% !important;
              background-color: #14181A !important;
            }
            #super-crypto-chart .klinecharts-pro-period-bar .symbol { display: none !important; }
            #super-crypto-chart .klinecharts-pro-period-bar {
              width: 100% !important;
              box-sizing: border-box;
              background-color: #181D1F !important;
              border-bottom: 1px solid rgba(77,255,180,0.08) !important;
              height: 40px !important;
            }
            #super-crypto-chart .klinecharts-pro-content { width: 100% !important; background-color: #14181A !important; }
            #super-crypto-chart .klinecharts-pro-widget { width: 100% !important; margin-left: 0 !important; }
            #super-crypto-chart .klinecharts-pro-period-bar .item.tools:nth-last-child(3) { margin-left: auto !important; }
            #super-crypto-chart .klinecharts-pro-period-bar .item.tools {
              padding: 0 10px !important;
              cursor: pointer;
              transition: background-color 0.15s ease;
              border-radius: 4px;
              margin: 4px 2px !important;
              fill: rgba(255,255,255,0.7) !important;
              color: rgba(255,255,255,0.7) !important;
            }
            #super-crypto-chart .klinecharts-pro-period-bar .item.tools:hover {
              background-color: rgba(77,255,180,0.08) !important;
              fill: #4dffb4 !important;
              color: #4dffb4 !important;
            }
            #super-crypto-chart .klinecharts-pro-period-bar .menu-container {
              fill: rgba(255,255,255,0.7) !important;
              padding: 0 12px !important;
              cursor: pointer;
            }
            #super-crypto-chart .klinecharts-pro-period-bar .menu-container:hover { fill: #4dffb4 !important; }
            #super-crypto-chart .symbol-select:focus { border-color: #4dffb4 !important; }
            #super-crypto-chart .symbol-select:hover { border-color: rgba(77,255,180,0.4) !important; background-color: #1F2426 !important; }

            /* ── Modal & Settings UI ── */
            #super-crypto-chart .klinecharts-pro-modal {
              background-color: rgba(0,0,0,0.55) !important;
              backdrop-filter: blur(4px) !important;
              -webkit-backdrop-filter: blur(4px) !important;
            }
            #super-crypto-chart .klinecharts-pro-modal .inner {
              background-color: #14181A !important;
              border: 1px solid rgba(77,255,180,0.18) !important;
              border-radius: 10px !important;
              box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(77,255,180,0.04) !important;
              padding: 24px 36px !important;
              min-width: 760px !important;
              color: #ffffff !important;
            }
            #super-crypto-chart .klinecharts-pro-modal > .inner > .title,
            #super-crypto-chart .klinecharts-pro-modal .inner > .title {
              background-color: #14181A !important;
              color: #ffffff !important;
              font-size: 14px !important;
              font-weight: 700 !important;
              letter-spacing: 0.6px !important;
              text-transform: uppercase !important;
              padding: 0 0 14px 0 !important;
              border-bottom: 1px solid rgba(77,255,180,0.10) !important;
              font-family: var(--font-ibm-mono), monospace !important;
            }
            #super-crypto-chart .klinecharts-pro-indicator-modal-list .title {
              background-color: #14181A !important;
              color: rgba(255,255,255,0.75) !important;
              font-size: 12px !important;
              font-weight: 700 !important;
              letter-spacing: 0.8px !important;
              text-transform: uppercase !important;
              padding: 10px 20px !important;
              border-bottom: 1px solid rgba(77,255,180,0.08) !important;
              z-index: 2 !important;
            }
            #super-crypto-chart .klinecharts-pro-setting-modal-content {
              grid-row-gap: 14px !important;
              grid-column-gap: 18px !important;
              margin-top: 18px !important;
              margin-bottom: 22px !important;
              font-size: 13px !important;
              color: rgba(255,255,255,0.85) !important;
            }
            #super-crypto-chart .klinecharts-pro-setting-modal-content > * {
              color: rgba(255,255,255,0.85) !important;
            }
            #super-crypto-chart .klinecharts-pro-input {
              background-color: #181D1F !important;
              border: 1px solid rgba(77,255,180,0.12) !important;
              border-radius: 6px !important;
              color: #ffffff !important;
              height: 32px !important;
              font-size: 12px !important;
              transition: border-color 0.15s ease, background-color 0.15s ease !important;
            }
            #super-crypto-chart .klinecharts-pro-input:hover {
              border-color: rgba(77,255,180,0.30) !important;
              background-color: #1F2426 !important;
            }
            #super-crypto-chart .klinecharts-pro-input:focus-within {
              border-color: #4dffb4 !important;
            }
            #super-crypto-chart .klinecharts-pro-select {
              color: #ffffff !important;
              height: 32px !important;
              width: 140px !important;
            }
            #super-crypto-chart .klinecharts-pro-select .selector-container {
              background-color: #181D1F !important;
              border: 1px solid rgba(77,255,180,0.12) !important;
              border-radius: 6px !important;
              padding: 0 12px !important;
              transition: border-color 0.15s ease, background-color 0.15s ease !important;
            }
            #super-crypto-chart .klinecharts-pro-select .selector-container:hover {
              border-color: rgba(77,255,180,0.30) !important;
              background-color: #1F2426 !important;
            }
            #super-crypto-chart .klinecharts-pro-select .selector-container .arrow {
              border-top-color: #4dffb4 !important;
            }
            #super-crypto-chart .klinecharts-pro-select.klinecharts-pro-select-show .selector-container,
            #super-crypto-chart .klinecharts-pro-select-show .selector-container {
              border-color: #4dffb4 !important;
            }
            #super-crypto-chart .klinecharts-pro-select .drop-down-container {
              background-color: #181D1F !important;
              border: 1px solid rgba(77,255,180,0.18) !important;
              border-radius: 6px !important;
              box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important;
              margin-top: 4px !important;
              max-height: 180px !important;
            }
            #super-crypto-chart .klinecharts-pro-select .drop-down-container ul li {
              height: 34px !important;
              color: rgba(255,255,255,0.85) !important;
              font-size: 12px !important;
              transition: background-color 0.12s ease, color 0.12s ease !important;
            }
            #super-crypto-chart .klinecharts-pro-select .drop-down-container ul li:hover {
              background-color: rgba(77,255,180,0.10) !important;
              color: #4dffb4 !important;
            }
            #super-crypto-chart .klinecharts-pro-switch {
              background-color: rgba(255,255,255,0.12) !important;
              transition: background-color 0.2s ease !important;
            }
            #super-crypto-chart .klinecharts-pro-switch.open,
            #super-crypto-chart .klinecharts-pro-switch[data-checked="true"] {
              background-color: #4dffb4 !important;
            }
            #super-crypto-chart .klinecharts-pro-checkbox {
              color: rgba(255,255,255,0.85) !important;
              fill: rgba(255,255,255,0.85) !important;
            }
            #super-crypto-chart .klinecharts-pro-checkbox.checked {
              color: #4dffb4 !important;
              fill: #4dffb4 !important;
            }
            #super-crypto-chart .klinecharts-pro-button {
              border-radius: 6px !important;
              height: 34px !important;
              width: auto !important;
              padding: 0 18px !important;
              font-size: 12px !important;
              font-weight: 600 !important;
              letter-spacing: 0.5px !important;
              text-transform: uppercase !important;
              font-family: var(--font-ibm-mono), monospace !important;
              transition: all 0.15s ease !important;
              border: 1px solid rgba(77,255,180,0.30) !important;
            }
            #super-crypto-chart .klinecharts-pro-button.confirm {
              background-color: #4dffb4 !important;
              color: #0B0F0D !important;
              border-color: #4dffb4 !important;
            }
            #super-crypto-chart .klinecharts-pro-button.confirm:hover {
              background-color: #17e29a !important;
              border-color: #17e29a !important;
              box-shadow: 0 0 16px rgba(77,255,180,0.35) !important;
            }
            #super-crypto-chart .klinecharts-pro-button.cancel {
              background-color: transparent !important;
              color: rgba(255,255,255,0.7) !important;
              border-color: rgba(255,255,255,0.18) !important;
            }
            #super-crypto-chart .klinecharts-pro-button.cancel:hover {
              color: #ffffff !important;
              border-color: rgba(255,255,255,0.35) !important;
              background-color: rgba(255,255,255,0.04) !important;
            }
            #super-crypto-chart .klinecharts-pro-list {
              color: rgba(255,255,255,0.85) !important;
              scrollbar-color: rgba(77,255,180,0.20) transparent !important;
            }
            #super-crypto-chart .klinecharts-pro-list::-webkit-scrollbar-thumb {
              background-color: rgba(77,255,180,0.20) !important;
            }
            #super-crypto-chart .klinecharts-pro-list li {
              padding: 8px 12px !important;
              border-radius: 4px !important;
              transition: background-color 0.12s ease !important;
            }
            #super-crypto-chart .klinecharts-pro-list li:hover {
              background-color: rgba(77,255,180,0.08) !important;
              color: #4dffb4 !important;
            }
          `,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 28,
          width: "100%",
          padding: "10px 20px 10px 28px",
          boxSizing: "border-box",
          borderBottom: "1px solid rgba(77,255,180,0.08)",
          backgroundColor: "#181D1F",
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            marginRight: 8,
          }}
        >
          <select
            className="symbol-select"
            value={selectedSymbol}
            onChange={(e) => {
              setCurrentPrice(null);
              setOpenPrice24h(null);
              setSelectedSymbol(e.target.value);
            }}
            style={{
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 700,
              fontFamily: "var(--font-ibm-mono)",
              backgroundColor: "#14181A",
              border: "1px solid rgba(77,255,180,0.18)",
              borderRadius: 6,
              padding: "6px 28px 6px 18px",
              cursor: "pointer",
              outline: "none",
              appearance: "none",
              transition:
                "border-color 0.15s ease, background-color 0.15s ease",
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path fill='%234dffb4' d='M2 4l3 3 3-3z'/></svg>\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 10px center",
              letterSpacing: 0.1,
            }}
            aria-label="Select symbol"
          >
            {AVAILABLE_SYMBOLS.map((s) => (
              <option
                key={s}
                value={s}
                style={{ backgroundColor: "#14181A", color: "#ffffff" }}
              >
                {s === "KXI" ? "KXI-PERP" : `${s}-PERP`}
              </option>
            ))}
          </select>
        </div>
        <div
          style={{
            width: 1,
            height: 28,
            backgroundColor: "rgba(77,255,180,0.10)",
            flexShrink: 0,
          }}
        />
        <Stat label="Mark" value={fmtPrice(currentPrice)} />
        <Stat label="Oracle" value={fmtPrice(currentPrice)} />
        <Stat
          label="24h Change"
          value={
            change24h == null
              ? "—"
              : `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`
          }
          color={changeColor}
        />
        <Stat label="24h Volume" value="—" />
        <Stat label="Open Interest" value="—" />
        <Stat label="Funding" value="—" color="#4dffb4" />
      </div>
      <div
        id="super-crypto-chart"
        ref={containerRef}
        style={{
          width: "100%",
          flex: 1,
          minHeight: 0,
          backgroundColor: "#14181A",
        }}
      />
    </div>
  );
}
