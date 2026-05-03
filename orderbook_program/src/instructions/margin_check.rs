use bytemuck::{Pod, Zeroable};
use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_log::log;

use crate::{
    constants::{MARKET_CONFIG_SEED, POSITION_SEED, USER_ACCOUNT_SEED},
    errors::OrderBookError,
    helper::{verify_account_owner, verify_initialized, verify_pda},
};

#[derive(Pod, Zeroable, Copy, Clone)]
#[repr(C)]
struct RiskUserAccount {
    collateral: i64,
    margin_used: i64,
    bump: u8,
    position_count: u8,
    padding: [u8; 6],
    owner: [u8; 32],
    reserved: [u8; 32],
}

#[derive(Pod, Zeroable, Copy, Clone)]
#[repr(C)]
struct RiskMarketConfig {
    base_lot_size: i64,
    quote_lot_size: i64,
    market_index: u16,
    initial_margin_bps: u16,
    maintenance_margin_bps: u16,
    liquidation_fee_bps: u16,
    bump: u8,
    max_leverage: u8,
    padding: [u8; 6],
    oracle: [u8; 32],
    reserved: [u8; 32],
}

#[derive(Pod, Zeroable, Copy, Clone)]
#[repr(C)]
struct RiskPosition {
    size: i64,
    entry_price: i64,
    entry_funding_index: i64,
    initial_margin: i64,
    market_index: u16,
    bump: u8,
    side: u8,
    padding: [u8; 4],
    owner: [u8; 32],
    reserved: [u8; 32],
}

const _: () = assert!(core::mem::size_of::<RiskUserAccount>() == 88);
const _: () = assert!(core::mem::size_of::<RiskMarketConfig>() == 96);
const _: () = assert!(core::mem::size_of::<RiskPosition>() == 104);

pub fn validate_order_margin(
    user_account: &AccountView,
    position: &AccountView,
    market_config: &AccountView,
    owner: &[u8; 32],
    market_index: u16,
    max_base_lots: i64,
    price_lots: i64,
    side: u8,
    bump_position: u8,
) -> ProgramResult {
    if user_account.is_data_empty() {
        return Err(OrderBookError::InsufficientCollateral.into());
    }
    verify_initialized(market_config)?;
    unsafe {
        verify_account_owner(user_account, &crate::RISK_PROGRAM_ID)?;
        verify_account_owner(market_config, &crate::RISK_PROGRAM_ID)?;
    }

    let user_data = user_account.try_borrow()?;
    let user = bytemuck::from_bytes::<RiskUserAccount>(
        &user_data[..core::mem::size_of::<RiskUserAccount>()],
    );
    if user.owner != *owner {
        return Err(OrderBookError::InvalidOwner.into());
    }
    verify_pda(
        user_account,
        &[USER_ACCOUNT_SEED, owner.as_ref(), &[user.bump]],
        &crate::RISK_PROGRAM_ID,
    )?;
    let market_index_bytes = market_index.to_le_bytes();
    verify_pda(
        position,
        &[
            POSITION_SEED,
            owner.as_ref(),
            market_index_bytes.as_ref(),
            &[bump_position],
        ],
        &crate::RISK_PROGRAM_ID,
    )?;

    let market_data = market_config.try_borrow()?;
    let config = bytemuck::from_bytes::<RiskMarketConfig>(
        &market_data[..core::mem::size_of::<RiskMarketConfig>()],
    );
    if config.market_index != market_index {
        return Err(OrderBookError::InvalidMarket.into());
    }
    verify_pda(
        market_config,
        &[
            MARKET_CONFIG_SEED,
            market_index.to_le_bytes().as_ref(),
            &[config.bump],
        ],
        &crate::RISK_PROGRAM_ID,
    )?;

    if price_lots <= 0 {
        return Err(OrderBookError::InvalidPriceLots.into());
    }
    let order_size = max_base_lots.abs();
    let mut resulting_size = order_size;
    let mut existing_margin = 0_i64;
    if !position.is_data_empty() {
        unsafe {
            verify_account_owner(position, &crate::RISK_PROGRAM_ID)?;
        }
        let position_data = position.try_borrow()?;
        let position_state = bytemuck::from_bytes::<RiskPosition>(
            &position_data[..core::mem::size_of::<RiskPosition>()],
        );
        if position_state.owner != *owner {
            return Err(OrderBookError::InvalidOwner.into());
        }
        if position_state.market_index != market_index {
            return Err(OrderBookError::InvalidMarket.into());
        }
        existing_margin = position_state.initial_margin;
        if position_state.size > 0 {
            resulting_size = if position_state.side == side {
                position_state
                    .size
                    .checked_add(order_size)
                    .ok_or(ProgramError::ArithmeticOverflow)?
            } else if order_size >= position_state.size {
                order_size
                    .checked_sub(position_state.size)
                    .ok_or(ProgramError::ArithmeticOverflow)?
            } else {
                position_state
                    .size
                    .checked_sub(order_size)
                    .ok_or(ProgramError::ArithmeticOverflow)?
            };
        }
    }

    if resulting_size == 0 {
        return Ok(());
    }

    let notional = (resulting_size as i128)
        .checked_mul(price_lots as i128)
        .and_then(|v| v.checked_mul(config.quote_lot_size as i128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if notional <= 0 {
        return Err(OrderBookError::InvalidInputLots.into());
    }

    // ---------------------------------------------------------------
    // Gate 1 — Leverage check
    // The resulting position notional must not exceed the trader's
    // total collateral multiplied by the market's max_leverage.
    // max_leverage == 0 means "uncapped"; skip the gate entirely.
    // The old code capped max_leverage at 10x, which was incorrect for
    // markets configured with higher leverage (e.g. 20x).
    // ---------------------------------------------------------------
    if config.max_leverage > 0 {
        let max_notional = (user.collateral as i128)
            .checked_mul(config.max_leverage as i128)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        log!(
            "leverage check: notional {} max_notional {}",
            notional,
            max_notional
        );
        if notional > max_notional {
            return Err(OrderBookError::ExceedsMaxLeverage.into());
        }
    }

    // ---------------------------------------------------------------
    // Gate 2 — Collateral / initial-margin check
    // effective_margin_bps = max(initial_margin_bps, 10_000/max_leverage)
    // When max_leverage == 0 we use only initial_margin_bps.
    // ---------------------------------------------------------------
    let effective_margin_bps: u16 = if config.max_leverage > 0 {
        let leverage_margin_bps = 10_000_u16.div_ceil(config.max_leverage as u16);
        config.initial_margin_bps.max(leverage_margin_bps)
    } else {
        config.initial_margin_bps
    };

    let required_margin = notional
        .checked_mul(effective_margin_bps as i128)
        .and_then(|v| v.checked_div(10_000))
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Free collateral available specifically for this position:
    // release the margin already locked by the existing position,
    // then subtract margin committed to all other positions.
    let other_margin = user.margin_used.saturating_sub(existing_margin);
    let available_for_position = user.collateral.saturating_sub(other_margin);

    log!("margin price: {}", price_lots);
    log!("margin size: {}", resulting_size);
    log!("margin notional: {}", notional);
    log!(
        "margin required: {} available: {}",
        required_margin,
        available_for_position
    );

    if required_margin > available_for_position as i128 {
        return Err(OrderBookError::InsufficientCollateral.into());
    }

    Ok(())
}
