use pinocchio::error::ProgramError;
#[derive(Debug)]
#[repr(u32)]
pub enum OrderBookError {
    InvalidOrderType = 1,
    InvalidOrderPostMarket = 2,
    InvalidOrderPostIOC = 3,
    InvalidOrderPostFOC = 4,
    InvalidPriceLots = 5,
    InvalidPriceData = 6,
    OracleFeedMismatch = 7,
    OracleStale = 8,
    InvalidOraclePrice = 9,
    OracleConfidenceTooLow = 10,
    InvalidOracle = 11,
    OpenOrdersFull = 12,
    OrderNotFound = 13,
    InvalidInputLotsSize = 14,
    WouldSelfTrade = 15,
    WouldExecutePartially = 16,
    InvalidPostAmount = 17,
    BookFull = 18,
    OrderIdNotFound = 19,
    InvalidOwner = 20,
    InvalidSystemProgram = 21,
    MarketInactive = 22,
    OrderAlreadyExpired = 23,
    OpenOrderNotFound = 24,
    InvalidSide = 25,
    InvalidOrderSlot = 26,
    NoFillToClaim = 27,
    InvalidInputLots = 28,
}

impl From<OrderBookError> for ProgramError {
    fn from(e: OrderBookError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
