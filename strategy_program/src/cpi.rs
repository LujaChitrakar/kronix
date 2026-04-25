use orderbook_program_cpi::PlaceOrderParams;
use orderbook_program_cpi::{self, PLACE_ORDER_IX};
use pinocchio::cpi::{invoke_signed, Seed, Signer};
use pinocchio::instruction::{InstructionAccount, InstructionView};
use pinocchio::{AccountView, ProgramResult};
use trigger_program_cpi::{PlaceTriggerOrderParams, PLACE_TRIGGER_IX};

use crate::constants::STRATEGY_AUTHORITY_SEED;

pub fn place_order_cpi(
    orderbook_program: &AccountView,
    system_program: &AccountView,
    strategy_authority: &AccountView,
    open_orders_account: &AccountView,
    market: &AccountView,
    bids: &AccountView,
    asks: &AccountView,
    fills_log: &AccountView,
    max_base_lots: i64,
    max_quote_lots: i64,
    client_order_id: u64,
    expiry_timestamp: u64,
    price_lots: i64,
    side: u8,
    order_type: u8,
    limit: u8,
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
        padding: [0; 4],
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
    ];

    let account_infos = [
        strategy_authority,
        open_orders_account,
        market,
        bids,
        asks,
        fills_log,
        system_program,
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

    invoke_signed::<7>(&ix, &account_infos, &[Signer::from(&seeds)])?;

    Ok(())
}

pub fn place_trigger_order_cpi(
    strategy_authority: &AccountView,
    trigger_program: &AccountView,
    system_program: &AccountView,
    trigger_order: &AccountView,
    open_orders_account: &AccountView,
    client_order_id: u64,
    trigger_price: i64,
    size_lots: i64,
    expiry: i64, // unix ts, 0 = never
    market_index: u16,
    trigger_type: u8, // 0=StopLoss, 1=TakeProfit
    side: u8,         // 0=Buy, 1=Sell
    trigger_bump: u8,
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
        padding: [0; 3],
    };

    let params_bytes = bytemuck::bytes_of(&params);

    let mut ix_data = [0u8; 1 + core::mem::size_of::<PlaceTriggerOrderParams>()];
    ix_data[0] = PLACE_TRIGGER_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(strategy_authority.address(), true, true),
        InstructionAccount::new(trigger_order.address(), true, false),
        InstructionAccount::new(open_orders_account.address(), true, false),
        InstructionAccount::new(system_program.address(), false, false),
    ];

    let account_infos = [
        strategy_authority,
        trigger_order,
        open_orders_account,
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

    invoke_signed::<4>(&ix, &account_infos, &[Signer::from(&seeds)])?;

    Ok(())
}
