use std::i64;

use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};

use orderbook_program_cpi::{PlaceTakeOrderParams, PLACE_TAKE_ORDER_IX};

use crate::{
    cpi::place_take_order_cpi,
    errors::TriggerProgramError,
    helpers::{verify_account_owner, verify_program_id, verify_signer, verify_writtable},
    oracle::validate_pyth_price,
    states::TriggerOrder,
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct ExecuteTriggerParams {
    pub market_index: u16,
    pub bump_oo_account: u8,
    pub bump_position: u8, // for risk_program via orderbook CPI
    pub bump_user: u8,
    pub padding: [u8; 3],
}

pub fn execute_trigger(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
            keeper,              // permissionless — any signer
            orderbook_program,   // CPI target
            risk_program,
            trigger_order,
            market,              // orderbook market state
            open_orders_account, // trigger owner's OO account
            bids,
            asks,
            market_config,
            funding_state,
            position,
            user_account,
            oracle,              // Pyth — for price validation
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

    let params = bytemuck::try_from_bytes::<ExecuteTriggerParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let clock = Clock::get()?;

    let mut order_data = trigger_order.try_borrow_mut()?;
    let order = bytemuck::from_bytes_mut::<TriggerOrder>(&mut order_data[..TriggerOrder::LEN]);

    if !order.is_active() {
        return Err(TriggerProgramError::TriggerNotActive.into());
    }
    if order.is_expired(clock.unix_timestamp) {
        order.status = 2; // mark cancelled
        return Err(TriggerProgramError::TriggerExpired.into());
    }

    let mark_price = validate_pyth_price(oracle, clock.unix_timestamp)?;

    if !order.should_trigger(mark_price) {
        return Err(TriggerProgramError::TriggerConditionNotMet.into());
    }

    let order_params = PlaceTakeOrderParams {
        max_base_lots: order.size_lots,
        max_quote_lots: i64::MAX, // market order sweeps all
        client_order_id: order.client_order_id,
        price_lots: 0, // market order — price ignored
        side: order.side,
        order_type: 3u8, // Market order
        limit: 8u8,
        bump_position: params.bump_position,
        bump_user: params.bump_user,
        padding: [0; 3],
    };

    place_take_order_cpi(
        keeper,
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
        order.size_lots,
        i64::MAX,
        order.client_order_id,
        0, //ignored as its market order
        order.side,
        3u8,
        8u8,
        params.bump_position,
        params.bump_user,
    )?;

    order.status = 1;
    Ok(())
}
