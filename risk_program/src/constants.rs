pub const USER_ACCOUNT_SEED: &[u8] = b"user";
pub const POSITION_SEED: &[u8] = b"position";
pub const MARKET_CONFIG_SEED: &[u8] = b"market_config";
pub const FUNDING_SEED: &[u8] = b"funding";
pub const INSURANCE_SEED: &[u8] = b"insurance";
pub const VAULT_SEED: &[u8] = b"vault";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";

pub const MAX_PRICE_AGE_SLOTS: u64 = 25;
pub const MAX_CONF_RATIO_BPS: u64 = 100;

pub const FUNDING_INTERVAL_SECS: i64 = 3_600;
pub const FUNDING_PERIOD_SECS: i64 = 28_800;

pub const PRICE_ACC_LEN: usize = 134;

// Byte offsets into a PriceUpdateV2 account (Anchor discriminator included)
pub const PRICE_ACC_OFFSET_FEED_ID: usize = 41;
pub const PRICE_ACC_OFFSET_PRICE: usize = 73;
pub const PRICE_ACC_OFFSET_CONF: usize = 81;
pub const PRICE_ACC_OFFSET_EXPONENT: usize = 89;
pub const PRICE_ACC_OFFSET_PUBLISH_TIME: usize = 93;

pub const FEED_ID: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];
