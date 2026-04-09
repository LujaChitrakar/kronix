use pinocchio::error::ProgramError;

#[derive(Debug)]
#[repr(u32)]
pub enum TriggerProgramError {
    InvalidSize = 0,
    InvalidTriggerPrice = 1,
    InvalidTriggerType = 2,
    InvalidOwner = 3,
    TriggerNotActive = 4,
    TriggerExpired = 5,
    TriggerConditionNotMet = 6,
}

impl From<TriggerProgramError> for ProgramError {
    fn from(error: TriggerProgramError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
