use orderbook_program_cpi::{self, PLACE_ORDER_IX, PLACE_TAKE_ORDER_IX};
use orderbook_program_cpi::{PlaceOrderParams, PlaceTakeOrderParams};
use pinocchio::cpi::invoke;
use pinocchio::instruction::{InstructionAccount, InstructionView};
use pinocchio::{AccountView, ProgramResult};
use trigger_program_cpi::{PLACE_TRIGGER_IX, PlaceTriggerOrderParams};

pub fn place_order_cpi(
    strategy_owner: &AccountView,
    open_orders_account: &AccountView,
    market: &AccountView,
    bids: &AccountView,
    asks: &AccountView,
    orderbook_program: &AccountView,
    risk_program: &AccountView,
    taker_user_account: &AccountView,
    taker_position: &AccountView,
    market_config: &AccountView,
    funding_state: &AccountView,
    system_program: &AccountView,
    max_base_lots: i64,
    max_quote_lots: i64,
    client_order_id: u64,
    expiry_timestamp: u64,
    price_lots: i64,
    side: u8,
    order_type: u8,
    limit: u8,
    bump_position: u8,
    bump_user: u8,
) -> ProgramResult {
    let params = PlaceOrderParams {
        max_base_lots,
        max_quote_lots,
        client_order_id,
        expiry_timestamp,
        price_lots,
        side,
        order_type,
        limit,
        bump_position,
        bump_user,
        padding: [0; 3],
    };

    let params_bytes = bytemuck::bytes_of(&params);

    let mut ix_data = [0u8; 1 + core::mem::size_of::<PlaceTakeOrderParams>()];
    ix_data[0] = PLACE_ORDER_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(strategy_owner.address(), true, true),
        InstructionAccount::new(open_orders_account.address(), true, false),
        InstructionAccount::new(market.address(), true, false),
        InstructionAccount::new(bids.address(), true, false),
        InstructionAccount::new(asks.address(), true, false),
        InstructionAccount::new(orderbook_program.address(), false, false),
        InstructionAccount::new(risk_program.address(), false, false),
        InstructionAccount::new(taker_user_account.address(), true, false),
        InstructionAccount::new(taker_position.address(), true, false),
        InstructionAccount::new(market_config.address(), false, false),
        InstructionAccount::new(funding_state.address(), true, false),
        InstructionAccount::new(system_program.address(), false, false),
    ];

    let account_infos = [
        strategy_owner,
        open_orders_account,
        market,
        bids,
        asks,
        orderbook_program,
        risk_program,
        taker_user_account,
        taker_position,
        market_config,
        funding_state,
        system_program,
    ];

    let ix = InstructionView {
        program_id: orderbook_program.address(),
        accounts: &account_metas,
        data: &ix_data,
    };

    invoke::<12>(&ix, &account_infos)?;

    Ok(())
}

pub fn place_trigger_order_cpi(
    strategy_owner: &AccountView,
    trigger_program: &AccountView,
    trigger_order: &AccountView,
    system_program: &AccountView,
    client_order_id: u64,
    trigger_price: i64,
    size_lots: i64,
    expiry: i64, // unix ts, 0 = never
    market_index: u16,
    trigger_type: u8, // 0=StopLoss, 1=TakeProfit
    side: u8,         // 0=Buy, 1=Sell
    trigger_bump: u8,
) -> ProgramResult {
    let params = PlaceTriggerOrderParams {
        client_order_id,
        trigger_price,
        size_lots,
        expiry,
        market_index,
        trigger_type,
        side,
        bump: trigger_bump,
        padding: [0; 3],
    };

    let params_bytes = bytemuck::bytes_of(&params);

    let mut ix_data = [0u8; 1 + core::mem::size_of::<PlaceTakeOrderParams>()];
    ix_data[0] = PLACE_TRIGGER_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(strategy_owner.address(), true, true),
        InstructionAccount::new(trigger_order.address(), true, false),
        InstructionAccount::new(system_program.address(), false, false),
    ];

    let account_infos = [strategy_owner, trigger_order, system_program];

    let ix = InstructionView {
        program_id: trigger_program.address(),
        accounts: &account_metas,
        data: &ix_data,
    };

    invoke::<3>(&ix, &account_infos)?;

    Ok(())
}
