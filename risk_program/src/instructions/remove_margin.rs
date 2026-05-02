use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;

use crate::{
    errors::RiskProgramError,
    helper::{verify_account_owner, verify_signer, verify_writtable},
    oracle::validate_switchboard_price,
    state::{MarketConfig, Position, UserAccount},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct RemoveMarginParams {
    pub amount: i64, // USDC native units to remove as margin
    pub market_index: u16,
    pub padding: [u8; 6],
}

pub fn process_remove_margin(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, user_account, position, market_config, oracle, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    unsafe {
        verify_account_owner(user_account, &crate::ID)?;
        verify_account_owner(position, &crate::ID)?;
        verify_account_owner(market_config, &crate::ID)?;
        verify_writtable(user_account)?;
        verify_writtable(position)?;
    }

    let clock = Clock::get()?;

    let params = bytemuck::try_pod_read_unaligned::<RemoveMarginParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    if params.amount <= 0 {
        return Err(RiskProgramError::InvalidAmount.into());
    }

    let market_config_data = market_config.try_borrow()?;
    let market_config_state =
        bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);

    if market_config_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }

    // uncomment during oracle tests
    let mark_price = validate_switchboard_price(oracle, params.market_index, clock.slot)?;
    // let mark_price = validated.price;
    // let mark_price: i64 = 10;

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    if user_account_state.owner != *signer.address().as_array() {
        return Err(RiskProgramError::InvalidOwner.into());
    }

    let mut position_data = position.try_borrow_mut()?;
    let position_state = bytemuck::from_bytes_mut::<Position>(&mut position_data[..Position::LEN]);

    if position_state.owner != *signer.address().as_array() {
        return Err(RiskProgramError::InvalidOwner.into());
    }
    if position_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }
    if position_state.size == 0 {
        return Err(RiskProgramError::InvalidPositionSize.into());
    }

    if params.amount > position_state.initial_margin {
        return Err(RiskProgramError::InsufficientCollateral.into());
    }

    let new_margin = position_state
        .initial_margin
        .checked_sub(params.amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let mark_price_lots = mark_price
        .checked_div(market_config_state.quote_lot_size)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if mark_price_lots <= 0 {
        return Err(RiskProgramError::InvalidOraclePrice.into());
    }

    let maintenance_margin =
        market_config_state.required_maintenance_margin(position_state.size, mark_price_lots);

    // Must keep at least maintenance margin in position
    if new_margin < maintenance_margin {
        return Err(RiskProgramError::InsufficientCollateral.into());
    }

    user_account_state.margin_used = user_account_state.margin_used.saturating_sub(params.amount);
    position_state.initial_margin = new_margin;

    Ok(())
}
