pub mod close_strategy;
pub mod create_strategy;
pub mod edit_strategy;
pub mod execute_strategy;
pub mod pause_strategy;
pub mod resume_strategy;

pub use close_strategy::*;
pub use create_strategy::*;
pub use edit_strategy::*;
pub use execute_strategy::*;
pub use pause_strategy::*;
use pinocchio::error::ProgramError;
pub use resume_strategy::*;
use shank::ShankInstruction;

#[derive(ShankInstruction)]
pub enum StrategyInstruction {
    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "strategy_account", desc = "Strategy account PDA", writable)]
    #[account(2, name = "system_program", desc = "System program")]
    CreateStrategy(CreateStrategyParams),

    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "strategy_account", desc = "Strategy account PDA", writable)]
    EditStrategy(EditStrategyParams),

    #[account(0, name = "keeper", desc = "Fee payer", signer, writable)]
    #[account(
        1,
        name = "strategy_authority",
        desc = "Strategy authority PDA",
        writable
    )]
    #[account(2, name = "strategy_owner", desc = "Strategy owner", signer, writable)]
    #[account(3, name = "strategy_account", desc = "Strategy account PDA", writable)]
    #[account(
        4,
        name = "open_orders_account",
        desc = "Open orders account PDA",
        writable
    )]
    #[account(5, name = "market", desc = "Market PDA", writable)]
    #[account(6, name = "bids", desc = "Bids PDA", writable)]
    #[account(7, name = "asks", desc = "Asks PDA", writable)]
    #[account(8, name = "market_config", desc = "Market Config PDA", writable)]
    #[account(9, name = "funding_state", desc = "Funding State PDA", writable)]
    #[account(10, name = "user_account", desc = "User Account PDA", writable)]
    #[account(11, name = "position", desc = "Position PDA", writable)]
    #[account(12, name = "risk_program", desc = "Risk Program")]
    #[account(13, name = "orderbook_program", desc = "Orderbook Program")]
    #[account(14, name = "system_program", desc = "System program")]
    ExecuteStrategy(ExecuteStrategyParams),

    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "strategy_account", desc = "Strategy account PDA", writable)]
    PauseStrategy,

    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "strategy_account", desc = "Strategy account PDA", writable)]
    ResumeStrategy,

    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "strategy_account", desc = "Strategy account PDA", writable)]
    CloseStrategy,
}

#[repr(u8)]
pub enum StrategyProgramInstruction {
    CreateStrategy = 0,
    EditStrategy = 1,
    ExecuteStrategy = 2,
    PauseStrategy = 3,
    ResumeStrategy = 4,
    CloseStrategy = 5,
}

impl TryFrom<&u8> for StrategyProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(StrategyProgramInstruction::CreateStrategy),
            1 => Ok(StrategyProgramInstruction::EditStrategy),
            2 => Ok(StrategyProgramInstruction::ExecuteStrategy),
            3 => Ok(StrategyProgramInstruction::PauseStrategy),
            4 => Ok(StrategyProgramInstruction::ResumeStrategy),
            5 => Ok(StrategyProgramInstruction::CloseStrategy),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
