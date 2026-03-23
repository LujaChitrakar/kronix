#![allow(unexpected_cfgs)]

use crate::{ID, instructions::OrderbookInstruction};
use pinocchio::{
    AccountView, Address, ProgramResult, default_panic_handler, error::ProgramError, no_allocator,
    program_entrypoint,
};

program_entrypoint!(process_instruction);
no_allocator!();
default_panic_handler!();

#[inline(always)]
fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    assert_eq!(program_id, &ID);

    let (disc, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    // match OrderbookInstruction::try_from(disc)?{
    //     OrderbookInstruction::CreateMarket => {
    //         // instructions::create_market();
    //     }
    // }
    Ok(())
}
