pub mod cancel_trigger_order;
pub mod edit_trigger;
pub mod execute_trigger;
pub mod place_trigger_order;
pub mod prune_expired_triggers;

pub use cancel_trigger_order::*;
pub use edit_trigger::*;
pub use execute_trigger::*;
use pinocchio::error::ProgramError;
pub use place_trigger_order::*;
pub use prune_expired_triggers::*;
use shank::ShankInstruction;

#[derive(ShankInstruction)]
pub enum TriggerInstruction {
    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "trigger_order", desc = "Trigger order PDA", writable)]
    #[account(2, name = "open_orders_account", desc = "Open orders account PDA")]
    #[account(3, name = "system_program", desc = "System program")]
    PlaceTriggerOrder(PlaceTriggerOrderParams),

    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "trigger_order", desc = "Trigger order PDA", writable)]
    EditTrigger(EditTriggerParams),

    #[account(0, name = "keeper", desc = "Fee payer", signer, writable)]
    #[account(1, name = "trigger_order", desc = "Trigger order PDA", writable)]
    #[account(
        2,
        name = "trigger_authority",
        desc = "Trigger order authority PDA",
        writable
    )]
    #[account(3, name = "market", desc = "Market PDA", writable)]
    #[account(
        4,
        name = "open_orders_account",
        desc = "Open orders account PDA",
        writable
    )]
    #[account(5, name = "bids", desc = "Bids PDA", writable)]
    #[account(6, name = "asks", desc = "Asks PDA", writable)]
    #[account(7, name = "market_config", desc = "Market Config PDA", writable)]
    #[account(8, name = "funding_state", desc = "Funding State PDA", writable)]
    #[account(9, name = "user_account", desc = "User Account PDA", writable)]
    #[account(10, name = "position", desc = "Position PDA", writable)]
    #[account(11, name = "oracle", desc = "Oracle PDA", writable)]
    #[account(12, name = "orderbook_program", desc = "Orderbook Program")]
    #[account(13, name = "risk_program", desc = "Risk Program")]
    #[account(14, name = "system_program", desc = "System program")]
    ExecuteTrigger(ExecuteTriggerParams),

    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "trigger_order", desc = "Trigger order PDA", writable)]
    CancelTriggerOrder,

    #[account(0, name = "keeper", desc = "Fee payer", signer, writable)]
    PruneTrigger,
}

#[repr(u8)]
pub enum TriggerProgramInstruction {
    PlaceTriggerOrder = 0,
    EditTrigger = 1,
    ExecuteTrigger = 2,
    CancelTriggerOrder = 3,
    PruneTrigger = 4,
}

impl TryFrom<&u8> for TriggerProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(TriggerProgramInstruction::PlaceTriggerOrder),
            1 => Ok(TriggerProgramInstruction::EditTrigger),
            2 => Ok(TriggerProgramInstruction::ExecuteTrigger),
            3 => Ok(TriggerProgramInstruction::CancelTriggerOrder),
            4 => Ok(TriggerProgramInstruction::PruneTrigger),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
