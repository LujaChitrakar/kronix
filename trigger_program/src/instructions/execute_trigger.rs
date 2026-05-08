use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;

use crate::{
    constants::{
        MAX_CPI_MAKER_ACCOUNTS, QUOTE_NATIVE_UNIT, RISK_PROGRAM_ID, TRIGGER_AUTHORITY_SEED,
    },
    cpi::place_take_order_cpi,
    errors::TriggerProgramError,
    helpers::{
        close_account, verify_account_owner, verify_pda, verify_program_id, verify_signer,
        verify_writtable,
    },
    oracle::validate_switchboard_price,
    states::TriggerOrder,
};

const POSITION_LEN: usize = 104;
const POSITION_SIZE_OFFSET: usize = 0;
const POSITION_MARKET_INDEX_OFFSET: usize = 32;
const POSITION_SIDE_OFFSET: usize = 35;
const POSITION_OWNER_OFFSET: usize = 40;

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct ExecuteTriggerParams {
    pub market_index: u16,
    pub bump_fills_log: u8,
    pub bump_authority: u8,
    pub padding: [u8; 4],
}

pub fn process_execute_trigger(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
            keeper,              // permissionless — any signer
            trigger_authority,
            trigger_order_owner,
            trigger_order,
            position,            // risk position PDA; trigger can only close this position
            market,              // orderbook market state
            open_orders_account, // trigger owner's OO account
            bids,
            asks,
            fills_log,
            oracle,              // Switchboard price feed
            orderbook_program,   // CPI target
            system_program,
            _remaining @ ..,
        ] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

    verify_signer(keeper)?;
    unsafe {
        verify_account_owner(trigger_order, &crate::ID)?;
    }
    verify_writtable(trigger_order)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;

    let params = bytemuck::try_pod_read_unaligned::<ExecuteTriggerParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let clock = Clock::get()?;
    let [user_account, market_config, risk_program, maker_open_orders @ ..] = _remaining else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if risk_program.address().as_array() != &RISK_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    unsafe {
        verify_account_owner(market_config, &RISK_PROGRAM_ID)?;
    }

    let bump_bytes = [params.bump_authority];

    let mut order_data = trigger_order.try_borrow_mut()?;
    let order = bytemuck::from_bytes_mut::<TriggerOrder>(&mut order_data[..TriggerOrder::LEN]);
    if order.owner != *trigger_order_owner.address().as_array() {
        return Err(TriggerProgramError::InvalidOwner.into());
    }
    if !order.is_active() {
        return Err(TriggerProgramError::TriggerNotActive.into());
    }
    if order.is_expired(clock.unix_timestamp) {
        order.status = 2; // mark cancelled
        drop(order_data);
        close_account(trigger_order, trigger_order_owner)?;
        return Err(TriggerProgramError::TriggerExpired.into());
    }
    if open_orders_account.address().as_array() != &order.open_orders_account {
        return Err(TriggerProgramError::InvalidOOAccount.into());
    }

    let owner_key = order.owner;
    if position.is_data_empty() {
        return Err(TriggerProgramError::NoMatchingPosition.into());
    }
    unsafe {
        verify_account_owner(position, &RISK_PROGRAM_ID)?;
    }
    let position_data = position.try_borrow()?;
    if position_data.len() < POSITION_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let position_size = i64::from_le_bytes(
        position_data[POSITION_SIZE_OFFSET..POSITION_SIZE_OFFSET + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let position_market_index = u16::from_le_bytes(
        position_data[POSITION_MARKET_INDEX_OFFSET..POSITION_MARKET_INDEX_OFFSET + 2]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let position_side = position_data[POSITION_SIDE_OFFSET];
    let position_owner = &position_data[POSITION_OWNER_OFFSET..POSITION_OWNER_OFFSET + 32];
    let expected_position_side = if order.side == 0 { 1 } else { 0 };
    if position_owner != owner_key.as_ref()
        || position_market_index != params.market_index
        || position_side != expected_position_side
        || position_size < order.size_lots
    {
        return Err(TriggerProgramError::NoMatchingPosition.into());
    }
    drop(position_data);

    verify_pda(
        trigger_authority,
        &[TRIGGER_AUTHORITY_SEED, &owner_key, &bump_bytes],
        &crate::ID,
    )?;

    let market_config_data = market_config.try_borrow()?;
    if market_config_data.len() < 18 {
        return Err(ProgramError::InvalidAccountData);
    }
    let config_market_index = u16::from_le_bytes(
        market_config_data[16..18]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    if config_market_index != params.market_index {
        return Err(TriggerProgramError::InvalidTriggerPrice.into());
    }
    drop(market_config_data);

    let mark_price_native = validate_switchboard_price(oracle, params.market_index, clock.slot)?;
    let mark_price = mark_price_native
        .checked_div(QUOTE_NATIVE_UNIT)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if mark_price <= 0 {
        return Err(TriggerProgramError::InvalidTriggerPrice.into());
    }

    if !order.should_trigger(mark_price) {
        return Err(TriggerProgramError::TriggerConditionNotMet.into());
    }
    let max_quote_lots = order
        .size_lots
        .checked_mul(mark_price)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let maker_count = maker_open_orders.len().min(MAX_CPI_MAKER_ACCOUNTS);
    let limit = if maker_count > 0 {
        maker_count as u8
    } else {
        1
    };

    place_take_order_cpi(
        orderbook_program,
        system_program,
        trigger_authority,
        open_orders_account,
        market,
        bids,
        asks,
        fills_log,
        user_account,
        market_config,
        risk_program,
        maker_open_orders,
        order.size_lots,
        max_quote_lots,
        order.client_order_id,
        0, //ignored as its market order
        order.side,
        3u8,
        limit,
        params.bump_fills_log,
        params.bump_authority,
        owner_key,
    )?;

    order.status = 1;
    drop(order_data);
    close_account(trigger_order, trigger_order_owner)?;
    Ok(())
}
