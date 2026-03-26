#![allow(unexpected_cfgs)]

use crate::instructions::{
    OrderbookInstruction, process_cancel_all_orders, process_cancel_order, process_cancel_order_by_client_id, process_claim_fill, process_create_market, process_create_open_orders_account, process_edit_order, process_place_order, process_place_take_order, process_prune_orders
};
use pinocchio::{
    AccountView, Address, ProgramResult, default_panic_handler, error::ProgramError, no_allocator,
    program_entrypoint,
};

program_entrypoint!(process_instruction);
no_allocator!();
default_panic_handler!();

#[inline(always)]
fn process_instruction(
    _program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (disc, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match OrderbookInstruction::try_from(disc)? {
        OrderbookInstruction::CreateMarket => process_create_market(accounts, data)?,
        OrderbookInstruction::CreateOpenOrdersAccount => {
            process_create_open_orders_account(accounts, data)?
        }
        OrderbookInstruction::PlaceOrder => process_place_order(accounts, data)?,
        OrderbookInstruction::PlaceTakeOrder => process_place_take_order(accounts, data)?,
        OrderbookInstruction::CancelOrder => process_cancel_order(accounts, data)?,
        OrderbookInstruction::CancelOrderByClientId => {
            process_cancel_order_by_client_id(accounts, data)?
        }
        OrderbookInstruction::CancelAllOrders => process_cancel_all_orders(accounts, data)?,
        OrderbookInstruction::EditOrder => process_edit_order(accounts, data)?,
        OrderbookInstruction::ClaimFill => process_claim_fill(accounts, data)?,
        OrderbookInstruction::PruneOrders => process_prune_orders(accounts, data)?,
    }
    Ok(())
}
