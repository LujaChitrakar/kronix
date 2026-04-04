pub mod add_margin;
pub mod close_position;
pub mod cover_bad_debt;
pub mod create_market;
pub mod deposit;
pub mod initialize_insurance_fund;
pub mod initialize_vault;
pub mod liquidate;
pub mod open_position;
pub mod remove_margin;
pub mod settle_fill;
pub mod settle_funding;
pub mod update_funding_rate;
pub mod withdraw;

pub use add_margin::*;
pub use close_position::*;
pub use cover_bad_debt::*;
pub use create_market::*;
pub use deposit::*;
pub use initialize_insurance_fund::*;
pub use initialize_vault::*;
pub use liquidate::*;
pub use open_position::*;
use pinocchio::error::ProgramError;
pub use remove_margin::*;
pub use settle_fill::*;
pub use settle_funding::*;
pub use update_funding_rate::*;
pub use withdraw::*;

#[repr(u8)]
pub enum RiskProgramInstruction {
    CreateMarket = 0,
    Deposit = 1,
    Withdraw = 2,
    OpenPosition = 3,
    ClosePosition = 4,
    AddMargin = 5,
    RemoveMargin = 6,
    InitializeInsuranceFund = 7,
    SettleFill = 8,
    SettleFunding = 9,
    UpdateFundingRate = 10,
    Liquidate = 11,
    CoverBadDebt = 12,
}

impl TryFrom<&u8> for RiskProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(RiskProgramInstruction::CreateMarket),
            1 => Ok(RiskProgramInstruction::Deposit),
            2 => Ok(RiskProgramInstruction::Withdraw),
            3 => Ok(RiskProgramInstruction::OpenPosition),
            4 => Ok(RiskProgramInstruction::ClosePosition),
            5 => Ok(RiskProgramInstruction::AddMargin),
            6 => Ok(RiskProgramInstruction::RemoveMargin),
            7 => Ok(RiskProgramInstruction::InitializeInsuranceFund),
            8 => Ok(RiskProgramInstruction::SettleFill),
            9 => Ok(RiskProgramInstruction::SettleFunding),
            10 => Ok(RiskProgramInstruction::UpdateFundingRate),
            11 => Ok(RiskProgramInstruction::Liquidate),
            12 => Ok(RiskProgramInstruction::CoverBadDebt),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
