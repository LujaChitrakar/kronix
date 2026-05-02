use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;
use std::i64;

use crate::{
    constants::TRIGGER_AUTHORITY_SEED,
    cpi::place_take_order_cpi,
    errors::TriggerProgramError,
    helpers::{
        close_account, verify_account_owner, verify_pda, verify_program_id, verify_signer,
        verify_writtable,
    },
    oracle::validate_switchboard_price,
    states::TriggerOrder,
};

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
    verify_pda(
        trigger_authority,
        &[TRIGGER_AUTHORITY_SEED, &owner_key, &bump_bytes],
        &crate::ID,
    )?;

    let mark_price = validate_switchboard_price(oracle, params.market_index, clock.slot)?;

    if !order.should_trigger(mark_price) {
        return Err(TriggerProgramError::TriggerConditionNotMet.into());
    }

    place_take_order_cpi(
        orderbook_program,
        system_program,
        trigger_authority,
        open_orders_account,
        market,
        bids,
        asks,
        fills_log,
        order.size_lots,
        i64::MAX,
        order.client_order_id,
        0, //ignored as its market order
        order.side,
        3u8,
        8u8,
        params.bump_fills_log,
        params.bump_authority,
        owner_key,
    )?;

    order.status = 1;
    drop(order_data);
    close_account(trigger_order, trigger_order_owner)?;
    Ok(())
}
