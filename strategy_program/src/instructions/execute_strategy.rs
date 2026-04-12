use std::i64;

use bytemuck::{Pod, Zeroable};
use pinocchio::{
    AccountView, ProgramResult,
    error::ProgramError,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    cpi::{place_order_cpi, place_trigger_order_cpi},
    errors::StrategyProgramError,
    helpers::{verify_account_owner, verify_signer, verify_writtable},
    states::StrategyAccount,
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct ExecuteStrategyParams {
    pub signal: u8, // 0=Buy, 1=Sell
    // bumps for CPIs
    pub bump_oo_account: u8,
    pub bump_position: u8,
    pub bump_user: u8,
    pub bump_trigger_tp: u8, // for take profit trigger PDA
    pub bump_trigger_sl: u8, // for stop loss trigger PDA
    pub padding: [u8; 2],
}

pub fn process_execute_strategy(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        keeper, // permissionless
        strategy_owner,
        strategy_account,
        // orderbook CPI accounts
        orderbook_program,
        open_orders_account,
        market,
        bids,
        asks,
        risk_program,
        user_account,
        position,
        market_config,
        funding_state,
        system_program,
        // trigger program CPI accounts (optional — only if SL/TP set)
        trigger_program,
        trigger_order,
        // these are signers
        trigger_tp_account, // for take profit
        trigger_sl_account, // for stop loss
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(keeper)?;
    unsafe {
        verify_account_owner(strategy_account, &crate::ID)?;
    }
    verify_writtable(strategy_account)?;

    let params = bytemuck::try_from_bytes::<ExecuteStrategyParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let clock = Clock::get()?;
    let now_ts = clock.unix_timestamp;

    let mut strat_data = strategy_account.try_borrow_mut()?;
    let strategy =
        bytemuck::from_bytes_mut::<StrategyAccount>(&mut strat_data[..StrategyAccount::LEN]);

    if strategy.status != 0 {
        return Err(StrategyProgramError::StrategyNotActive.into());
    }

    if strategy.last_executed_ts > 0 {
        let elapsed = now_ts
            .checked_sub(strategy.last_executed_ts)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        if elapsed < strategy.cooldown_secs as i64 {
            return Err(StrategyProgramError::CooldownNotElapsed.into());
        }
    }

    if strategy.max_executions_per_day > 0 {
        // Reset counter if new day
        let day_elapsed = now_ts
            .checked_sub(strategy.day_start_ts)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        if day_elapsed >= 86_400 {
            strategy.executions_today = 0;
            strategy.day_start_ts = now_ts;
        }
        if strategy.executions_today >= strategy.max_executions_per_day {
            return Err(StrategyProgramError::DailyCapReached.into());
        }
    }
    if params.signal > 1 {
        return Err(StrategyProgramError::InvalidSignal.into());
    }

    place_order_cpi(
        strategy_owner,
        open_orders_account,
        market,
        bids,
        asks,
        orderbook_program,
        risk_program,
        user_account,
        position,
        market_config,
        funding_state,
        system_program,
        strategy.stop_loss_price,
        i64::MAX,
        strategy.client_order_id,
        0,
        strategy.limit_price_lots,
        params.signal,
        if strategy.limit_price_lots > 0 {
            0u8
        } else {
            3u8
        },
        8u8,
        params.bump_position,
        params.bump_user,
    )?;

    if strategy.take_profit_price > 0 {
        let tp_side = 1 - params.signal; // opposite side to close position
        let tp_trigger_type = 1u8; // TakeProfit

        place_trigger_order_cpi(
            strategy_owner,
            trigger_program,
            trigger_order,
            system_program,
            strategy.client_order_id,
            strategy.take_profit_price,
            strategy.size_lots,
            0,
            strategy.market_index,
            tp_trigger_type,
            tp_side,
            params.bump_trigger_tp,
        )?;
    }

    if strategy.stop_loss_price > 0 {
        let sl_side = 1 - params.signal; // opposite side to close position
        let sl_trigger_type = 0u8; // StopLoss

        place_trigger_order_cpi(
            strategy_owner,
            trigger_program,
            trigger_order,
            system_program,
            strategy.client_order_id,
            strategy.stop_loss_price,
            strategy.size_lots,
            0,
            strategy.market_index,
            sl_trigger_type,
            sl_side,
            params.bump_trigger_sl,
        )?;
    }

    strategy.last_executed_ts = now_ts;
    strategy.executions_today = strategy.executions_today.saturating_add(1);

    Ok(())
}
