use orderbook_program_cpi::PlaceTakeOrderParams;
use orderbook_program_cpi::{self, PLACE_TAKE_ORDER_IX};
use pinocchio::cpi::{invoke_signed, Seed, Signer};
use pinocchio::instruction::{InstructionAccount, InstructionView};
use pinocchio::{AccountView, ProgramResult};

use crate::constants::TRIGGER_AUTHORITY_SEED;

pub fn place_take_order_cpi(
    trigger_authority: &AccountView,
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
    price_lots: i64,
    side: u8,
    order_type: u8,
    limit: u8,
    bump_position: u8,
    bump_user: u8,
    bump_authority: u8,
) -> ProgramResult {
    let params = PlaceTakeOrderParams {
        max_base_lots,
        max_quote_lots,
        client_order_id,
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
    ix_data[0] = PLACE_TAKE_ORDER_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(trigger_authority.address(), true, true),
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
        trigger_authority,
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

    let bump_bytes = [bump_authority];
    let seeds = [
        Seed::from(TRIGGER_AUTHORITY_SEED),
        Seed::from(bump_bytes.as_ref()),
    ];

    invoke_signed::<12>(&ix, &account_infos, &[Signer::from(&seeds)])?;

    Ok(())
}
