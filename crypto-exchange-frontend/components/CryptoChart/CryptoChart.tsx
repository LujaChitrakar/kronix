'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import './chart.css';

type AssetSymbol = 'BTC' | 'ETH' | 'SOL';

const ASSETS: Record<AssetSymbol, { symbol: string; name: string; icon: string; accent: string; glow: string }> = {
  BTC: { symbol: 'BINANCE:BTCUSDT', name: 'Bitcoin',  icon: '₿', accent: '#F7931A', glow: 'rgba(247,147,26,0.3)' },
  ETH: { symbol: 'BINANCE:ETHUSDT', name: 'Ethereum', icon: 'Ξ', accent: '#627EEA', glow: 'rgba(98,126,234,0.3)' },
  SOL: { symbol: 'BINANCE:SOLUSDT', name: 'Solana',   icon: '◎', accent: '#9945FF', glow: 'rgba(153,69,255,0.3)' },
};

export default function CryptoChart() {
  const [selectedAsset, setSelectedAsset] = useState<AssetSymbol>('BTC');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const initializedRef = useRef(false);
  const currentAssetRef = useRef<AssetSymbol>('BTC');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setDropdownOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    initializedRef.current = true;

    const widgetDiv = document.createElement('div');
    widgetDiv.id = 'tv_chart_container';
    widgetDiv.style.width = '100%';
    widgetDiv.style.height = '100%';
    container.appendChild(widgetDiv);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: ASSETS['BTC'].symbol,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: '#080B0F',
      gridColor: 'rgba(255,255,255,0.02)',
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: true,
      withdateranges: true,
      hide_side_toolbar: false,
      container_id: 'tv_chart_container',
    });

    script.onload = () => {
      const poll = setInterval(() => {
        const iframe = container.querySelector('iframe') as HTMLIFrameElement | null;
        if (iframe) { iframeRef.current = iframe; clearInterval(poll); }
      }, 150);
    };

    widgetDiv.appendChild(script);
  }, []);

  const switchSymbol = useCallback((asset: AssetSymbol) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { name: 'set-symbol', data: { symbol: ASSETS[asset].symbol, interval: 'D' } },
      '*'
    );
  }, []);

  const selectAsset = (asset: AssetSymbol) => {
    setDropdownOpen(false);
    if (asset === currentAssetRef.current) return;
    currentAssetRef.current = asset;
    setSelectedAsset(asset);
    setSwitching(true);
    setTimeout(() => setSwitching(false), 400);
    switchSymbol(asset);
  };

  const asset = ASSETS[selectedAsset];

  const cssVars = {
    '--accent': asset.accent,
    '--glow': asset.glow,
  } as React.CSSProperties;

  return (
    <div className="cx-root" style={cssVars}>

      <header className="cx-header">
        <div className="cx-header-left">

          <div className="cx-brand">
            <div className="cx-brand-mark">📈</div>
            <span className="cx-brand-name">CRYPTEX</span>
          </div>

          <div className="cx-dd-wrap" ref={dropdownRef}>
            <button
              className={`cx-dd-btn${dropdownOpen ? ' is-open' : ''}`}
              onClick={() => setDropdownOpen((v) => !v)}
            >
              <span className="cx-dot cx-dot-live" style={{ background: asset.accent }} />
              <span className="cx-asset-icon">{asset.icon}</span>
              <span className="cx-ticker">{selectedAsset}</span>
              <span className="cx-full-name">{asset.name}</span>
              <svg className="cx-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {dropdownOpen && (
              <div className="cx-dd-panel">
                <div className="cx-dd-label">Select Market</div>
                <div className="cx-dd-sep" />
                {(Object.keys(ASSETS) as AssetSymbol[]).map((sym) => {
                  const a = ASSETS[sym];
                  const active = sym === selectedAsset;
                  return (
                    <button
                      key={sym}
                      className={`cx-dd-item${active ? ' cx-active' : ''}`}
                      style={{ '--item-color': a.accent } as React.CSSProperties}
                      onClick={() => selectAsset(sym)}
                    >
                      <span
                        className="cx-dd-item-dot"
                        style={{ background: a.accent }}
                      />
                      <span className="cx-dd-item-ticker">{sym}</span>
                      <span className="cx-dd-item-name">{a.name}</span>
                      {active && (
                        <svg
                          width="12" height="12" viewBox="0 0 12 12" fill="none"
                          style={{ marginLeft: 'auto', flexShrink: 0 }}
                        >
                          <path d="M2 6.5L5 9.5L10 3.5" stroke={a.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </header>

      <div className="cx-accent-bar">
        <div
          className="cx-accent-fill"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${asset.accent} 30%, ${asset.accent} 70%, transparent 100%)`,
            boxShadow: `0 0 16px ${asset.glow}`,
          }}
        />
      </div>

      <div
        ref={containerRef}
        className={`cx-body${switching ? ' cx-switching' : ''}`}
      />
    </div>
  );
}