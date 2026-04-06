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
    InitializeInsuranceFund = 1,
    InitializeVault = 2,
    Deposit = 3,
    Withdraw = 4,
    OpenPosition = 5,
    ClosePosition = 6,
    AddMargin = 7,
    RemoveMargin = 8,
    SettleFill = 9, //LEFT
    SettleFunding = 10,
    UpdateFundingRate = 11, //LEFT
    Liquidate = 12,
    CoverBadDebt = 13,
}

impl TryFrom<&u8> for RiskProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(RiskProgramInstruction::CreateMarket),
            1 => Ok(RiskProgramInstruction::InitializeInsuranceFund),
            2 => Ok(RiskProgramInstruction::InitializeVault),
            3 => Ok(RiskProgramInstruction::Deposit),
            4 => Ok(RiskProgramInstruction::Withdraw),
            5 => Ok(RiskProgramInstruction::OpenPosition),
            6 => Ok(RiskProgramInstruction::ClosePosition),
            7 => Ok(RiskProgramInstruction::AddMargin),
            8 => Ok(RiskProgramInstruction::RemoveMargin),
            9 => Ok(RiskProgramInstruction::SettleFill),
            10 => Ok(RiskProgramInstruction::SettleFunding),
            11 => Ok(RiskProgramInstruction::UpdateFundingRate),
            12 => Ok(RiskProgramInstruction::Liquidate),
            13 => Ok(RiskProgramInstruction::CoverBadDebt),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
