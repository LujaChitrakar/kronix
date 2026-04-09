pub mod add_margin;
pub mod close_position;
pub mod cover_bad_debt;
pub mod create_risk_market;
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
pub use create_risk_market::*;
pub use deposit::*;
pub use initialize_insurance_fund::*;
pub use initialize_vault::*;
pub use liquidate::*;
pub use open_position::*;
use pinocchio::error::ProgramError;
pub use remove_margin::*;
pub use settle_fill::*;
pub use settle_funding::*;
use shank::ShankInstruction;
pub use update_funding_rate::*;
pub use withdraw::*;

#[derive(ShankInstruction)]
pub enum RiskInstruction {
    #[account(0, name = "payer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "market_config", desc = "MarketConfig PDA", writable)]
    #[account(2, name = "funding_state", desc = "FundingState PDA", writable)]
    #[account(3, name = "system_program", desc = "System program")]
    CreateRiskMarket(CreateRiskMarketParams),

    #[account(0, name = "payer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "insurance_fund", desc = "InsuranceFund PDA", writable)]
    #[account(2, name = "system_program", desc = "System program")]
    InitializeInsuranceFund(InitInsuranceFundParams),

    #[account(0, name = "payer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "vault", desc = "Vault token account", writable)]
    #[account(2, name = "vault_authority", desc = "Vault authority PDA")]
    #[account(3, name = "mint", desc = "USDC mint")]
    #[account(4, name = "token_program", desc = "Token program")]
    #[account(5, name = "system_program", desc = "System program")]
    InitializeVault(InitializeVaultParams),

    #[account(0, name = "signer", desc = "Depositor", signer, writable)]
    #[account(1, name = "user_account", desc = "UserAccount PDA", writable)]
    #[account(2, name = "user_token_account", desc = "User USDC ATA", writable)]
    #[account(3, name = "vault", desc = "Program vault", writable)]
    #[account(4, name = "token_program", desc = "Token program")]
    #[account(5, name = "system_program", desc = "System program")]
    Deposit(DepositParams),

    #[account(0, name = "signer", desc = "Withdrawer", signer)]
    #[account(1, name = "user_account", desc = "UserAccount PDA", writable)]
    #[account(2, name = "user_token_account", desc = "User USDC ATA", writable)]
    #[account(3, name = "vault", desc = "Program vault", writable)]
    #[account(4, name = "vault_authority", desc = "Vault authority PDA")]
    #[account(5, name = "token_program", desc = "Token program")]
    Withdraw(WithdrawParams),

    #[account(0, name = "signer", desc = "Trader", signer, writable)]
    #[account(1, name = "user_account", desc = "UserAccount PDA", writable)]
    #[account(2, name = "position", desc = "Position PDA", writable)]
    #[account(3, name = "market_config", desc = "MarketConfig")]
    #[account(4, name = "funding_state", desc = "FundingState", writable)]
    #[account(5, name = "oracle", desc = "Pyth oracle")]
    #[account(6, name = "system_program", desc = "System program")]
    OpenPosition(OpenPositionParams),

    #[account(0, name = "signer", desc = "Trader", signer)]
    #[account(1, name = "user_account", desc = "UserAccount PDA", writable)]
    #[account(2, name = "position", desc = "Position PDA", writable)]
    #[account(3, name = "market_config", desc = "MarketConfig")]
    #[account(4, name = "funding_state", desc = "FundingState", writable)]
    #[account(5, name = "oracle", desc = "Pyth oracle")]
    ClosePosition(ClosePositionParams),

    #[account(0, name = "signer", desc = "Trader", signer)]
    #[account(1, name = "user_account", desc = "UserAccount PDA", writable)]
    #[account(2, name = "position", desc = "Position PDA", writable)]
    #[account(3, name = "market_config", desc = "MarketConfig")]
    AddMargin(AddMarginParams),

    #[account(0, name = "signer", desc = "Trader", signer)]
    #[account(1, name = "user_account", desc = "UserAccount PDA", writable)]
    #[account(2, name = "position", desc = "Position PDA", writable)]
    #[account(3, name = "market_config", desc = "MarketConfig")]
    #[account(4, name = "oracle", desc = "Pyth oracle")]
    RemoveMargin(RemoveMarginParams),

    #[account(0, name = "orderbook_program", desc = "Orderbook program", signer)]
    #[account(1, name = "user_account", desc = "UserAccount PDA", writable)]
    #[account(2, name = "position", desc = "Position PDA", writable)]
    #[account(3, name = "market_config", desc = "MarketConfig")]
    #[account(4, name = "funding_state", desc = "FundingState", writable)]
    #[account(5, name = "system_program", desc = "System program")]
    SettleFill(SettleFillParams),

    #[account(0, name = "signer", desc = "Trader", signer)]
    #[account(1, name = "user_account", desc = "UserAccount PDA", writable)]
    #[account(2, name = "position", desc = "Position PDA", writable)]
    #[account(3, name = "market_config", desc = "MarketConfig")]
    #[account(4, name = "funding_state", desc = "FundingState", writable)]
    SettleFunding,

    #[account(0, name = "cranker", desc = "Permissionless crank", signer)]
    #[account(1, name = "market_config", desc = "MarketConfig")]
    #[account(2, name = "funding_state", desc = "FundingState", writable)]
    #[account(3, name = "oracle", desc = "Pyth oracle")]
    UpdateFundingRate(UpdateFundingRateParams),

    #[account(0, name = "liquidator", desc = "Liquidator bot", signer)]
    #[account(1, name = "user_account", desc = "Underwater account", writable)]
    #[account(2, name = "position", desc = "Underwater position", writable)]
    #[account(3, name = "market_config", desc = "MarketConfig")]
    #[account(4, name = "funding_state", desc = "FundingState", writable)]
    #[account(5, name = "insurance_fund", desc = "InsuranceFund", writable)]
    #[account(6, name = "vault", desc = "Program vault", writable)]
    #[account(7, name = "vault_authority", desc = "Vault authority PDA")]
    #[account(
        8,
        name = "liquidator_token_account",
        desc = "Liquidator USDC ATA",
        writable
    )]
    #[account(9, name = "oracle", desc = "Pyth oracle")]
    #[account(10, name = "token_program", desc = "Token program")]
    Liquidate(LiquidateParams),

    #[account(0, name = "caller", desc = "Anyone", signer)]
    #[account(1, name = "user_account", desc = "Bad debt account", writable)]
    #[account(2, name = "position", desc = "Bad debt position", writable)]
    #[account(3, name = "market_config", desc = "MarketConfig")]
    #[account(4, name = "funding_state", desc = "FundingState", writable)]
    #[account(5, name = "insurance_fund", desc = "InsuranceFund", writable)]
    #[account(6, name = "oracle", desc = "Pyth oracle")]
    CoverBadDebt(CoverBadDebtParams),
}

#[repr(u8)]
pub enum RiskProgramInstruction {
    CreateRiskMarket = 0,
    InitializeInsuranceFund = 1,
    InitializeVault = 2,
    Deposit = 3,
    Withdraw = 4,
    OpenPosition = 5,
    ClosePosition = 6,
    AddMargin = 7,
    RemoveMargin = 8,
    SettleFill = 9,
    SettleFunding = 10,
    UpdateFundingRate = 11,
    Liquidate = 12,
    CoverBadDebt = 13,
}

impl TryFrom<&u8> for RiskProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(RiskProgramInstruction::CreateRiskMarket),
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
