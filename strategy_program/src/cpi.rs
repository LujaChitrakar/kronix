use orderbook_program_cpi::{
    self, CreateOpenOrdersAccountParams, InitializeFillsLogParams, PlaceOrderParams,
    SetDelegateParams, CREATE_OPEN_ORDERS_ACCOUNT_IX, INITIALIZE_FILLS_LOG_IX, PLACE_ORDER_IX,
    SET_DELEGATE_IX,
};
use pinocchio::cpi::{invoke, invoke_signed, Seed, Signer};
use pinocchio::instruction::{InstructionAccount, InstructionView};
use pinocchio::{AccountView, ProgramResult};
use trigger_program_cpi::{PlaceTriggerOrderParams, PLACE_TRIGGER_IX};

use crate::constants::STRATEGY_AUTHORITY_SEED;

pub fn create_open_orders_account_cpi(
    orderbook_program: &AccountView,
    system_program: &AccountView,
    fee_payer: &AccountView,
    strategy_authority: &AccountView,
    open_orders_account: &AccountView,
    market: &AccountView,
    bump: u8,
) -> ProgramResult {
    let params = CreateOpenOrdersAccountParams {
        owner: *strategy_authority.address().as_array(),
        bump,
        padding: [0; 7],
    };
    let params_bytes = bytemuck::bytes_of(&params);
    let mut ix_data = [0u8; 1 + core::mem::size_of::<CreateOpenOrdersAccountParams>()];
    ix_data[0] = CREATE_OPEN_ORDERS_ACCOUNT_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(fee_payer.address(), true, true),
        InstructionAccount::new(open_orders_account.address(), true, false),
        InstructionAccount::new(market.address(), false, false),
        InstructionAccount::new(system_program.address(), false, false),
    ];

    let account_infos = [fee_payer, open_orders_account, market, system_program];

    let ix = InstructionView {
        program_id: orderbook_program.address(),
        accounts: &account_metas,
        data: &ix_data,
    };

    invoke::<4>(&ix, &account_infos)?;
    Ok(())
}

pub fn initialize_fills_log_cpi(
    orderbook_program: &AccountView,
    system_program: &AccountView,
    fee_payer: &AccountView,
    strategy_authority: &AccountView,
    fills_log: &AccountView,
    market: &AccountView,
    client_order_id: u64,
    bump_fills_log: u8,
) -> ProgramResult {
    let params = InitializeFillsLogParams {
        bump: bump_fills_log,
        padding: [0; 7],
        client_order_id,
    };
    let params_bytes = bytemuck::bytes_of(&params);
    let mut ix_data = [0u8; 1 + core::mem::size_of::<InitializeFillsLogParams>()];
    ix_data[0] = INITIALIZE_FILLS_LOG_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(fee_payer.address(), true, true),
        InstructionAccount::new(strategy_authority.address(), false, false),
        InstructionAccount::new(fills_log.address(), true, false),
        InstructionAccount::new(market.address(), false, false),
        InstructionAccount::new(system_program.address(), false, false),
    ];

    let account_infos = [
        fee_payer,
        strategy_authority,
        fills_log,
        market,
        system_program,
    ];

    let ix = InstructionView {
        program_id: orderbook_program.address(),
        accounts: &account_metas,
        data: &ix_data,
    };

    invoke::<5>(&ix, &account_infos)?;
    Ok(())
}

pub fn set_delegate_cpi(
    orderbook_program: &AccountView,
    signer: &AccountView,
    open_orders_account: &AccountView,
    delegate: [u8; 32],
) -> ProgramResult {
    let params = SetDelegateParams { delegate };
    let params_bytes = bytemuck::bytes_of(&params);
    let mut ix_data = [0u8; 1 + core::mem::size_of::<SetDelegateParams>()];
    ix_data[0] = SET_DELEGATE_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(signer.address(), false, true),
        InstructionAccount::new(open_orders_account.address(), true, false),
    ];

    let account_infos = [signer, open_orders_account];

    let ix = InstructionView {
        program_id: orderbook_program.address(),
        accounts: &account_metas,
        data: &ix_data,
    };

    invoke::<2>(&ix, &account_infos)?;
    Ok(())
}

