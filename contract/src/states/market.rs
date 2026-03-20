use bytemuck::{Pod, Zeroable};
use pinocchio::{AccountView, Address, error::ProgramError, sysvars::clock::Clock};
use pyth_solana_receiver_sdk::PYTH_PUSH_ORACLE_ID;

use crate::{
    constants::{MAX_CONF_RATIO_BPS, MAX_ORACLE_AGE_SECS},
    errors::OrderBookError,
    states::{Side, orderbook},
    utils::impl_load,
};

const OFFSET_FEED_ID: usize = 42;
const OFFSET_PRICE: usize = 74;
const OFFSET_CONF: usize = 82;
const OFFSET_EXPONENT: usize = 90;
const OFFSET_PUBLISH_TIME: usize = 94;
const MIN_DATA_LEN: usize = 102;

#[derive(Pod, Zeroable, Copy, Clone)]
#[repr(C)]
pub struct Market {
    // Identity
    pub market_index: u16,
    pub bump: u8,
    pub base_decimals: u8,
    pub quote_decimals: u8,
    pub paused: u8,
    pub padding: [u8; 2],
    pub name: [u8; 16],

    // Lot sizes
    pub base_lot_size: i64,
    pub quote_lot_size: i64,

    // Order ID generation
    pub seq_num: u64,

    // Market lifecycle
    pub registration_ts: i64,
    pub time_expiry: i64,

    // Account refs
    // address of the bookside account for bids
    pub bids: [u8; 32],
    // address of the bookside account for asks
    pub asks: [u8; 32],
    // address of the event queue account
    pub event_queue: [u8; 32],
    // address of the oracle account
    pub oracle: [u8; 32],
    pub feed_id: [u8; 32],
    pub reserved: [u8; 64],
}

const _: () = assert!(
    size_of::<Market>()
        == 2 + 1 + 1 + 1 + 1 + 2 + 16 + 8 + 8 + 8 + 8 + 8 + 32 + 32 + 32 + 32 + 32 + 64
);
const _: () = assert!(size_of::<Market>() % 8 == 0);

impl Market {
    pub fn name(&self) -> &str {
        std::str::from_utf8(&self.name)
            .unwrap()
            .trim_matches(char::from(0))
    }

    pub fn is_expired(&self, time_stamp: i64) -> bool {
        self.time_expiry != 0 && self.time_expiry < time_stamp
    }

    pub fn generate_order_id(&mut self, side: Side, price_data: u64) -> u128 {
        self.seq_num += 1;
        orderbook::new_node_key(side, price_data, self.seq_num)
    }

    pub fn max_base_lots(&self) -> i64 {
        i64::MAX / self.base_lot_size
    }

    pub fn max_quote_lots(&self) -> i64 {
        i64::MAX / self.quote_lot_size
    }

    // for oracle-pegged order matching
    pub fn native_price_to_lot(&self, price: i64) -> Result<i64, ProgramError> {
        // convert to lot price for critbit key comparison
        let price_in_quote_units = price
            .checked_mul(self.base_lot_size)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        let lot_price = price_in_quote_units
            .checked_div(self.quote_lot_size)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        Ok(lot_price)
    }

    //inverse conversion, useful for UI/logging
    pub fn lot_to_native_price(&self, price_lots: i64) -> Option<i64> {
        price_lots
            .checked_mul(self.quote_lot_size)
            .map(|x| x / self.base_lot_size)
    }

    pub fn apply_exponent(&self, price: i64, exponent: i32) -> Result<i64, ProgramError> {
        if exponent >= 0 {
            let mult = 10i64
                .checked_pow(exponent as u32)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            price
                .checked_mul(mult)
                .ok_or(ProgramError::ArithmeticOverflow)
        } else {
            let div = 10i64
                .checked_pow((-exponent) as u32)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            Ok(price / div)
        }
    }

    pub fn validate_and_read_oracle(
        &self,
        oracle_account: &AccountView,
        now_ts: i64,
    ) -> Result<i64, ProgramError> {
        if oracle_account.address().as_array() != &self.oracle {
            return Err(OrderBookError::InvalidOracle.into());
        }
        let pyth_price = load_pyth_price(oracle_account, &self.feed_id, now_ts)?;
        let native = self.apply_exponent(pyth_price.price, pyth_price.exponent)?;
        self.native_price_to_lot(native)
    }
}

pub struct PythPrice {
    pub price: i64,        // raw price
    pub conf: u64,         // confidence interval (uncertainty)
    pub exponent: i32,     // price * 10^exponent = actual price
    pub publish_time: i64, // unix timestamp
}

impl_load!(Market);

pub fn load_pyth_price(
    oracle_account: &AccountView,
    expected_feed_id: &[u8; 32],
    now_ts: i64,
) -> Result<PythPrice, ProgramError> {
    // unsafe{
    // if oracle_account.owner() != &PYTH_PUSH_ORACLE_ID  {
    //     return Err(OrderbookError::InvalidOracleOwner.into());
    // }
    // }

    let data = oracle_account.try_borrow()?;
    if data.len() < MIN_DATA_LEN {
        return Err(ProgramError::InvalidAccountData);
    }

    let feed_id: &[u8; 32] = data[OFFSET_FEED_ID..OFFSET_FEED_ID + 32]
        .try_into()
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if feed_id != expected_feed_id {
        return Err(OrderBookError::OracleFeedMismatch.into());
    }

    let price = i64::from_le_bytes(
        data[OFFSET_PRICE..OFFSET_PRICE + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );

    let conf = u64::from_le_bytes(
        data[OFFSET_CONF..OFFSET_CONF + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let exponent = i32::from_le_bytes(
        data[OFFSET_EXPONENT..OFFSET_EXPONENT + 4]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let publish_time = i64::from_le_bytes(
        data[OFFSET_PUBLISH_TIME..OFFSET_PUBLISH_TIME + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );

    drop(data);

    if price <= 0 {
        return Err(OrderBookError::InvalidOraclePrice.into());
    }

    if now_ts.saturating_sub(publish_time) > MAX_ORACLE_AGE_SECS {
        return Err(OrderBookError::OracleStale.into());
    }
    let conf_bps = conf
        .checked_mul(10_000)
        .unwrap_or(u64::MAX)
        .checked_div(price.unsigned_abs())
        .unwrap_or(u64::MAX);
    if conf_bps > MAX_CONF_RATIO_BPS {
        return Err(OrderBookError::OracleConfidenceTooLow.into());
    }

    Ok(PythPrice {
        price,
        conf,
        exponent,
        publish_time,
    })
}
