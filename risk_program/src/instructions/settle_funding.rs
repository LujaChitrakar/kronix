use pinocchio::{error::ProgramError, AccountView, ProgramResult};

use crate::{
    errors::RiskProgramError,
    helper::{verify_account_owner, verify_signer},
    state::{FundingState, MarketConfig, Position, UserAccount},
};

// Called lazily before position change, called internally
pub fn settle_funding_internal(
    user_account: &mut UserAccount,
    position: &mut Position,
    funding: &FundingState,
    quote_lot_size: i64,
) -> ProgramResult {
    let funding_owed =
        funding.funding_owed(position.size, position.entry_funding_index, quote_lot_size);

    user_account.collateral = user_account
        .collateral
        .checked_sub(funding_owed)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    position.entry_funding_index = funding.cumulative_index;
    Ok(())
}

pub fn process_settle_funding(accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    let [signer, user_account, position, market_config, funding_state, _remaining @ ..] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    verify_signer(signer)?;
    unsafe {
        verify_account_owner(market_config, &crate::ID)?;
        verify_account_owner(user_account, &crate::ID)?;
        verify_account_owner(funding_state, &crate::ID)?;
        verify_account_owner(position, &crate::ID)?;
    }

    // Permissionless crank: anyone can settle funding for any position. The
    // settle_funding_internal call only mutates collateral by the funding
    // delta and bumps entry_funding_index — no value transfer to caller, so
    // there is no incentive for a malicious settler. Required so a keeper
    // bot can sweep all positions on the 8-hour cadence.
    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    let mut position_data = position.try_borrow_mut()?;
    let position_state = bytemuck::from_bytes_mut::<Position>(&mut position_data[..Position::LEN]);

    if position_state.owner != user_account_state.owner {
        return Err(RiskProgramError::InvalidOwner.into());
    }

    let funding_data = funding_state.try_borrow()?;
    let funding = bytemuck::from_bytes::<FundingState>(&funding_data[..FundingState::LEN]);

    let market_config_data = market_config.try_borrow()?;
    let market_config_state =
        bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);
    settle_funding_internal(
        user_account_state,
        position_state,
        funding,
        market_config_state.quote_lot_size,
    )?;

    Ok(())
}
