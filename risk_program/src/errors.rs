use pinocchio::error::ProgramError;

#[derive(Debug)]
#[repr(u32)]
pub enum RiskProgramError {
    InvalidAmount = 1,
    ExceedsMaxLeverage = 2,
    InvalidOracle = 3,
    StalePriceFeed = 4,
    OracleConfidenceTooWide = 5,
    InvalidOraclePrice = 6,
}

impl From<RiskProgramError> for ProgramError {
    fn from(error: RiskProgramError) -> Self {
        ProgramError::Custom(error as u32)
    }
}