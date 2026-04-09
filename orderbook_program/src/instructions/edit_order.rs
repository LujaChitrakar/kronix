use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use shank::ShankType;

use crate::{
    constants::{MARKET_SEED, MAX_FILLS_PER_ORDER, OPEN_ORDERS_SEED},
    cpi::settle_fill_cpi,
    errors::OrderBookError,
    helper::{
        verify_account_owner, verify_initialized, verify_pda, verify_program_id, verify_signer,
        verify_writtable,
    },
    states::{
        BookSide, MarketState, OpenOrdersAccount, Order, OrderParams, Orderbook, PlaceOrderType,
        PostOrderType, Side,
    },
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct EditOrderParams {
    pub new_price_lots: i64,
    pub new_base_lots: i64,
    pub new_quote_lots: i64,
    pub client_order_id: u64,
    pub expiry_timestamp: u64,
    pub side: u8,
    pub order_type: u8,
    pub limit: u8,
    pub bump_position: u8,
    pub bump_user: u8,
    pub padding: [u8; 3],
    pub order_id: [u8; 16],
}

pub fn process_edit_order(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, open_orders_account, market, bids, asks, orderbook_program_self, risk_program, taker_user_account, taker_position, market_config, funding_state, system_program, _remaining @ ..] =
        accounts
    else {
        return Err(ProgramError::InvalidAccountData);
    };

    verify_signer(signer)?;
    verify_initialized(open_orders_account)?;
    verify_initialized(market)?;
    verify_initialized(bids)?;
    verify_initialized(asks)?;
    verify_program_id(orderbook_program_self, &Address::from(crate::ID))?;
    unsafe {
        verify_account_owner(market, &crate::ID)?;
        verify_account_owner(open_orders_account, &crate::ID)?;
        verify_account_owner(bids, &crate::ID)?;
        verify_account_owner(asks, &crate::ID)?;
    }
    verify_writtable(open_orders_account)?;
    verify_writtable(market)?;
    verify_writtable(bids)?;
    verify_writtable(asks)?;

    let params = bytemuck::try_pod_read_unaligned::<EditOrderParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let side = Side::try_from(params.side).map_err(|_| OrderBookError::InvalidSide)?;
    let place_order_type = PlaceOrderType::try_from(params.order_type)
        .map_err(|_| OrderBookError::InvalidOrderType)?;

    if params.new_base_lots <= 0 || params.new_quote_lots <= 0 {
        return Err(OrderBookError::InvalidInputLots.into());
    }
    if params.new_price_lots <= 0 {
        return Err(OrderBookError::InvalidPriceLots.into());
    }
    let order_id = u128::from_le_bytes(params.order_id);

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

    oo_account_state
        .find_order_with_order_id(order_id)
        .ok_or(OrderBookError::OrderIdNotFound)?;

    let time_in_force = Order::tif_from_expiry(params.expiry_timestamp, now_ts as u64)
        .ok_or(OrderBookError::OrderAlreadyExpired)?;

    let order_params = match place_order_type {
        PlaceOrderType::Limit => OrderParams::Fixed {
            price_lots: params.new_price_lots,
            order_type: PostOrderType::Limit,
        },
        PlaceOrderType::PostOnly => OrderParams::Fixed {
            price_lots: params.new_price_lots,
            order_type: PostOrderType::PostOnly,
        },
        PlaceOrderType::PostOnlySlide => OrderParams::Fixed {
            price_lots: params.new_price_lots,
            order_type: PostOrderType::PostOnlySlide,
        },
        _ => return Err(OrderBookError::InvalidOrderType.into()),
    };

    let new_order = Order {
        side,
        max_base_lots: params.new_base_lots,
        max_quote_lots: params.new_quote_lots,
        client_order_id: params.client_order_id,
        time_in_force,
        params: order_params,
    };

    let mut bids_data = bids.try_borrow_mut()?;
    let bids_state = bytemuck::from_bytes_mut::<BookSide>(&mut bids_data[..BookSide::LEN]);

    let mut asks_data = asks.try_borrow_mut()?;
    let asks_state = bytemuck::from_bytes_mut::<BookSide>(&mut asks_data[..BookSide::LEN]);

    let mut order_book = Orderbook {
        bids: bids_state,
        asks: asks_state,
    };

    if new_order.max_base_lots <= 0 {
        return Err(OrderBookError::InvalidInputLotsSize.into());
    }
    if new_order.max_quote_lots <= 0 {
        return Err(OrderBookError::InvalidInputLotsSize.into());
    }

    // cancel existing order
    match order_book.cancel_order(
        oo_account_state,
        order_id,
        side,
        Some(*signer.address().as_array()),
    ) {
        Ok(_) => {}
        Err(e) => {
            // if order not found still place  new one
            let is_not_found = matches!(e, ProgramError::Custom(_));
            if !is_not_found {
                return Err(e);
            }
        }
    }

    // place new order

    let result = order_book.new_order(
        &new_order,
        market_state,
        oo_account_state,
        now_ts as u64,
        params.limit.min(MAX_FILLS_PER_ORDER as u8),
    )?;

    // settle any fills from new order
    for i in 0..result.fill_count as usize {
        let fill = &result.fills[i];

        // record fills
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
        settle_fill_cpi(
            orderbook_program_self,
            risk_program,
            taker_user_account,
            taker_position,
            market_config,
            funding_state,
            system_program,
            fill,
            market_state.market_index,
            true,
            params.bump_position,
            params.bump_user,
        )?;
    }
    Ok(())
}
