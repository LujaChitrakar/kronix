use pinocchio::error::ProgramError;

#[derive(Debug)]
#[repr(u32)]
pub enum StrategyProgramError {
    InvalidSize = 0,
    InvalidTriggerPrice = 1,
    InvalidTriggerType = 2,
    InvalidOwner = 3,
    TriggerNotActive = 4,
    TriggerExpired = 5,
    TriggerConditionNotMet = 6,
    InvalidStrategyType = 7,
    StrategyNotActive = 8,
    CooldownNotElapsed = 9,
    DailyCapReached = 10,
    InvalidSignal = 11,
}

impl From<StrategyProgramError> for ProgramError {
    fn from(error: StrategyProgramError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