pub fn place_order_cpi(
    orderbook_program: &AccountView,
    system_program: &AccountView,
    strategy_authority: &AccountView,
    open_orders_account: &AccountView,
    market: &AccountView,
    bids: &AccountView,
    asks: &AccountView,
    fills_log: &AccountView,
    user_account: &AccountView,
    market_config: &AccountView,
    risk_program: &AccountView,
    max_base_lots: i64,
    max_quote_lots: i64,
    client_order_id: u64,
    expiry_timestamp: u64,
    price_lots: i64,
    side: u8,
    order_type: u8,
    limit: u8,
    leverage: u8,
    bump_fills_log: u8,
    bump_authority: u8,
    owner_pubkey: [u8; 32],
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
        bump_fills_log,
        leverage,
        padding: [0; 3],
    };

    let params_bytes = bytemuck::bytes_of(&params);

    let mut ix_data = [0u8; 1 + core::mem::size_of::<PlaceOrderParams>()];
    ix_data[0] = PLACE_ORDER_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(strategy_authority.address(), true, true),
        InstructionAccount::new(open_orders_account.address(), true, false),
        InstructionAccount::new(market.address(), true, false),
        InstructionAccount::new(bids.address(), true, false),
        InstructionAccount::new(asks.address(), true, false),
        InstructionAccount::new(fills_log.address(), true, false),
        InstructionAccount::new(system_program.address(), false, false),
        InstructionAccount::new(user_account.address(), true, false),
        InstructionAccount::new(market_config.address(), false, false),
        InstructionAccount::new(risk_program.address(), false, false),
    ];

    let account_infos = [
        strategy_authority,
        open_orders_account,
        market,
        bids,
        asks,
        fills_log,
        system_program,
        user_account,
        market_config,
        risk_program,
    ];

    let ix = InstructionView {
        program_id: orderbook_program.address(),
        accounts: &account_metas,
        data: &ix_data,
    };
    let bump_bytes = [bump_authority];
    let seeds = [
        Seed::from(STRATEGY_AUTHORITY_SEED),
        Seed::from(owner_pubkey.as_ref()),
        Seed::from(bump_bytes.as_ref()),
    ];

    invoke_signed::<10>(&ix, &account_infos, &[Signer::from(&seeds)])?;

    Ok(())
}

pub fn place_trigger_order_cpi(
    strategy_authority: &AccountView,
    trigger_program: &AccountView,
    system_program: &AccountView,
    trigger_order: &AccountView,
    open_orders_account: &AccountView,
    trigger_authority: &AccountView,
    trigger_fills_log: &AccountView,
    market: &AccountView,
    orderbook_program: &AccountView,
    client_order_id: u64,
    trigger_price: i64,
    size_lots: i64,
    expiry: i64, // unix ts, 0 = never
    market_index: u16,
    trigger_type: u8, // 0=StopLoss, 1=TakeProfit
    side: u8,         // 0=Buy, 1=Sell
    trigger_bump: u8,
    bump_trigger_authority: u8,
    bump_fills_log: u8,
    bump_authority: u8,
    owner_pubkey: [u8; 32],
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
        bump_authority: bump_trigger_authority,
        bump_fills_log,
        padding: [0; 1],
    };

    let params_bytes = bytemuck::bytes_of(&params);

    let mut ix_data = [0u8; 1 + core::mem::size_of::<PlaceTriggerOrderParams>()];
    ix_data[0] = PLACE_TRIGGER_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(strategy_authority.address(), true, true),
        InstructionAccount::new(trigger_order.address(), true, false),
        InstructionAccount::new(open_orders_account.address(), true, false),
        InstructionAccount::new(trigger_authority.address(), false, false),
        InstructionAccount::new(trigger_fills_log.address(), true, false),
        InstructionAccount::new(market.address(), false, false),
        InstructionAccount::new(orderbook_program.address(), false, false),
        InstructionAccount::new(system_program.address(), false, false),
    ];

    let account_infos = [
        strategy_authority,
        trigger_order,
        open_orders_account,
        trigger_authority,
        trigger_fills_log,
        market,
        orderbook_program,
        system_program,
    ];

    let ix = InstructionView {
        program_id: trigger_program.address(),
        accounts: &account_metas,
        data: &ix_data,
    };

    let bump_bytes = [bump_authority];
    let seeds = [
        Seed::from(STRATEGY_AUTHORITY_SEED),
        Seed::from(owner_pubkey.as_ref()),
        Seed::from(bump_bytes.as_ref()),
    ];

    invoke_signed::<8>(&ix, &account_infos, &[Signer::from(&seeds)])?;

    Ok(())
}
