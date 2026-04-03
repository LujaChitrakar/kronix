use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};

use crate::{
    constants::{MARKET_SEED, MAX_OPEN_ORDERS, OPEN_ORDERS_SEED},
    errors::OrderBookError,
    helper::{verify_account_owner, verify_pda, verify_signer, verify_writtable},
    states::{BookSide, MarketState, OpenOrdersAccount, Orderbook, Side},
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct CancelAllOrdersParams {
    pub side_filter: u8,       // 0=Bid, 1=Ask, 255=no filter
    pub has_client_filter: u8, // 1 = filter by client_id
    pub limit: u8,             // max cancels, 0 = use MAX_OPEN_ORDERS
    pub padding: [u8; 5],
    pub client_id_filter: u64,
}

pub fn process_cancel_all_orders(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, open_orders_account, market, bids, asks, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    unsafe {
        verify_account_owner(market, &crate::ID)?;
        verify_account_owner(open_orders_account, &crate::ID)?;
        verify_account_owner(bids, &crate::ID)?;
        verify_account_owner(asks, &crate::ID)?;
    }
    verify_writtable(open_orders_account)?;
    verify_writtable(bids)?;
    verify_writtable(asks)?;

    let params = bytemuck::try_pod_read_unaligned::<CancelAllOrdersParams>(data)
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

    let side_filter: Option<Side> = match params.side_filter {
        0 => Some(Side::Bid),
        1 => Some(Side::Ask),
        255 => None,
        _ => return Err(OrderBookError::InvalidSide.into()),
    };

    let client_id_filter: Option<u64> = if params.has_client_filter == 1 {
        Some(params.client_id_filter)
    } else {
        None
    };

    let limit = if params.limit == 0 {
        MAX_OPEN_ORDERS as u8
    } else {
        params.limit
    };

    let mut bids_data = bids.try_borrow_mut()?;
    let bids_state = bytemuck::from_bytes_mut::<BookSide>(&mut bids_data[..BookSide::LEN]);

    let mut asks_data = asks.try_borrow_mut()?;
    let asks_state = bytemuck::from_bytes_mut::<BookSide>(&mut asks_data[..BookSide::LEN]);

    let mut orderbook = Orderbook {
        bids: bids_state,
        asks: asks_state,
    };

    orderbook.cancel_all_orders(oo_account_state, side_filter, client_id_filter, limit)?;
    Ok(())
}
