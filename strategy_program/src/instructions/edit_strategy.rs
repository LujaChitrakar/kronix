use bytemuck::{Pod, Zeroable};
use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use shank::ShankType;

use crate::{
    errors::StrategyProgramError,
    helpers::{verify_account_owner, verify_signer, verify_writtable},
    states::StrategyAccount,
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct EditStrategyParams {
    // Pricing — 0 = no change
    pub new_limit_price_lots: i64,
    pub new_take_profit_price: i64,
    pub new_stop_loss_price: i64,
    pub new_size_lots: i64,

    // Risk params — 0 = no change
    pub new_cooldown_secs: u64,
    pub new_max_executions_per_day: u64,

    // Status control
    pub new_status: u8, // 255 = no change, 0 = active, 1 = paused
    pub new_leverage: u8, // 0 = no change

    pub padding: [u8; 6],
}

pub fn process_edit_strategy(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, strategy_account, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // ── Checks ────────────────────────────────────────────────────
    verify_signer(signer)?;
    unsafe {
        verify_account_owner(strategy_account, &crate::ID)?;
    }
    verify_writtable(strategy_account)?;

    let params = bytemuck::try_pod_read_unaligned::<EditStrategyParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let mut strat_data = strategy_account.try_borrow_mut()?;
    let strategy =
        bytemuck::from_bytes_mut::<StrategyAccount>(&mut strat_data[..StrategyAccount::LEN]);

    if strategy.owner != *signer.address().as_array() {
        return Err(StrategyProgramError::InvalidOwner.into());
    }

    if params.new_limit_price_lots < 0 {
        return Err(StrategyProgramError::InvalidPrice.into());
    }
    if params.new_take_profit_price < 0 {
        return Err(StrategyProgramError::InvalidPrice.into());
    }
    if params.new_stop_loss_price < 0 {
        return Err(StrategyProgramError::InvalidPrice.into());
    }
    if params.new_size_lots < 0 {
        return Err(StrategyProgramError::InvalidSize.into());
    }

    // Validate TP > SL if both being set
    let effective_tp = if params.new_take_profit_price > 0 {
        params.new_take_profit_price
    } else {
        strategy.take_profit_price
    };
    let effective_sl = if params.new_stop_loss_price > 0 {
        params.new_stop_loss_price
    } else {
        strategy.stop_loss_price
    };

    if effective_tp > 0 && effective_sl > 0 && effective_sl >= effective_tp {
        return Err(StrategyProgramError::InvalidSlTpConfig.into());
    }

    if params.new_status != 255 && params.new_status > 1 {
        return Err(StrategyProgramError::InvalidStatus.into());
    }
    if params.new_leverage > 10 {
        return Err(StrategyProgramError::InvalidSize.into());
    }

    if params.new_limit_price_lots > 0 {
        strategy.limit_price_lots = params.new_limit_price_lots;
    }
    if params.new_take_profit_price > 0 {
        strategy.take_profit_price = params.new_take_profit_price;
    }
    if params.new_stop_loss_price > 0 {
        strategy.stop_loss_price = params.new_stop_loss_price;
    }
    if params.new_size_lots > 0 {
        strategy.size_lots = params.new_size_lots;
    }
    if params.new_cooldown_secs > 0 {
        strategy.cooldown_secs = params.new_cooldown_secs;
    }
    if params.new_max_executions_per_day > 0 {
        strategy.max_executions_per_day = params.new_max_executions_per_day;
    }
    if params.new_status != 255 {
        strategy.status = params.new_status;

        // If pausing — reset daily counter
        if params.new_status == 1 {
            strategy.executions_today = 0;
        }
    }
    if params.new_leverage > 0 {
        strategy.leverage = params.new_leverage;
    }

    Ok(())
}
