use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;

use crate::{
    constants::{
        FILLS_LOG_SEED, MARKET_SEED, MAX_FILLS_PER_ORDER, MAX_OPEN_ORDERS, OPEN_ORDERS_SEED,
        TRIGGER_AUTHORITY_SEED,
    },
    cpi::order_margin_cpi,
    errors::OrderBookError,
    helper::{
        verify_account_owner, verify_initialized, verify_pda, verify_program_id, verify_signer,
        verify_writtable,
    },
    instructions::place_order::apply_maker_open_order_fill,
    states::{
        margin_from_quote_lots, BookSide, FillEntry, FillsLog, MarketState, OpenOrdersAccount,
        Order, OrderParams, Orderbook, PlaceOrderType, Side,
    },
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct PlaceTakeOrderParams {
    pub max_base_lots: i64,
    pub max_quote_lots: i64,
    pub client_order_id: u64,
    pub price_lots: i64,
    pub side: u8,
    pub order_type: u8,
    pub limit: u8,
    pub bump_fills_log: u8,
    pub leverage: u8,
    pub padding: [u8; 3],
}

pub fn process_place_take_order(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, open_orders_account, market, bids, asks, fills_log, system_program, _remaining @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
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

    verify_writtable(market)?;
    verify_writtable(open_orders_account)?;
    verify_writtable(bids)?;
    verify_writtable(asks)?;

    let params = bytemuck::try_pod_read_unaligned::<PlaceTakeOrderParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let clock = Clock::get()?;
    let now_slot = clock.slot;

    let place_order_type = PlaceOrderType::try_from(params.order_type)
        .map_err(|_| OrderBookError::InvalidOrderType)?;

    let order_params = match place_order_type {
        PlaceOrderType::Market => OrderParams::Market,
        PlaceOrderType::ImmediateOrCancel => OrderParams::ImmediateOrCancel {
            price_lots: params.price_lots,
        },
        PlaceOrderType::FillOrKill => OrderParams::FillOrKill {
            price_lots: params.price_lots,
        },
        PlaceOrderType::Limit | PlaceOrderType::PostOnly | PlaceOrderType::PostOnlySlide => {
            return Err(OrderBookError::InvalidOrderType.into());
        }
    };

    let side = Side::try_from(params.side).map_err(|_| OrderBookError::InvalidSide)?;

    if params.max_base_lots <= 0 {
        return Err(OrderBookError::InvalidInputLots.into());
    }
    if params.max_quote_lots <= 0 {
        return Err(OrderBookError::InvalidInputLots.into());
    }

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

    let log_data = fills_log.try_borrow()?;
    let log = bytemuck::from_bytes::<FillsLog>(&log_data[..FillsLog::LEN]);
    if !log.is_ready(now_slot) {
        return Err(OrderBookError::PreviousFillsNotSettled.into());
    }
    drop(log_data);

    // validations
    {
        let market_bump = [market_state.bump];
        let market_index = market_state.market_index.to_le_bytes();
        let open_orders_account_bump = [oo_account_state.bump];
        let open_orders_account_owner = oo_account_state.owner;

        let client_id_bytes = params.client_order_id.to_le_bytes();
        let fill_bump_bytes = [params.bump_fills_log];

        let signer_key = signer.address().as_array();
        let is_owner = signer_key == &oo_account_state.owner;
        let is_delegate =
            oo_account_state.delegate != [0u8; 32] && signer_key == &oo_account_state.delegate;

        if !is_owner && !is_delegate {
            return Err(OrderBookError::InvalidOwner.into());
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

    let leverage = params.leverage;
    let reserved_margin = margin_from_quote_lots(params.max_quote_lots, leverage)?;
    let oo_owner = oo_account_state.owner;
    let market_index = market_state.market_index;
    let is_trigger_authority = (0..=u8::MAX).rev().any(|bump| {
        let derived = pinocchio_pubkey::derive_address(
            &[TRIGGER_AUTHORITY_SEED, oo_owner.as_ref()],
            Some(bump),
            &crate::TRIGGER_PROGRAM_ID,
        );
        &derived == signer.address().as_array()
    });

    let order = Order {
        side,
        max_base_lots: params.max_base_lots,
        max_quote_lots: params.max_quote_lots,
        client_order_id: params.client_order_id,
        leverage,
        reserved_margin,
        time_in_force: 0,
        params: order_params,
    };

    drop(oo_account_data);

    if !is_trigger_authority {
        order_margin_cpi(
            risk_program,
            signer,
            user_account,
            market_config,
            open_orders_account,
            oo_owner,
            order.max_quote_lots,
            0,
            market_index,
            leverage,
            0,
            true,
        )?;
    }

    let mut bids_data = bids.try_borrow_mut()?;
    let mut bids_state = bytemuck::from_bytes_mut::<BookSide>(&mut bids_data[..BookSide::LEN]);

    let mut asks_data = asks.try_borrow_mut()?;
    let mut asks_state = bytemuck::from_bytes_mut::<BookSide>(&mut asks_data[..BookSide::LEN]);

    let mut oo_account_data = open_orders_account.try_borrow_mut()?;
    let mut oo_account_state = bytemuck::from_bytes_mut::<OpenOrdersAccount>(
        &mut oo_account_data[..OpenOrdersAccount::LEN],
    );

    let mut order_book = Orderbook {
        bids: bids_state,
        asks: asks_state,
    };

    if is_trigger_authority {
        let cancel_side = side.invert_side();
        let mut release_margin = 0_i64;
        for oo in oo_account_state.open_orders.iter() {
            if oo.is_free() || oo.side() != cancel_side {
                continue;
            }
            release_margin = release_margin
                .checked_add(oo.releasable_margin()?)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        }
        order_book.cancel_all_orders(
            oo_account_state,
            Some(cancel_side),
            None,
            MAX_OPEN_ORDERS as u8,
        )?;

        if release_margin > 0 {
            drop(order_book);
            drop(bids_data);
            drop(asks_data);
            drop(oo_account_data);

            order_margin_cpi(
                risk_program,
                signer,
                user_account,
                market_config,
                open_orders_account,
                oo_owner,
                0,
                release_margin,
                market_index,
                leverage,
                0,
                false,
            )?;

            bids_data = bids.try_borrow_mut()?;
            bids_state = bytemuck::from_bytes_mut::<BookSide>(&mut bids_data[..BookSide::LEN]);
            asks_data = asks.try_borrow_mut()?;
            asks_state = bytemuck::from_bytes_mut::<BookSide>(&mut asks_data[..BookSide::LEN]);
            oo_account_data = open_orders_account.try_borrow_mut()?;
            oo_account_state = bytemuck::from_bytes_mut::<OpenOrdersAccount>(
                &mut oo_account_data[..OpenOrdersAccount::LEN],
            );
            order_book = Orderbook {
                bids: bids_state,
                asks: asks_state,
            };
        }
    }

    let mut result = order_book.new_order(
        &order,
        market_state,
        oo_account_state,
        now_ts as u64,
        params.limit.min(MAX_FILLS_PER_ORDER as u8),
    )?;

    if is_trigger_authority && result.fill_count == 0 {
        return Err(OrderBookError::WouldExecutePartially.into());
    }

    for i in 0..result.fill_count as usize {
        apply_maker_open_order_fill(
            &_remaining[3..],
            *market.address().as_array(),
            &mut result.fills[i],
        )?;
    }

    // verify order did not post to book
    if result.order_id.is_some() {
        return Err(OrderBookError::InvalidOrderType.into());
    }

    if result.unused_reserved_margin > 0 {
        drop(order_book);
        drop(bids_data);
        drop(asks_data);
        drop(oo_account_data);

        order_margin_cpi(
            risk_program,
            signer,
            user_account,
            market_config,
            open_orders_account,
            oo_owner,
            0,
            result.unused_reserved_margin,
            market_index,
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
                market_index,
                padding: [0; 2],
                taker_pubkey: oo_owner,
                maker_pubkey: fill.maker_pubkey,
            };
        }

        log.fill_count = result.fill_count;
        log.all_settled = 0; // pending settlement
    }
    Ok(())
}
