pub mod cancel_trigger_order;
pub mod execute_trigger;
pub mod place_trigger_order;
pub mod prune_expired_triggers;

pub use cancel_trigger_order::*;
pub use execute_trigger::*;
use pinocchio::error::ProgramError;
pub use place_trigger_order::*;
pub use prune_expired_triggers::*;

#[repr(u8)]
pub enum TriggerProgramInstruction {
    PlaceTriggerOrder = 0,
    CancelTriggerOrder = 1,
    // EditTrigger = 2,
    ExecuteTrigger = 3,
    PruneTrigger = 4,
}

impl TryFrom<&u8> for TriggerProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(TriggerProgramInstruction::PlaceTriggerOrder),
            1 => Ok(TriggerProgramInstruction::CancelTriggerOrder),
            // 2 => Ok(TriggerProgramInstruction::EditTrigger),
            3 => Ok(TriggerProgramInstruction::ExecuteTrigger),
            4 => Ok(TriggerProgramInstruction::PruneTrigger),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
