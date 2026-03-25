use bytemuck::{Pod, Zeroable};
use pinocchio::{
    AccountView, ProgramResult,
    error::ProgramError,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    constants::{MARKET_SEED, OPEN_ORDERS_SEED},
    errors::OrderBookError,
    helper::{
        verify_account_owner, verify_initialized, verify_pda, verify_signer, verify_writtable,
    },
    states::{BookSide, MarketState, OpenOrdersAccount, Orderbook},
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct CancelOrderByClientIdParams {
    pub client_id: u64,
}

pub fn process_cancel_order_by_client_id(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        signer,
        open_orders_account,
        market,
        bids,
        asks,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_initialized(open_orders_account)?;
    verify_initialized(market)?;
    verify_initialized(bids)?;
    verify_initialized(asks)?;

    unsafe {
        verify_account_owner(market, &crate::ID)?;
        verify_account_owner(open_orders_account, &crate::ID)?;
        verify_account_owner(bids, &crate::ID)?;
        verify_account_owner(asks, &crate::ID)?;
    }

    verify_writtable(open_orders_account)?;
    verify_writtable(bids)?;
    verify_writtable(asks)?;

    let params = bytemuck::try_from_bytes::<CancelOrderByClientIdParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let now_ts = Clock::get()?.unix_timestamp;

    let market_data = market.try_borrow()?;
    let market_state = bytemuck::from_bytes::<MarketState>(&market_data[..MarketState::LEN]);
    if !market_state.is_active(now_ts) {
        return Err(OrderBookError::MarketInactive.into());
    }

    let mut oo_account_data = open_orders_account.try_borrow_mut()?;
    let oo_account_state = bytemuck::from_bytes_mut::<OpenOrdersAccount>(
        &mut oo_account_data[..OpenOrdersAccount::LEN],
    );

    // validations
    {
        let market_bump = [market_state.bump];
        let market_index = market_state.market_index.to_le_bytes();
        let open_orders_account_bump = [oo_account_state.bump];
        let open_orders_account_owner = oo_account_state.owner;

        unsafe {
            verify_account_owner(signer, &open_orders_account_owner)?;
            verify_account_owner(market, &oo_account_state.market)?;
            verify_account_owner(bids, &market_state.bids)?;
            verify_account_owner(asks, &market_state.asks)?;
        }

        verify_pda(
            market,
            &[MARKET_SEED, market_index.as_ref(), &market_bump],
            &crate::ID,
        )?;
        verify_pda(
            open_orders_account,
            &[
                OPEN_ORDERS_SEED,
                open_orders_account_owner.as_ref(),
                market.address().as_array().as_ref(),
                &open_orders_account_bump,
            ],
            &crate::ID,
        )?;
    }

    let slot = oo_account_state
        .find_order_with_client_id(params.client_id)
        .ok_or(OrderBookError::OrderIdNotFound)?;

    let oo = oo_account_state.open_order_by_raw_index(slot);

    let order_id = u128::from_le_bytes(oo.id);
    let side = oo.side();

    let mut bids_data = bids.try_borrow_mut()?;
    let bids_state = bytemuck::from_bytes_mut::<BookSide>(&mut bids_data[..BookSide::LEN]);

    let mut asks_data = asks.try_borrow_mut()?;
    let asks_state = bytemuck::from_bytes_mut::<BookSide>(&mut asks_data[..BookSide::LEN]);

    let mut orderbook = Orderbook {
        bids: bids_state,
        asks: asks_state,
    };
    orderbook.cancel_order(
        oo_account_state,
        order_id,
        side,
        Some(*signer.address().as_array()),
    )?;

    Ok(())
}
