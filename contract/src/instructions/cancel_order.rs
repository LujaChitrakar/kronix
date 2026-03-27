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
    states::{BookSide, MarketState, OpenOrdersAccount, Orderbook, Side},
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct CancelOrderParams {
    pub order_id: [u8; 16],
    pub side: u8,
    pub padding: [u8; 7],
}

pub fn process_cancel_order(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
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

    let params = bytemuck::try_pod_read_unaligned::<CancelOrderParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let side = Side::try_from(params.side).map_err(|_| OrderBookError::InvalidSide)?;
    let order_id = u128::from_le_bytes(params.order_id);

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

        if signer.address().as_array() != &open_orders_account_owner {
            return Err(ProgramError::InvalidAccountOwner);
        }
        if market.address().as_array() != &oo_account_state.market {
            return Err(ProgramError::InvalidAccountOwner);
        }
        if bids.address().as_array() != &market_state.bids {
            return Err(ProgramError::InvalidAccountOwner);
        }
        if asks.address().as_array() != &market_state.asks {
            return Err(ProgramError::InvalidAccountOwner);
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

    let _order_slot = oo_account_state
        .find_order_with_order_id(order_id)
        .ok_or(OrderBookError::OpenOrderNotFound)?;

    let mut bids_data = bids.try_borrow_mut()?;
    let bids_state = bytemuck::from_bytes_mut::<BookSide>(&mut bids_data[..BookSide::LEN]);

    let mut asks_data = asks.try_borrow_mut()?;
    let asks_state = bytemuck::from_bytes_mut::<BookSide>(&mut asks_data[..BookSide::LEN]);

    let mut order_book = Orderbook {
        bids: bids_state,
        asks: asks_state,
    };
    order_book.cancel_order(
        oo_account_state,
        order_id,
        side,
        Some(*signer.address().as_array()), // may also be Some(*open_orders_account.address().as_array()),
    )?;
    Ok(())
}
