use bytemuck::{Pod, Zeroable};
use pinocchio::{AccountView, ProgramResult, error::ProgramError};

use crate::{
    states::MarketState, utils::check_ata,
  
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
struct CreateMarketParams {
    market_index: u16,
    padding: [u8; 6],
    base_lot_size: i64,
    quote_lot_size: i64,
    time_expiry: i64,
    name: [u8; 16],
}

pub fn create_market(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        payer,
        market,
        market_authority,
        bids,
        asks,
        market_base_vault,
        market_quote_vault,
        base_mint,
        quote_mint,
        system_program,
        token_program,
        associated_token_program,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !market.is_data_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    {
        check_ata!(market_base_vault, market_authority, base_mint);
        check_ata!(market_quote_vault, market_authority, quote_mint);
    }

    {
        // let data = unsafe { impl_load::<CreateMarketParams>(data)? };
    }

    Ok(())
}
