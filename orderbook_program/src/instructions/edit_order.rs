use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;

use crate::{
    constants::{FILLS_LOG_SEED, MARKET_SEED, MAX_FILLS_PER_ORDER, OPEN_ORDERS_SEED},
    cpi::order_margin_cpi,
    errors::OrderBookError,
    helper::{
        verify_account_owner, verify_initialized, verify_owner_or_delegate, verify_pda,
        verify_program_id, verify_signer, verify_writtable,
    },
    instructions::place_order::apply_maker_open_order_fill,
    states::{
        margin_from_quote_lots, BookSide, FillEntry, FillsLog, MarketState, OpenOrdersAccount,
        Order, OrderParams, Orderbook, PlaceOrderType, PostOrderType, Side,
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
    pub bump_fills_log: u8,
    pub leverage: u8,
    pub padding: [u8; 3],
    pub order_id: [u8; 16],
}

pub fn process_edit_order(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, open_orders_account, market, bids, asks, fills_log, system_program, _remaining @ ..] =
        accounts
    else {
        return Err(ProgramError::InvalidAccountData);
    };

    verify_signer(signer)?;
    verify_initialized(open_orders_account)?;
    verify_initialized(market)?;
    verify_initialized(bids)?;
    verify_initialized(asks)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;
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

    let clock = Clock::get()?;
    let now_ts = clock.unix_timestamp;
    let now_slot = clock.slot;

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

    let log_data = fills_log.try_borrow()?;
    let log = bytemuck::from_bytes::<FillsLog>(&log_data[..FillsLog::LEN]);
    if !log.is_ready(now_slot) {
        return Err(OrderBookError::PreviousFillsNotSettled.into());
    }

    // validations
    {
        let market_bump = [market_state.bump];
        let market_index = market_state.market_index.to_le_bytes();
        let open_orders_account_bump = [oo_account_state.bump];
        let open_orders_account_owner = oo_account_state.owner;

        let client_id_bytes = params.client_order_id.to_le_bytes();
        let fill_bump_bytes = [params.bump_fills_log];

        let signer_key = signer.address().as_array();

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
        verify_pda(
            fills_log,
            &[
                FILLS_LOG_SEED,
                signer_key.as_ref(),
                client_id_bytes.as_ref(),
                &fill_bump_bytes,
            ],
            &crate::ID,
        )?;
    }

    let old_order_slot = oo_account_state
        .open_orders
        .iter()
        .position(|oo| !oo.is_free() && u128::from_le_bytes(oo.id) == order_id)
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

    let leverage = params.leverage;
    let reserved_margin = margin_from_quote_lots(params.new_quote_lots, leverage)?;

    let new_order = Order {
        side,
        max_base_lots: params.new_base_lots,
        max_quote_lots: params.new_quote_lots,
        client_order_id: params.client_order_id,
        leverage,
        reserved_margin,
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
    let release_margin = oo_account_state
        .open_order_by_raw_index(old_order_slot)
        .releasable_margin()?;
    match order_book.cancel_order(
        oo_account_state,
        order_id,
        side,
        Some(*signer.address().as_array()),
    ) {
        Ok(_old_leaf) => {
            if release_margin > 0 {
                order_margin_cpi(
                    risk_program,
                    signer,
                    user_account,
                    market_config,
                    open_orders_account,
                    oo_account_state.owner,
                    0,
                    release_margin,
                    market_state.market_index,
                    0,
                    0,
                    false,
                )?;
            }
        }
        Err(e) => {
            // if order not found still place  new one
            let is_not_found = matches!(
                e,
                ProgramError::Custom(code)
                if code == OrderBookError::OpenOrderNotFound as u32
                    || code == OrderBookError::OrderIdNotFound as u32
            );
            if !is_not_found {
                return Err(e);
            }
        }
    }

    // place new order
    order_margin_cpi(
        risk_program,
        signer,
        user_account,
        market_config,
        open_orders_account,
        oo_account_state.owner,
        new_order.max_quote_lots,
        0,
        market_state.market_index,
        leverage,
        0,
        true,
    )?;

    let mut result = order_book.new_order(
        &new_order,
        market_state,
        oo_account_state,
        now_ts as u64,
        params.limit.min(MAX_FILLS_PER_ORDER as u8),
    )?;

    for i in 0..result.fill_count as usize {
        apply_maker_open_order_fill(
            &_remaining[3..],
            *market.address().as_array(),
            &mut result.fills[i],
        )?;
    }

    if result.unused_reserved_margin > 0 {
        order_margin_cpi(
            risk_program,
            signer,
            user_account,
            market_config,
            open_orders_account,
            oo_account_state.owner,
            0,
            result.unused_reserved_margin,
            market_state.market_index,
            leverage,
            0,
            false,
        )?;
    }

    if result.fill_count > 0 {
        let mut log_data = fills_log.try_borrow_mut()?;
        let log = bytemuck::from_bytes_mut::<FillsLog>(&mut log_data[..FillsLog::LEN]);

        log.reset(
            *market.address().as_array(),
            *signer.address().as_array(),
            params.client_order_id,
            now_slot,
        );

        for i in 0..result.fill_count as usize {
            let fill = &result.fills[i];

            log.fills[i] = FillEntry {
                taker_client_id: params.client_order_id,
                maker_client_id: fill.maker_client_order_id,
                price: fill.price,
                quantity: fill.quantity,
                taker_reserved_margin: fill.taker_reserved_margin,
                taker_filled_base_lots: fill.taker_filled_base_lots,
                taker_original_base_lots: fill.taker_original_base_lots,
                maker_reserved_margin: fill.maker_reserved_margin,
                maker_filled_base_lots: fill.maker_filled_base_lots,
                maker_original_base_lots: fill.maker_original_base_lots,
                taker_side: fill.taker_side,
                maker_slot: fill.maker_slot,
                maker_out: fill.maker_out as u8,
                settled: 0,
                market_index: market_state.market_index,
                padding: [0; 2],
                taker_pubkey: oo_account_state.owner,
                maker_pubkey: fill.maker_pubkey,
            };
        }

        log.fill_count = result.fill_count;
        log.all_settled = 0; // pending settlement
    }
    Ok(())
}
