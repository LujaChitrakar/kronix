use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;
use std::i64;

use crate::{
    constants::STRATEGY_AUTHORITY_SEED,
    cpi::{place_order_cpi, place_trigger_order_cpi},
    errors::StrategyProgramError,
    helpers::{verify_account_owner, verify_pda, verify_signer, verify_writtable},
    states::StrategyAccount,
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct ExecuteStrategyParams {
    pub signal: u8, // 0=Buy, 1=Sell
    // bumps for CPIs
    pub bump_oo_account: u8,
    pub bump_fills_log: u8,
    pub bump_trigger_tp: u8, // for take profit trigger PDA
    pub bump_trigger_sl: u8, // for stop loss trigger PDA
    pub bump_authority: u8,
    pub padding: [u8; 1],
}

pub fn process_execute_strategy(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        keeper, // permissionless
        strategy_authority,
        strategy_owner,
        strategy_account,
        // orderbook CPI accounts
        open_orders_account,
        market,
        bids,
        asks,
        fills_log,
        orderbook_program,
        system_program,
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

    let params = bytemuck::try_pod_read_unaligned::<ExecuteStrategyParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let clock = Clock::get()?;
    let now_ts = clock.unix_timestamp;

    let bump_bytes = [params.bump_authority];
    verify_pda(
        strategy_authority,
        &[STRATEGY_AUTHORITY_SEED, &bump_bytes],
        &crate::ID,
    )?;

    let mut strat_data = strategy_account.try_borrow_mut()?;
    let strategy =
        bytemuck::from_bytes_mut::<StrategyAccount>(&mut strat_data[..StrategyAccount::LEN]);

    if strategy.owner != *strategy_owner.address().as_array() {
        return Err(ProgramError::IllegalOwner);
    }
    if strategy.status != 0 {
        return Err(StrategyProgramError::StrategyNotActive.into());
    }

    if strategy.last_executed_ts > 0 {
        let elapsed = now_ts
            .checked_sub(strategy.last_executed_ts)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        if (elapsed as u64) < strategy.cooldown_secs {
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
    let order_type: u8 = if strategy.limit_price_lots > 0 {
        0u8
    } else {
        3u8
    };

    let owner_key = strategy.owner;

    place_order_cpi(
        orderbook_program,
        system_program,
        strategy_authority,
        open_orders_account,
        market,
        bids,
        asks,
        fills_log,
        strategy.size_lots,
        i64::MAX,
        strategy.client_order_id,
        0,
        strategy.limit_price_lots,
        params.signal,
        order_type,
        8u8,
        params.bump_fills_log,
        params.bump_authority,
        owner_key,
    )?;

    let has_tp = strategy.take_profit_price > 0;
    let has_sl = strategy.stop_loss_price > 0;

    let (trigger_program, tp_account, sl_account): (
        Option<&AccountView>,
        Option<&AccountView>,
        Option<&AccountView>,
    ) = match (has_tp, has_sl) {
        (false, false) => (None, None, None),

        (true, false) => {
            let [trigger_program, tp_account, ..] = _remaining else {
                return Err(ProgramError::NotEnoughAccountKeys);
            };
            (Some(trigger_program), Some(tp_account), None)
        }

        (false, true) => {
            let [trigger_program, sl_account, ..] = _remaining else {
                return Err(ProgramError::NotEnoughAccountKeys);
            };
            (Some(trigger_program), None, Some(sl_account))
        }

        (true, true) => {
            let [trigger_program, tp_account, sl_account, ..] = _remaining else {
                return Err(ProgramError::NotEnoughAccountKeys);
            };
            (Some(trigger_program), Some(tp_account), Some(sl_account))
        }
    };

    if has_tp {
        let trigger_program = trigger_program.unwrap();
        let trigger_tp_account = tp_account.unwrap();
        let tp_side = 1 - params.signal; // opposite side to close position
        let tp_trigger_type = 1u8; // TakeProfit

        place_trigger_order_cpi(
            strategy_authority,
            trigger_program,
            system_program,
            trigger_tp_account,
            open_orders_account,
            strategy.client_order_id,
            strategy.take_profit_price,
            strategy.size_lots,
            0,
            strategy.market_index,
            tp_trigger_type,
            tp_side,
            params.bump_trigger_tp,
            params.bump_authority,
            owner_key,
        )?;
    }

    if has_sl {
        let trigger_program = trigger_program.unwrap();
        let trigger_sl_account = sl_account.unwrap();
        let sl_side = 1 - params.signal; // opposite side to close position
        let sl_trigger_type = 0u8; // StopLoss

        place_trigger_order_cpi(
            strategy_authority,
            trigger_program,
            system_program,
            trigger_sl_account,
            open_orders_account,
            strategy.client_order_id + 1,
            strategy.stop_loss_price,
            strategy.size_lots,
            0,
            strategy.market_index,
            sl_trigger_type,
            sl_side,
            params.bump_trigger_sl,
            params.bump_authority,
            owner_key,
        )?;
    }

    strategy.last_executed_ts = now_ts;
    strategy.executions_today = strategy.executions_today.saturating_add(1);
    strategy.client_order_id = strategy.client_order_id.wrapping_add(3);

    Ok(())
}
