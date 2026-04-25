#![allow(unexpected_cfgs)]

use crate::instructions::{
    process_cancel_all_orders, process_cancel_order, process_cancel_order_by_client_id,
    process_claim_fill, process_create_open_orders_account, process_create_orderbook_market,
    process_edit_order, process_initialize_fills_logs, process_place_order,
    process_place_take_order, process_prune_orders, process_set_delegate, process_settle_fills,
    OrderbookProgramInstruction,
};
use pinocchio::{
    default_panic_handler, error::ProgramError, no_allocator, program_entrypoint, AccountView,
    Address, ProgramResult,
};
use pinocchio_log::log;

program_entrypoint!(process_instruction);
no_allocator!();
default_panic_handler!();

#[inline(always)]
fn process_instruction(
    _program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    log!(
        "disc byte: {}",
        instruction_data.first().copied().unwrap_or(255)
    );
    let (disc, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match OrderbookProgramInstruction::try_from(disc)? {
        OrderbookProgramInstruction::CreateOrderbookMarket => {
            process_create_orderbook_market(accounts, data)?
        }
        OrderbookProgramInstruction::CreateOpenOrdersAccount => {
            process_create_open_orders_account(accounts, data)?
        }
        OrderbookProgramInstruction::InitializeFillsLogs => {
            process_initialize_fills_logs(accounts, data)?
        }
        OrderbookProgramInstruction::PlaceOrder => process_place_order(accounts, data)?,
        OrderbookProgramInstruction::PlaceTakeOrder => process_place_take_order(accounts, data)?,
        OrderbookProgramInstruction::SettleFills => process_settle_fills(accounts, data)?,
        OrderbookProgramInstruction::CancelOrder => process_cancel_order(accounts, data)?,
        OrderbookProgramInstruction::CancelOrderByClientId => {
            process_cancel_order_by_client_id(accounts, data)?
        }
        OrderbookProgramInstruction::CancelAllOrders => process_cancel_all_orders(accounts, data)?,
        OrderbookProgramInstruction::EditOrder => process_edit_order(accounts, data)?,
        // OrderbookProgramInstruction::ClaimFill => process_claim_fill(accounts, data)?,
        OrderbookProgramInstruction::PruneOrders => process_prune_orders(accounts, data)?,
        OrderbookProgramInstruction::SetDelegate => process_set_delegate(accounts, data)?,
    }
    Ok(())
}
