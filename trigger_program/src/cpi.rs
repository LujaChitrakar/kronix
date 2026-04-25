use orderbook_program_cpi::{self, PlaceTakeOrderParams, PLACE_TAKE_ORDER_IX};
use pinocchio::cpi::{invoke_signed, Seed, Signer};
use pinocchio::instruction::{InstructionAccount, InstructionView};
use pinocchio::{AccountView, ProgramResult};

use crate::constants::TRIGGER_AUTHORITY_SEED;

pub fn place_take_order_cpi(
    orderbook_program: &AccountView,
    system_program: &AccountView,
    trigger_authority: &AccountView,
    open_orders_account: &AccountView,
    market: &AccountView,
    bids: &AccountView,
    asks: &AccountView,
    fills_log: &AccountView,
    max_base_lots: i64,
    max_quote_lots: i64,
    client_order_id: u64,
    price_lots: i64,
    side: u8,
    order_type: u8,
    limit: u8,
    bump_fills_log: u8,
    bump_authority: u8,
    owner_pubkey: [u8; 32],
) -> ProgramResult {
    let params = PlaceTakeOrderParams {
        max_base_lots,
        max_quote_lots,
        client_order_id,
        price_lots,
        side,
        order_type,
        limit,
        bump_fills_log,
        padding: [0; 4],
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
        InstructionAccount::new(fills_log.address(), true, false),
        InstructionAccount::new(system_program.address(), false, false),
    ];

    let account_infos = [
        trigger_authority,
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
        Seed::from(TRIGGER_AUTHORITY_SEED),
        Seed::from(owner_pubkey.as_ref()),
        Seed::from(bump_bytes.as_ref()),
    ];

    invoke_signed::<7>(&ix, &account_infos, &[Signer::from(&seeds)])?;

    Ok(())
}
