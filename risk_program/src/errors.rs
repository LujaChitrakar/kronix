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
    InvalidOwner = 7,
    InsufficientCollateral = 8,
    InvalidSide = 9,
    InvalidMarketIndex = 10,
    InvalidPositionSize = 11,
    PositionAlreadyOpen = 12,
    FundingNotDue = 13,
    InsufficientMaintenanceMargin = 14,
    InsuranceFundDepleted = 15,
    NotLiquidatable = 16,
    NotInBadDebt = 17,
}

impl From<RiskProgramError> for ProgramError {
    fn from(error: RiskProgramError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
