use pinocchio::error::ProgramError;

#[repr(u32)]
pub enum OrderBookError {
    InvalidOrderType = 1,
    InvalidOrderPostMarket = 2,
    InvalidOrderPostIOC = 3,
    InvalidOrderPostFOC = 4,
}

impl From<OrderBookError> for ProgramError {
    fn from(e: OrderBookError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
