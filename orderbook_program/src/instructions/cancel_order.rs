use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;

use crate::{
    constants::{MARKET_SEED, OPEN_ORDERS_SEED},
    cpi::order_margin_cpi,
    errors::OrderBookError,
    helper::{
        verify_account_owner, verify_initialized, verify_owner_or_delegate, verify_pda,
        verify_signer, verify_writtable,
    },
    states::{BookSide, MarketState, OpenOrdersAccount, Orderbook, Side},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct CancelOrderParams {
    pub order_id: [u8; 16],
    pub side: u8,
    pub padding: [u8; 7],
}

pub fn process_cancel_order(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, open_orders_account, market, bids, asks, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_initialized(open_orders_account)?;
    verify_initialized(market)?;
    verify_initialized(bids)?;
    verify_initialized(asks)?;
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

    let locked_price = oo_account_state
        .find_order_with_order_id(order_id)
        .ok_or(OrderBookError::OpenOrderNotFound)?
        .locked_price;

    let mut bids_data = bids.try_borrow_mut()?;
    let bids_state = bytemuck::from_bytes_mut::<BookSide>(&mut bids_data[..BookSide::LEN]);

    let mut asks_data = asks.try_borrow_mut()?;
    let asks_state = bytemuck::from_bytes_mut::<BookSide>(&mut asks_data[..BookSide::LEN]);

    let mut order_book = Orderbook {
        bids: bids_state,
        asks: asks_state,
    };
    let canceled = order_book.cancel_order(
        oo_account_state,
        order_id,
        side,
        Some(*signer.address().as_array()), // may also be Some(*open_orders_account.address().as_array()),
    )?;
    let quote_lots = canceled
        .quantity
        .checked_mul(locked_price)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if quote_lots > 0 {
        order_margin_cpi(
            risk_program,
            signer,
            user_account,
            market_config,
            quote_lots,
            market_state.market_index,
            0,
            false,
        )?;
    }
    Ok(())
}
