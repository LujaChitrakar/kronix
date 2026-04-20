use pinocchio::error::ProgramError;
use shank::ShankInstruction;

pub mod cancel_all_orders;
pub mod cancel_order;
pub mod cancel_order_by_client_id;
pub mod claim_fill;
pub mod create_open_orders_account;
pub mod create_orderbook_market;
pub mod edit_order;
pub mod place_order;
pub mod place_take_order;
pub mod prune_orders;
pub mod set_delegate;

pub use cancel_all_orders::*;
pub use cancel_order::*;
pub use cancel_order_by_client_id::*;
pub use claim_fill::*;
pub use create_open_orders_account::*;
pub use create_orderbook_market::*;
pub use edit_order::*;
pub use place_order::*;
pub use place_take_order::*;
pub use prune_orders::*;
pub use set_delegate::*;

#[derive(ShankInstruction)]
pub enum OrderbookInstruction {
    #[account(0, name = "payer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "market", desc = "Market state PDA", writable)]
    #[account(2, name = "bids", desc = "Bids BookSide PDA", writable)]
    #[account(3, name = "asks", desc = "Asks BookSide PDA", writable)]
    #[account(4, name = "system_program", desc = "System program")]
    CreateOrderbookMarket(CreateOrderbookMarketParams),

    #[account(0, name = "payer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "open_orders_account", desc = "OO account PDA", writable)]
    #[account(2, name = "market", desc = "Market state PDA")]
    #[account(3, name = "system_program", desc = "System program")]
    CreateOpenOrdersAccount(CreateOpenOrdersAccountParams),

    #[account(0, name = "signer", desc = "Order placer", signer, writable)]
    #[account(1, name = "open_orders_account", desc = "Taker OO account", writable)]
    #[account(2, name = "market", desc = "Market state PDA", writable)]
    #[account(3, name = "bids", desc = "Bids BookSide", writable)]
    #[account(4, name = "asks", desc = "Asks BookSide", writable)]
    #[account(5, name = "taker_user_account", desc = "Taker UserAccount", writable)]
    #[account(6, name = "taker_position", desc = "Taker Position", writable)]
    #[account(7, name = "market_config", desc = "Market config")]
    #[account(8, name = "funding_state", desc = "Funding state", writable)]
    #[account(9, name = "orderbook_program", desc = "Orderbook program")]
    #[account(10, name = "risk_program", desc = "Risk program")]
    #[account(11, name = "system_program", desc = "System program")]
    PlaceOrder(PlaceOrderParams),

    #[account(0, name = "signer", desc = "Order placer", signer)]
    #[account(1, name = "open_orders_account", desc = "Taker OO account", writable)]
    #[account(2, name = "market", desc = "Market state PDA", writable)]
    #[account(3, name = "bids", desc = "Bids BookSide", writable)]
    #[account(4, name = "asks", desc = "Asks BookSide", writable)]
    #[account(5, name = "taker_user_account", desc = "Taker UserAccount", writable)]
    #[account(6, name = "taker_position", desc = "Taker Position", writable)]
    #[account(7, name = "market_config", desc = "Market config")]
    #[account(8, name = "funding_state", desc = "Funding state", writable)]
    #[account(9, name = "orderbook_program", desc = "Orderbook program")]
    #[account(10, name = "risk_program", desc = "Risk program")]
    #[account(11, name = "system_program", desc = "System program")]
    PlaceTakeOrder(PlaceTakeOrderParams),

    #[account(0, name = "signer", desc = "Order owner", signer)]
    #[account(1, name = "open_orders_account", desc = "OO account", writable)]
    #[account(2, name = "market", desc = "Market state")]
    #[account(3, name = "bids", desc = "Bids BookSide", writable)]
    #[account(4, name = "asks", desc = "Asks BookSide", writable)]
    CancelOrder(CancelOrderParams),

