pub mod cancel_trigger_order;
pub mod edit_trigger;
pub mod execute_trigger;
pub mod pause_trigger;
pub mod place_trigger_order;
pub mod prune_expired_triggers;

pub use cancel_trigger_order::*;
pub use edit_trigger::*;
pub use execute_trigger::*;
pub use pause_trigger::*;
use pinocchio::error::ProgramError;
pub use place_trigger_order::*;
pub use prune_expired_triggers::*;
use shank::ShankInstruction;

#[derive(ShankInstruction)]
pub enum TriggerInstruction {
    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "trigger_order", desc = "Trigger order PDA", writable)]
    #[account(
        2,
        name = "open_orders_account",
        desc = "Open orders account PDA",
        writable
    )]
    #[account(
        3,
        name = "trigger_authority",
        desc = "Trigger authority PDA (taker for fills_log + OO delegate)"
    )]
    #[account(
        4,
        name = "fills_log",
        desc = "FillsLog PDA (initialized via CPI)",
        writable
    )]
    #[account(5, name = "market", desc = "Market state PDA")]
    #[account(6, name = "orderbook_program", desc = "Orderbook program (CPI)")]
    #[account(7, name = "system_program", desc = "System program")]
    PlaceTriggerOrder(PlaceTriggerOrderParams),

    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "trigger_order", desc = "Trigger order PDA", writable)]
    EditTrigger(EditTriggerParams),

    #[account(0, name = "keeper", desc = "Fee payer", signer, writable)]
    #[account(
        1,
        name = "trigger_authority",
        desc = "Trigger order authority PDA",
        writable
    )]
    #[account(
        2,
        name = "trigger_order_owner",
        desc = "Trigger order owner PDA",
        writable
    )]
    #[account(3, name = "trigger_order", desc = "Trigger order PDA", writable)]
    #[account(4, name = "position", desc = "Owner position PDA")]
    #[account(5, name = "market", desc = "Market PDA", writable)]
    #[account(
        6,
        name = "open_orders_account",
        desc = "Open orders account PDA",
        writable
    )]
    #[account(7, name = "bids", desc = "Bids PDA", writable)]
    #[account(8, name = "asks", desc = "Asks PDA", writable)]
    #[account(9, name = "fills_log", desc = "Fills log PDA", writable)]
    #[account(10, name = "oracle", desc = "Switchboard price feed")]
    #[account(11, name = "orderbook_program", desc = "Orderbook Program")]
    #[account(12, name = "system_program", desc = "System program")]
    ExecuteTrigger(ExecuteTriggerParams),

    #[account(0, name = "signer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "trigger_order", desc = "Trigger order PDA", writable)]
    CancelTriggerOrder,

    #[account(0, name = "keeper", desc = "Fee payer", signer, writable)]
    PruneExpiredTrigger,

    #[account(0, name = "signer", desc = "Order owner", signer, writable)]
    #[account(1, name = "trigger_order", desc = "Trigger order PDA", writable)]
    PauseTrigger,

    #[account(0, name = "signer", desc = "Order owner", signer, writable)]
    #[account(1, name = "trigger_order", desc = "Trigger order PDA", writable)]
    ResumeTrigger,
}

#[repr(u8)]
pub enum TriggerProgramInstruction {
    PlaceTriggerOrder = 0,
    EditTrigger = 1,
    ExecuteTrigger = 2,
    CancelTriggerOrder = 3,
    PruneExpiredTrigger = 4,
    PauseTrigger = 5,
    ResumeTrigger = 6,
}

impl TryFrom<&u8> for TriggerProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(TriggerProgramInstruction::PlaceTriggerOrder),
            1 => Ok(TriggerProgramInstruction::EditTrigger),
            2 => Ok(TriggerProgramInstruction::ExecuteTrigger),
            3 => Ok(TriggerProgramInstruction::CancelTriggerOrder),
            4 => Ok(TriggerProgramInstruction::PruneExpiredTrigger),
            5 => Ok(TriggerProgramInstruction::PauseTrigger),
            6 => Ok(TriggerProgramInstruction::ResumeTrigger),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
