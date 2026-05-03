use pinocchio::{
    default_panic_handler, error::ProgramError, no_allocator, program_entrypoint, AccountView,
    Address, ProgramResult,
};

use crate::instructions::{
    process_close_strategy, process_create_strategy, process_edit_strategy,
    process_execute_strategy, process_pause_strategy, process_resume_strategy,
    StrategyProgramInstruction,
};

program_entrypoint!(process_instruction);
no_allocator!();
default_panic_handler!();

pub fn process_instruction(
    _program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (disc, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match StrategyProgramInstruction::try_from(disc)? {
        StrategyProgramInstruction::CreateStrategy => {
            process_create_strategy(accounts, data)?;
        }
        StrategyProgramInstruction::EditStrategy => process_edit_strategy(accounts, data)?,
        StrategyProgramInstruction::ExecuteStrategy => process_execute_strategy(accounts, data)?,
        StrategyProgramInstruction::PauseStrategy => process_pause_strategy(accounts, data)?,
        StrategyProgramInstruction::ResumeStrategy => process_resume_strategy(accounts, data)?,
        StrategyProgramInstruction::CloseStrategy => process_close_strategy(accounts, data)?,
    }
    Ok(())
}