    #[account(0, name = "signer", desc = "Order owner", signer)]
    #[account(1, name = "open_orders_account", desc = "OO account", writable)]
    #[account(2, name = "market", desc = "Market state")]
    #[account(3, name = "bids", desc = "Bids BookSide", writable)]
    #[account(4, name = "asks", desc = "Asks BookSide", writable)]
    CancelOrderByClientId(CancelOrderByClientIdParams),

    #[account(0, name = "signer", desc = "Order owner", signer)]
    #[account(1, name = "open_orders_account", desc = "OO account", writable)]
    #[account(2, name = "market", desc = "Market state")]
    #[account(3, name = "bids", desc = "Bids BookSide", writable)]
    #[account(4, name = "asks", desc = "Asks BookSide", writable)]
    CancelAllOrders(CancelAllOrdersParams),

    #[account(0, name = "signer", desc = "Order owner", signer, writable)]
    #[account(1, name = "open_orders_account", desc = "OO account", writable)]
    #[account(2, name = "market", desc = "Market state", writable)]
    #[account(3, name = "bids", desc = "Bids BookSide", writable)]
    #[account(4, name = "asks", desc = "Asks BookSide", writable)]
    #[account(5, name = "taker_user_account", desc = "Taker UserAccount", writable)]
    #[account(6, name = "taker_position", desc = "Taker Position", writable)]
    #[account(7, name = "market_config", desc = "Market config")]
    #[account(8, name = "funding_state", desc = "Funding state", writable)]
    #[account(9, name = "orderbook_program", desc = "Orderbook program")]
    #[account(10, name = "risk_program", desc = "Risk program")]
    #[account(11, name = "system_program", desc = "System program")]
    EditOrder(EditOrderParams),

    #[account(0, name = "signer", desc = "Maker", signer)]
    #[account(1, name = "open_orders_account", desc = "Maker OO account", writable)]
    #[account(2, name = "market", desc = "Market state")]
    #[account(3, name = "maker_user_account", desc = "Maker UserAccount", writable)]
    #[account(4, name = "maker_position", desc = "Maker Position", writable)]
    #[account(5, name = "market_config", desc = "Market config")]
    #[account(6, name = "funding_state", desc = "Funding state", writable)]
    #[account(7, name = "orderbook_program", desc = "Orderbook program")]
    #[account(8, name = "risk_program", desc = "Risk program")]
    #[account(9, name = "system_program", desc = "System program")]
    ClaimFill(ClaimFillParams),

    #[account(0, name = "keeper", desc = "Keeper signer", signer)]
    #[account(1, name = "market", desc = "Market state")]
    #[account(2, name = "bids", desc = "Bids BookSide", writable)]
    #[account(3, name = "asks", desc = "Asks BookSide", writable)]
    PruneOrders(PruneOrdersParams),

    #[account(0, name = "signer", desc = "signer", signer)]
    #[account(1, name = "open_orders_account", desc = "OO account", writable)]
    SetDelegate(SetDelegateParams),
}

#[repr(u8)]
pub enum OrderbookProgramInstruction {
    CreateOrderbookMarket = 0,
    CreateOpenOrdersAccount = 1,
    PlaceOrder = 2,
    PlaceTakeOrder = 3,
    EditOrder = 4,
    CancelOrder = 5,
    CancelOrderByClientId = 6,
    CancelAllOrders = 7,
    ClaimFill = 8,
    PruneOrders = 9,
    SetDelegate = 10,
}

impl TryFrom<&u8> for OrderbookProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::CreateOrderbookMarket),
            1 => Ok(Self::CreateOpenOrdersAccount),
            2 => Ok(Self::PlaceOrder),
            3 => Ok(Self::PlaceTakeOrder),
            4 => Ok(Self::EditOrder),
            5 => Ok(Self::CancelOrder),
            6 => Ok(Self::CancelOrderByClientId),
            7 => Ok(Self::CancelAllOrders),
            8 => Ok(Self::ClaimFill),
            9 => Ok(Self::PruneOrders),
            10 => Ok(Self::SetDelegate),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
