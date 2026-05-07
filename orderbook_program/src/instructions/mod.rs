use pinocchio::error::ProgramError;
use shank::ShankInstruction;

pub mod cancel_all_orders;
pub mod cancel_order;
pub mod cancel_order_by_client_id;
pub mod claim_fill;
pub mod close_orderbook_market;
pub mod create_open_orders_account;
pub mod create_orderbook_market;
pub mod edit_order;
pub mod initialize_fills_logs;
pub mod place_order;
pub mod place_take_order;
pub mod prune_orders;
pub mod set_delegate;
pub mod settle_fills;

pub use cancel_all_orders::*;
pub use cancel_order::*;
pub use cancel_order_by_client_id::*;
pub use claim_fill::*;
pub use close_orderbook_market::*;
pub use create_open_orders_account::*;
pub use create_orderbook_market::*;
pub use edit_order::*;
pub use initialize_fills_logs::*;
pub use place_order::*;
pub use place_take_order::*;
pub use prune_orders::*;
pub use set_delegate::*;
pub use settle_fills::*;

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

    #[account(0, name = "fee_payer", desc = "Fee payer", signer, writable)]
    #[account(1, name = "taker", desc = "Taker pubkey (used as PDA seed)")]
    #[account(2, name = "fills_log", desc = "FillsLog PDA", writable)]
    #[account(3, name = "market", desc = "Market state")]
    #[account(4, name = "system_program", desc = "System program")]
    InitializeFillsLog(InitializeFillsLogParams),

    #[account(0, name = "signer", desc = "Order placer", signer, writable)]
    #[account(1, name = "open_orders_account", desc = "Taker OO account", writable)]
    #[account(2, name = "market", desc = "Market state PDA", writable)]
    #[account(3, name = "bids", desc = "Bids BookSide", writable)]
    #[account(4, name = "asks", desc = "Asks BookSide", writable)]
    #[account(5, name = "fills_logs", desc = "FillsLog PDA", writable)]
    #[account(6, name = "system_program", desc = "System program")]
    PlaceOrder(PlaceOrderParams),

    #[account(0, name = "signer", desc = "Order placer", signer)]
    #[account(1, name = "open_orders_account", desc = "Taker OO account", writable)]
    #[account(2, name = "market", desc = "Market state PDA", writable)]
    #[account(3, name = "bids", desc = "Bids BookSide", writable)]
    #[account(4, name = "asks", desc = "Asks BookSide", writable)]
    #[account(5, name = "fills_logs", desc = "FillsLog PDA", writable)]
    #[account(6, name = "system_program", desc = "System program")]
    PlaceTakeOrder(PlaceTakeOrderParams),

    #[account(0, name = "caller", desc = "Anyone", signer)]
    #[account(1, name = "fills_log", desc = "FillsLog PDA", writable)]
    #[account(2, name = "market", desc = "Market state")]
    #[account(3, name = "market_config", desc = "Risk MarketConfig")]
    #[account(4, name = "funding_state", desc = "FundingState", writable)]
    #[account(5, name = "risk_program", desc = "Risk program")]
    #[account(6, name = "system_program", desc = "System program")]
    SettleFills(SettleFillsParams),

    #[account(0, name = "signer", desc = "Order owner", signer, writable)]
    #[account(1, name = "open_orders_account", desc = "OO account", writable)]
    #[account(2, name = "market", desc = "Market state", writable)]
    #[account(3, name = "bids", desc = "Bids BookSide", writable)]
    #[account(4, name = "asks", desc = "Asks BookSide", writable)]
    #[account(5, name = "fills_logs", desc = "FillsLog PDA", writable)]
    #[account(6, name = "system_program", desc = "System program")]
    EditOrder(EditOrderParams),

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

    // #[account(0, name = "signer", desc = "Maker", signer)]
    // #[account(1, name = "open_orders_account", desc = "Maker OO account", writable)]
    // #[account(2, name = "market", desc = "Market state")]
    // #[account(3, name = "maker_user_account", desc = "Maker UserAccount", writable)]
    // #[account(4, name = "maker_position", desc = "Maker Position", writable)]
    // #[account(5, name = "market_config", desc = "Market config")]
    // #[account(6, name = "funding_state", desc = "Funding state", writable)]
    // #[account(7, name = "orderbook_program", desc = "Orderbook program")]
    // #[account(8, name = "risk_program", desc = "Risk program")]
    // #[account(9, name = "system_program", desc = "System program")]
    // ClaimFill(ClaimFillParams),
    //
    #[account(0, name = "keeper", desc = "Keeper signer", signer)]
    #[account(1, name = "market", desc = "Market state")]
    #[account(2, name = "bids", desc = "Bids BookSide", writable)]
    #[account(3, name = "asks", desc = "Asks BookSide", writable)]
    PruneOrders(PruneOrdersParams),

    #[account(0, name = "signer", desc = "signer", signer)]
    #[account(1, name = "open_orders_account", desc = "OO account", writable)]
    SetDelegate(SetDelegateParams),

    #[account(
        0,
        name = "admin",
        desc = "Market admin / rent receiver",
        signer,
        writable
    )]
    #[account(1, name = "market", desc = "Market state PDA", writable)]
    #[account(2, name = "bids", desc = "Bids BookSide PDA", writable)]
    #[account(3, name = "asks", desc = "Asks BookSide PDA", writable)]
    CloseOrderbookMarket(CloseOrderbookMarketParams),
}

#[repr(u8)]
pub enum OrderbookProgramInstruction {
    CreateOrderbookMarket = 0,
    CreateOpenOrdersAccount = 1,
    InitializeFillsLogs = 2,
    PlaceOrder = 3,
    PlaceTakeOrder = 4,
    SettleFills = 5,
    EditOrder = 6,
    CancelOrder = 7,
    CancelOrderByClientId = 8,
    CancelAllOrders = 9,
    // ClaimFill = 8,
    PruneOrders = 10,
    SetDelegate = 11,
    CloseOrderbookMarket = 12,
}

impl TryFrom<&u8> for OrderbookProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::CreateOrderbookMarket),
            1 => Ok(Self::CreateOpenOrdersAccount),
            2 => Ok(Self::InitializeFillsLogs),
            3 => Ok(Self::PlaceOrder),
            4 => Ok(Self::PlaceTakeOrder),
            5 => Ok(Self::SettleFills),
            6 => Ok(Self::EditOrder),
            7 => Ok(Self::CancelOrder),
            8 => Ok(Self::CancelOrderByClientId),
            9 => Ok(Self::CancelAllOrders),
            // 9 => Ok(Self::ClaimFill),
            10 => Ok(Self::PruneOrders),
            11 => Ok(Self::SetDelegate),
            12 => Ok(Self::CloseOrderbookMarket),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
