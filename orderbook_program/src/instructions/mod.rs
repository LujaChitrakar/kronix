use pinocchio::error::ProgramError;

pub mod cancel_all_orders;
pub mod cancel_order;
pub mod cancel_order_by_client_id;
pub mod claim_fill;
pub mod create_market;
pub mod create_open_orders_account;
pub mod edit_order;
pub mod place_order;
pub mod place_take_order;
pub mod prune_orders;

pub use cancel_all_orders::*;
pub use cancel_order::*;
pub use cancel_order_by_client_id::*;
pub use claim_fill::*;
pub use create_market::*;
pub use create_open_orders_account::*;
pub use edit_order::*;
pub use place_order::*;
pub use place_take_order::*;
pub use prune_orders::*;
use shank::ShankInstruction;

#[derive(ShankInstruction)]
#[repr(u8)]
pub enum OrderbookInstruction {
    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(1, writable, name = "market", desc = "Market account")]
    #[account(2, writable, name = "bids", desc = "Bids account")]
    #[account(3, writable, name = "asks", desc = "Asks account")]
    #[account(4, name = "system_program", desc = "System program")]
    CreateMarket=0,

    #[account(0, writable, signer, name = "payer", desc = "Payer")]
    #[account(
        1,
        writable,
        name = "open_orders_account",
        desc = "Open orders account"
    )]
    #[account(2, name = "market", desc = "Market account")]
    #[account(3, name = "system_program", desc = "System program")]
    CreateOpenOrdersAccount=1,

    #[account(0, signer, name = "signer", desc = "Signer")]
    #[account(
        1,
        writable,
        name = "open_orders_account",
        desc = "Open orders account"
    )]
    #[account(2, writable, name = "market", desc = "Market account")]
    #[account(3, writable, name = "bids", desc = "Bids account")]
    #[account(4, writable, name = "asks", desc = "Asks account")]
    PlaceOrder=2,

    #[account(0, signer, name = "signer", desc = "Signer")]
    #[account(
        1,
        writable,
        name = "open_orders_account",
        desc = "Open orders account"
    )]
    #[account(2, writable, name = "market", desc = "Market account")]
    #[account(3, writable, name = "bids", desc = "Bids account")]
    #[account(4, writable, name = "asks", desc = "Asks account")]
    PlaceTakeOrder=3,

    #[account(0, signer, name = "signer", desc = "Signer")]
    #[account(
        1,
        writable,
        name = "open_orders_account",
        desc = "Open orders account"
    )]
    #[account(2, writable, name = "market", desc = "Market account")]
    #[account(3, writable, name = "bids", desc = "Bids account")]
    #[account(4, writable, name = "asks", desc = "Asks account")]
    EditOrder=4,

    #[account(0, signer, name = "signer", desc = "Signer")]
    #[account(
        1,
        writable,
        name = "open_orders_account",
        desc = "Open orders account"
    )]
    #[account(2, name = "market", desc = "Market account")]
    #[account(3, writable, name = "bids", desc = "Bids account")]
    #[account(4, writable, name = "asks", desc = "Asks account")]
    CancelOrder=5,

    #[account(0, signer, name = "signer", desc = "Signer")]
    #[account(
        1,
        writable,
        name = "open_orders_account",
        desc = "Open orders account"
    )]
    #[account(2, name = "market", desc = "Market account")]
    #[account(3, writable, name = "bids", desc = "Bids account")]
    #[account(4, writable, name = "asks", desc = "Asks account")]
    CancelOrderByClientId=6,

    #[account(0, signer, name = "signer", desc = "Signer")]
    #[account(
        1,
        writable,
        name = "open_orders_account",
        desc = "Open orders account"
    )]
    #[account(2, name = "market", desc = "Market account")]
    #[account(3, writable, name = "bids", desc = "Bids account")]
    #[account(4, writable, name = "asks", desc = "Asks account")]
    CancelAllOrders=7,

    #[account(0, signer, name = "signer", desc = "Signer")]
    #[account(
        1,
        writable,
        name = "open_orders_account",
        desc = "Open orders account"
    )]
    #[account(2, name = "market", desc = "Market account")]
    ClaimFill=8,

    #[account(0, signer, name = "keeper", desc = "Keeper")]
    #[account(1, name = "market", desc = "Market account")]
    #[account(2, writable, name = "bids", desc = "Bids account")]
    #[account(3, writable, name = "asks", desc = "Asks account")]
    PruneOrders=9,
}

impl TryFrom<&u8> for OrderbookInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(OrderbookInstruction::CreateMarket),
            1 => Ok(OrderbookInstruction::CreateOpenOrdersAccount),
            2 => Ok(OrderbookInstruction::PlaceOrder),
            3 => Ok(OrderbookInstruction::PlaceTakeOrder),
            4 => Ok(OrderbookInstruction::EditOrder),
            5 => Ok(OrderbookInstruction::CancelOrder),
            6 => Ok(OrderbookInstruction::CancelOrderByClientId),
            7 => Ok(OrderbookInstruction::CancelAllOrders),
            8 => Ok(OrderbookInstruction::ClaimFill),
            9 => Ok(OrderbookInstruction::PruneOrders),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
