use bytemuck::{Pod, Zeroable};
use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use shank::ShankType;

use crate::{
    constants::MARKET_SEED,
    errors::OrderBookError,
    helper::{
        close_account, verify_account_owner, verify_initialized, verify_pda, verify_signer,
        verify_writtable,
    },
    states::MarketState,
};

#[derive(Pod, Zeroable, Clone, Copy, PartialEq, Eq, ShankType)]
#[repr(C)]
pub struct CloseOrderbookMarketParams {
    pub market_index: u16,
    pub padding: [u8; 6],
}

pub fn process_close_orderbook_market(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [admin, market, bids, asks, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(admin)?;
    verify_writtable(admin)?;
    unsafe {
        verify_account_owner(market, &crate::ID)?;
        verify_account_owner(bids, &crate::ID)?;
        verify_account_owner(asks, &crate::ID)?;
    }
    verify_initialized(market)?;
    verify_initialized(bids)?;
    verify_initialized(asks)?;
    verify_writtable(market)?;
    verify_writtable(bids)?;
    verify_writtable(asks)?;

    let params = bytemuck::try_pod_read_unaligned::<CloseOrderbookMarketParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let market_index_bytes = params.market_index.to_le_bytes();
    let (market_bids, market_asks, market_bump) = {
        let market_data = market.try_borrow()?;
        if market_data.len() < MarketState::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        let market_state = bytemuck::from_bytes::<MarketState>(&market_data[..MarketState::LEN]);
        if market_state.market_index != params.market_index {
            return Err(OrderBookError::InvalidMarket.into());
        }
        (market_state.bids, market_state.asks, market_state.bump)
    };

    if bids.address().as_array() != &market_bids || asks.address().as_array() != &market_asks {
        return Err(OrderBookError::InvalidMarket.into());
    }
    verify_pda(
        market,
        &[MARKET_SEED, market_index_bytes.as_ref(), &[market_bump]],
        &crate::ID,
    )?;

    close_account(bids, admin)?;
    close_account(asks, admin)?;
    close_account(market, admin)?;
    Ok(())
}
