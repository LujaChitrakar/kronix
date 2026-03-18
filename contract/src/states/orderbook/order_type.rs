use num_enum::{IntoPrimitive, TryFromPrimitive};
use pinocchio::error::ProgramError;
use std::{default, error::Error};

use crate::{errors::OrderBookError, states::BookSideOrderTree};

#[derive(Eq, PartialEq, Copy, Clone)]
#[repr(u8)]
pub enum PlaceOrderType {
    //Try to match existing orders upto price, max_base_quantity and max_quote_quantity
    // If some amounts remain unfilled, the remaining are placed in orderbook as bid
    Limit = 0,

    // Try to match the order immediately, cancelling any remaining unfilled portion
    // Never placed in orderbook
    ImmediateOrCancel = 1,

    // Never take liquidity. Its only placed in the orderbook as a bid or ask
    // If order is about to be matched, the order is cancelled
    // Used by market makers to place orders without taking liquidity
    PostOnly = 2,

    // Ignores the price and matches at the best available price
    // Executes until max_base_quantity or max_quote_quantity is filled
    // Never placed in order book
    Market = 3,

    // Smart version of PostOnly
    // If the order is about to be matched, adjust the price slightly so it doesn't get matched(one tick below besk ask/bid)
    // Used by high frequency market makers . Avoid order rejection loops
    PostOnlySlide = 4,

    // Must execute the entire order or cancel it entirely
    // If full amount is not filled, the order is cancelled
    // Never placed in orderbook
    FillOrKill = 5,
}

impl PlaceOrderType {
    pub fn to_post_order_type(&self) -> Result<PostOrderType, ProgramError> {
        match *self {
            Self::Market => Err(OrderBookError::InvalidOrderPostMarket.into()),
            Self::ImmediateOrCancel => Err(OrderBookError::InvalidOrderPostIOC.into()),
            Self::FillOrKill => Err(OrderBookError::InvalidOrderPostFOC.into()),
            Self::Limit => Ok(PostOrderType::Limit),
            Self::PostOnly => Ok(PostOrderType::PostOnly),
            Self::PostOnlySlide => Ok(PostOrderType::PostOnlySlide),
        }
    }
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
#[repr(u8)]
pub enum PostOrderType {
    Limit = 0,
    PostOnly = 2,
    PostOnlySlide = 4,
}

#[derive(Eq, PartialEq, Copy, Clone, Default, TryFromPrimitive, IntoPrimitive, Debug)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[repr(u8)]
// SelfTradeBehaviour controls how taker orders interact with the resting limit orders of the same account
// It is the responsibility of the taker to ensure they correctly configure their taker orders
pub enum SelfTradeBehaviour {
    // Both the maker and taker sides of the matched order are decrementd
    // IT is equivalent to a normal order match but no fees are applied
    #[default]
    DecrementTake = 0,

    // Cancel the maker side of the trade, the taker side gets matched with other makers orders
    CancelProvide = 1,

    // Aborts the whole transaction as soon as a self matching scenaropi is encountered
    AbortTransaction = 2,
}

#[derive(Debug, PartialEq, Eq, TryFromPrimitive, IntoPrimitive)]
#[repr(u8)]
pub enum Side {
    Bid = 0,
    Ask = 1,
}

impl Side {
    pub fn invert_side(&self) -> Self {
        match self {
            Self::Bid => Self::Ask,
            Self::Ask => Self::Bid,
        }
    }

    // for orderbook price comparison
    pub fn is_price_data_better(&self, lhs: i64, rhs: i64) -> bool {
        match self {
            Self::Bid => lhs > rhs,
            Self::Ask => lhs < rhs,
        }
    }

    // for price calculation
    pub fn is_price_better(&self, lhs: u64, rhs: u64) -> bool {
        match self {
            Self::Bid => lhs > rhs,
            Self::Ask => lhs < rhs,
        }
    }

    // is price limit acceptable for limit order on side
    pub fn is_price_within_limit(&self, price: i64, limit: i64) -> bool {
        match self {
            Side::Bid => price <= limit,
            Side::Ask => price >= limit,
        }
    }
}

#[derive(
    Eq,
    PartialEq,
    Copy,
    Clone,
    TryFromPrimitive,
    IntoPrimitive,
    Debug,
)]
#[repr(u8)]
pub enum SideAndOrderTree{
    BidFixed=0,
    AskFixed=1,
    BidOraclePegged=2,
    AskOraclePegged=3,
}

impl SideAndOrderTree{
    pub fn new(side: Side, order_tree: BookSideOrderTree) -> Self {
        match (side, order_tree) {
            (Side::Bid, BookSideOrderTree::Fixed) => Self::BidFixed,
            (Side::Ask, BookSideOrderTree::Fixed) => Self::AskFixed,
            (Side::Bid, BookSideOrderTree::OraclePegged) => Self::BidOraclePegged,
            (Side::Ask, BookSideOrderTree::OraclePegged) => Self::AskOraclePegged,
        }
    }
    
    pub fn side(&self)->Side{
        match self {
            Self::BidFixed | Self::BidOraclePegged => Side::Bid,
            Self::AskFixed | Self::AskOraclePegged => Side::Ask,
        }
    }
    
    pub fn order_tree(&self) -> BookSideOrderTree {
        match self {
            Self::BidFixed | Self::AskFixed => BookSideOrderTree::Fixed,
            Self::BidOraclePegged | Self::AskOraclePegged => BookSideOrderTree::OraclePegged,
        }
    }
}