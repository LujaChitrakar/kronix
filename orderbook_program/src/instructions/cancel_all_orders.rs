use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;

use crate::{
    constants::{MARKET_SEED, MAX_OPEN_ORDERS, OPEN_ORDERS_SEED},
    cpi::order_margin_cpi,
    errors::OrderBookError,
    helper::{
        verify_account_owner, verify_owner_or_delegate, verify_pda, verify_signer, verify_writtable,
    },
    states::{BookSide, MarketState, OpenOrdersAccount, Orderbook, Side},
};
#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct CancelAllOrdersParams {
    pub client_id_filter: u64,
    pub side_filter: u8,       // 0=Bid, 1=Ask, 255=no filter
    pub has_client_filter: u8, // 1 = filter by client_id
    pub limit: u8,             // max cancels, 0 = use MAX_OPEN_ORDERS
    pub padding: [u8; 5],
}

pub fn process_cancel_all_orders(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, open_orders_account, market, bids, asks, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    let user_account = _remaining
        .first()
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let market_config = _remaining
        .get(1)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let risk_program = _remaining
        .get(2)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    if risk_program.address().as_array() != &crate::RISK_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
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

        verify_owner_or_delegate(signer, oo_account_state)?;
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

    let mut release_quote_lots = 0_i64;
    for i in 0..oo_account_state.open_orders.len() {
        let oo = oo_account_state.open_orders[i];
        if oo.is_free() {
            continue;
        }
        if let Some(side) = side_filter {
            if oo.side() != side {
                continue;
            }
        }
        if let Some(client_id) = client_id_filter {
            if oo.client_id != client_id {
                continue;
            }
        }
        let bookside = match oo.side() {
            Side::Bid => &*orderbook.bids,
            Side::Ask => &*orderbook.asks,
        };
        if let Some(leaf) = bookside.node_by_key(u128::from_le_bytes(oo.id)) {
            let quote_lots = leaf
                .quantity
                .checked_mul(oo.locked_price)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            release_quote_lots = release_quote_lots
                .checked_add(quote_lots)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        }
    }

    orderbook.cancel_all_orders(oo_account_state, side_filter, client_id_filter, limit)?;
    if release_quote_lots > 0 {
        order_margin_cpi(
            risk_program,
            signer,
            user_account,
            market_config,
            release_quote_lots,
            market_state.market_index,
            0,
            false,
        )?;
    }
    Ok(())
}
