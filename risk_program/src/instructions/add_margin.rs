use bytemuck::{Pod, Zeroable};
use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use shank::ShankType;

use crate::{
    errors::RiskProgramError,
    helper::{verify_account_owner, verify_signer, verify_writtable},
    state::{MarketConfig, Position, UserAccount},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct AddMarginParams {
    pub amount: i64, // USDC native units to add as margin
    pub market_index: u16,
    pub padding: [u8; 6],
}

pub fn process_add_margin(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, user_account, position, market_config, _remaining @ ..] = accounts else {
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

    let params = bytemuck::try_pod_read_unaligned::<AddMarginParams>(data)
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

    let free_collateral = user_account_state.free_collateral();
    if params.amount > free_collateral {
        return Err(RiskProgramError::InsufficientCollateral.into());
    }

    user_account_state.margin_used = user_account_state
        .margin_used
        .checked_add(params.amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    position_state.initial_margin = position_state
        .initial_margin
        .checked_add(params.amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}
