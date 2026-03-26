use bytemuck::{Pod, Zeroable};
use pinocchio::{
    AccountView, ProgramResult,
    error::ProgramError,
    sysvars::{Sysvar, clock::Clock},
};
use pinocchio_log::log;

use crate::{
    constants::{MARKET_SEED, MAX_FILLS_PER_ORDER, OPEN_ORDERS_SEED},
    errors::OrderBookError,
    helper::{
        verify_account_owner, verify_initialized, verify_pda, verify_signer, verify_writtable,
    },
    states::{
        BookSide, MarketState, OpenOrdersAccount, Order, OrderParams, Orderbook, PlaceOrderType,
        PostOrderType, Side,
    },
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct PlaceOrderParams {
    pub side: u8,
    pub order_type: u8,
    pub limit: u8,
    pub padding: [u8; 5],
    pub max_base_lots: i64,
    pub max_quote_lots: i64,
    pub client_order_id: u64,
    pub expiry_timestamp: u64,
    pub price_lots: i64,
}

pub fn process_place_order(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        signer,
        open_orders_account,
        market,
        bids,
        asks,
        // risk_program,
        // taker_user_account,
        // taker_position,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(pinocchio::error::ProgramError::InvalidAccountData);
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

    verify_writtable(market)?;
    verify_writtable(open_orders_account)?;
    verify_writtable(bids)?;
    verify_writtable(asks)?;

 
    let params = bytemuck::try_pod_read_unaligned::<PlaceOrderParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;


    let now_ts = Clock::get()?.unix_timestamp;

    let mut market_data = market.try_borrow_mut()?;
    let market_state =
        bytemuck::from_bytes_mut::<MarketState>(&mut market_data[..MarketState::LEN]);
  

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

        // Check signer pubkey matches stored owner — use address(), not owner()
           if signer.address().as_array() != &open_orders_account_owner {
               return Err(ProgramError::InvalidAccountOwner);
           }
       
           // Check market address matches stored market in OO account
           if market.address().as_array() != &oo_account_state.market {
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

    let place_order_type = PlaceOrderType::try_from(params.order_type)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let side = Side::try_from(params.side).map_err(|_| ProgramError::InvalidInstructionData)?;

    let order_params = match place_order_type {
        PlaceOrderType::Market => OrderParams::Market,
        PlaceOrderType::ImmediateOrCancel => OrderParams::ImmediateOrCancel {
            price_lots: params.price_lots,
        },
        PlaceOrderType::FillOrKill => OrderParams::FillOrKill {
            price_lots: params.price_lots,
        },
        PlaceOrderType::Limit => OrderParams::Fixed {
            price_lots: params.price_lots,
            order_type: PostOrderType::Limit,
        },
        PlaceOrderType::PostOnly => OrderParams::Fixed {
            price_lots: params.price_lots,
            order_type: PostOrderType::PostOnly,
        },
        PlaceOrderType::PostOnlySlide => OrderParams::Fixed {
            price_lots: params.price_lots,
            order_type: PostOrderType::PostOnlySlide,
        },
    };

    let time_in_force = Order::tif_from_expiry(params.expiry_timestamp, now_ts as u64)
        .ok_or(OrderBookError::OrderAlreadyExpired)?;

    let order = Order {
        side,
        max_base_lots: params.max_base_lots,
        max_quote_lots: params.max_quote_lots,
        client_order_id: params.client_order_id,
        time_in_force,
        params: order_params,
    };

    if order.max_base_lots <= 0 {
        return Err(OrderBookError::InvalidInputLotsSize.into());
    }
    if order.max_quote_lots <= 0 {
        return Err(OrderBookError::InvalidInputLotsSize.into());
    }

    let mut bids_data = bids.try_borrow_mut()?;
    let bids_state = bytemuck::from_bytes_mut::<BookSide>(&mut bids_data[..BookSide::LEN]);

    let mut asks_data = asks.try_borrow_mut()?;
    let asks_state = bytemuck::from_bytes_mut::<BookSide>(&mut asks_data[..BookSide::LEN]);

    if bids.address().as_array() != &market_state.bids {
        return Err(ProgramError::InvalidAccountOwner);
    }
    if asks.address().as_array() != &market_state.asks {
        return Err(ProgramError::InvalidAccountOwner);
    }

    // matching engine
    let mut order_book = Orderbook {
        bids: bids_state,
        asks: asks_state,
    };

    let result = order_book.new_order(
        &order,
        market_state,
        oo_account_state,
        now_ts as u64,
        params.limit.min(MAX_FILLS_PER_ORDER as u8),
    )?;

    // setle_fills
    for i in 0..result.fill_count as usize {
        let fill = &result.fills[i];

        // record fill on makers 00 account
        // maker calls claim_fill ix to settle with risk_program
        // we need makers oo account passed in remaining accounts
        if let Some(maker_oo_account) = _remaining.get(i) {
            unsafe {
                if maker_oo_account.owner().as_array() == &crate::ID {
                    let mut maker_oo_data = maker_oo_account.try_borrow_mut()?;
                    let maker_oo = bytemuck::from_bytes_mut::<OpenOrdersAccount>(
                        &mut maker_oo_data[..OpenOrdersAccount::LEN],
                    );

                    if maker_oo.owner == fill.maker_pubkey
                        && maker_oo.market == *market.address().as_array()
                    {
                        maker_oo.record_fill(
                            fill.maker_slot as usize,
                            fill.quantity,
                            fill.price,
                            fill.maker_out(),
                        );
                    }
                }
            }
        }

        // may be error
        // oo_account_state.cleanup_stale_orders(bids_state, asks_state);

        // TODO: CPI to risk_program::settle_fill for taker
        // Uncomment when risk_program is built:
        //
        // settle_fill_cpi(
        //     risk_program,
        //     taker_user_account,
        //     taker_position,
        //     fill,
        //     true,  // is_taker
        // )?;
    }
    Ok(())
}
