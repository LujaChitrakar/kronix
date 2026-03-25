use bytemuck::{Pod, Zeroable};
use pinocchio::{
    AccountView, ProgramResult,
    error::ProgramError,
    sysvars::{Sysvar, clock::Clock},
};
use pyth_solana_receiver_sdk::cpi::accounts;

use crate::{
    constants::MARKET_SEED,
    errors::OrderBookError,
    helper::{
        verify_account_owner, verify_initialized, verify_pda, verify_signer, verify_writtable,
    },
    states::{BookSide, MarketState},
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct PruneOrdersParams {
    pub side: u8,  // 0=Bid, 1=Ask, 255=both
    pub limit: u8, // max orders to prune per call
    pub padding: [u8; 6],
}

pub fn process_prune_orders(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        keeper, // permissionless — any signer can call this
        market,
        bids,
        asks,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(keeper)?;
    verify_initialized(market)?;
    verify_initialized(bids)?;
    verify_initialized(asks)?;

    unsafe {
        verify_account_owner(market, &crate::ID)?;
        verify_account_owner(bids, &crate::ID)?;
        verify_account_owner(asks, &crate::ID)?;
    }
    verify_writtable(bids)?;
    verify_writtable(asks)?;

    let params = bytemuck::try_from_bytes::<PruneOrdersParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let limit = if params.limit == 0 { 8u8 } else { params.limit };
    let now_ts = Clock::get()?.unix_timestamp;

    let market_data = market.try_borrow()?;
    let market_state = bytemuck::from_bytes::<MarketState>(&market_data[..MarketState::LEN]);

    if !market_state.is_active(now_ts) {
        return Err(OrderBookError::MarketInactive.into());
    }

    {
        let market_bump = [market_state.bump];
        let market_index = market_state.market_index.to_le_bytes();
        unsafe {
            verify_account_owner(bids, &market_state.bids)?;
            verify_account_owner(asks, &market_state.asks)?;
        }
        verify_pda(
            market,
            &[MARKET_SEED, market_index.as_ref(), &market_bump],
            &crate::ID,
        )?;
    }

    if params.side == 0 || params.side == 255 {
        let mut bids_data = bids.try_borrow_mut()?;
        let bids_state = bytemuck::from_bytes_mut::<BookSide>(&mut bids_data[..BookSide::LEN]);

        let mut pruned = 0u8;
        while pruned < limit {
            match bids_state.remove_one_expired(now_ts as u64) {
                Some(_) => pruned += 1,
                None => break, // no more expired orders on this side
            }
        }
    }
    if params.side == 1 || params.side == 255 {
        let mut asks_data = asks.try_borrow_mut()?;
        let asks_state = bytemuck::from_bytes_mut::<BookSide>(&mut asks_data[..BookSide::LEN]);

        let mut pruned = 0u8;
        while pruned < limit {
            match asks_state.remove_one_expired(now_ts as u64) {
                Some(_) => pruned += 1,
                None => break,
            }
        }
    }
    if params.side != 0 && params.side != 1 && params.side != 255 {
        return Err(OrderBookError::InvalidSide.into());
    }

    Ok(())
}
