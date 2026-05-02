use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_log::log;
use shank::ShankType;

use crate::{
    errors::RiskProgramError,
    helper::{verify_account_owner, verify_signer, verify_writtable},
    instructions::settle_funding_internal,
    oracle::validate_switchboard_price,
    state::{FundingState, InsuranceFund, MarketConfig, Position, UserAccount},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct CoverBadDebtParams {
    pub market_index: u16,
    pub padding: [u8; 6],
}
pub fn process_cover_bad_debt(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    log!("cover_bad_debt start");
    let [
        caller,       // liquidator bot or anyone — permissionless
        user_account, // underwater account
        position,     // underwater position
        market_config,
        funding_state,
        insurance_fund,
        oracle,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(caller)?;
    unsafe {
        verify_account_owner(user_account, &crate::ID)?;
        verify_account_owner(position, &crate::ID)?;
        verify_account_owner(market_config, &crate::ID)?;
        verify_account_owner(funding_state, &crate::ID)?;
        verify_account_owner(insurance_fund, &crate::ID)?;
        verify_writtable(user_account)?;
        verify_writtable(position)?;
        verify_writtable(insurance_fund)?;
    }

    log!("owners ok");

    let params = bytemuck::try_pod_read_unaligned::<CoverBadDebtParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let clock = Clock::get()?;

    let market_config_data = market_config.try_borrow()?;
    let market_config_state =
        bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);

    if market_config_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }

    // uncomment later on oracle validation
    let mark_price_native = validate_switchboard_price(oracle, params.market_index, clock.slot)?;
    let mark_price = mark_price_native
        .checked_div(market_config_state.quote_lot_size)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if mark_price <= 0 {
        return Err(RiskProgramError::InvalidOraclePrice.into());
    }
    // let mark_price = validated.price;
    // let mark_price = 100;

    log!("mark_price: {}", mark_price);
    let mut position_data = position.try_borrow_mut()?;
    let position_state = bytemuck::from_bytes_mut::<Position>(&mut position_data[..Position::LEN]);

    if position_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }
    if position_state.size == 0 {
        return Err(RiskProgramError::InvalidPositionSize.into());
    }

    log!("position size: {}", position_state.size);

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    if user_account_state.owner != position_state.owner {
        return Err(RiskProgramError::InvalidOwner.into());
    }
    log!("user owner match ok");

    let mut funding_data = funding_state.try_borrow_mut()?;
    let funding = bytemuck::from_bytes_mut::<FundingState>(&mut funding_data[..FundingState::LEN]);

    settle_funding_internal(
        user_account_state,
        position_state,
        funding,
        market_config_state.quote_lot_size,
    )?;

    log!("settle funding ok");
    // verify account is actually in bad debt
    let unrealised_pnl = position_state
        .unrealised_pnl(mark_price, market_config_state.quote_lot_size)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    log!("pnl: {}", unrealised_pnl);
    let equity = user_account_state
        .collateral
        .checked_add(unrealised_pnl)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    log!("equity: {}", equity);

    if equity >= 0 {
        return Err(RiskProgramError::NotInBadDebt.into());
    }

    log!("shortfall");
    let shortfall = equity.unsigned_abs() as u64;
    log!("shortfall: {}", shortfall);

    let mut insurance_data = insurance_fund.try_borrow_mut()?;
    let insurance_state =
        bytemuck::from_bytes_mut::<InsuranceFund>(&mut insurance_data[..InsuranceFund::LEN]);

    log!("insurance balance: {}", insurance_state.balance);
    log!("shortfall: {}", shortfall);
    log!("equity: {}", equity);
    log!("unrealised_pnl: {}", unrealised_pnl);
    log!("collateral: {}", user_account_state.collateral);
    let uncovered = insurance_state.cover_bad_debt(shortfall);

    user_account_state.collateral = 0;
    user_account_state.margin_used = user_account_state
        .margin_used
        .saturating_sub(position_state.initial_margin);
    user_account_state.position_count = user_account_state.position_count.saturating_sub(1);

    position_state.size = 0;
    position_state.initial_margin = 0;

    if uncovered > 0 {
        // Insurance fund could not cover full shortfall
        // Emit ADL signal — off-chain handles deleveraging
        // v2: on-chain ADL against most profitable opposing position
        return Err(RiskProgramError::InsuranceFundDepleted.into());
    }

    Ok(())
}
