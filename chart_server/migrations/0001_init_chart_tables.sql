CREATE TABLE IF NOT EXISTS index_candles (
    id           BIGSERIAL PRIMARY KEY,
    resolution   VARCHAR(8)       NOT NULL,          -- '1m', '5m', '1h', '1d', etc.
    timestamp    TIMESTAMPTZ      NOT NULL,
    open         NUMERIC(24, 8)   NOT NULL,
    high         NUMERIC(24, 8)   NOT NULL,
    low          NUMERIC(24, 8)   NOT NULL,
    close        NUMERIC(24, 8)   NOT NULL,
    UNIQUE (resolution, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_index_candles_resolution_ts
    ON index_candles (resolution, timestamp ASC);

-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_price_history (
    id           BIGSERIAL PRIMARY KEY,
    asset        VARCHAR(16)      NOT NULL,           -- 'BTC', 'ETH', 'SOL', etc.
    resolution   VARCHAR(8)       NOT NULL,
    timestamp    TIMESTAMPTZ      NOT NULL,
    open_usd     NUMERIC(24, 8)   NOT NULL,
    high_usd     NUMERIC(24, 8)   NOT NULL,
    low_usd      NUMERIC(24, 8)   NOT NULL,
    close_usd    NUMERIC(24, 8)   NOT NULL,
    UNIQUE (asset, resolution, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_asset_price_history_asset_resolution_ts
    ON asset_price_history (asset, resolution, timestamp ASC);
