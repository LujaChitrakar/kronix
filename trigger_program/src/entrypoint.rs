use pinocchio::{
    default_panic_handler, error::ProgramError, no_allocator, program_entrypoint, AccountView,
    Address, ProgramResult,
};

use crate::instructions::{
    process_cancel_trigger_order, process_edit_trigger, process_execute_trigger,
    process_pause_trigger, process_place_trigger_order, process_prune_expired_triggers,
    process_resume_trigger, TriggerProgramInstruction,
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
    match TriggerProgramInstruction::try_from(disc)? {
        TriggerProgramInstruction::PlaceTriggerOrder => {
            process_place_trigger_order(accounts, data)?
        }
        TriggerProgramInstruction::EditTrigger => process_edit_trigger(accounts, data)?,
        TriggerProgramInstruction::CancelTriggerOrder => {
            process_cancel_trigger_order(accounts, data)?
        }
        TriggerProgramInstruction::ExecuteTrigger => process_execute_trigger(accounts, data)?,
        TriggerProgramInstruction::PruneExpiredTrigger => {
            process_prune_expired_triggers(accounts, data)?
        }
        TriggerProgramInstruction::PauseTrigger => process_pause_trigger(accounts, data)?,
        TriggerProgramInstruction::ResumeTrigger => process_resume_trigger(accounts, data)?,
    }
    Ok(())
}
