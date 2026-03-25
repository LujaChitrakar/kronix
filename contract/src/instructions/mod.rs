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
use pinocchio::error::ProgramError;
pub use place_order::*;
pub use place_take_order::*;
pub use prune_orders::*;

#[repr(u8)]
pub enum OrderbookInstruction {
    CreateMarket,
    CreateOpenOrdersAccount,
    PlaceOrder,
    PlaceTakeOrder,
    EditOrder,
    CancelOrder,
    CancelOrderById,
    CancelAllOrders,
    ClaimFill,
    PruneOrders,
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
            6 => Ok(OrderbookInstruction::CancelOrderById),
            7 => Ok(OrderbookInstruction::CancelAllOrders),
            8 => Ok(OrderbookInstruction::ClaimFill),
            9 => Ok(OrderbookInstruction::PruneOrders),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
