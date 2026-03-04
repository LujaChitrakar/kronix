"use client"
import React, { useEffect } from "react";
import "./chart.css";

declare global {
  interface Window {
    TradingView: any;
  }
}

const ChartContainer: React.FC = () => {
  useEffect(() => {
    // Chart widget
    const chartScript = document.createElement("script");
    chartScript.src = "https://s3.tradingview.com/tv.js";
    chartScript.async = true;
    chartScript.onload = () => {
      if (window.TradingView) {
        new window.TradingView.widget({
          autosize: true,
          symbol: "BINANCE:SOLUSDC",
          interval: "D",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#f1f3f6",
          enable_publishing: false,
          withdateranges: true,
          hide_side_toolbar: false,
          allow_symbol_change: true,
          details: false,
          hotlist: false,
          watchlist: false,
          calendar: true,
          studies: ["STD;EMA"],
          popup_width: "1000",
          popup_height: "1650",
          container_id: "tradingview_33f92",
        });
      }
    };
    document.body.appendChild(chartScript);
  }, []);

  return (
    <div className="tradingview-widget-container pt-5">
      <div id="tradingview_33f92" />
      <div className="tradingview-widget-copyright" />
    </div>
  );
};

export default ChartContainer;