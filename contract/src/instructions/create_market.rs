use bytemuck::{Pod, Zeroable};
use pinocchio::{
    AccountView, Address, ProgramResult,
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{Sysvar, clock::Clock, rent::Rent},
};
use pinocchio_pubkey::derive_address;
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{ASKS_SEED, BIDS_SEED, MARKET_SEED},
    errors::OrderBookError,
    states::{BookSide, MarketState, OrderTreeType},
};

#[derive(Pod, Zeroable, Clone, Copy, PartialEq, Eq)]
#[repr(C)]
struct CreateMarketParams {
    admin: [u8; 32],
    market_index: u16,
    bump: u8,
    bids_bump: u8,
    asks_bump: u8,
    padding: [u8; 3],
    base_lot_size: i64,
    quote_lot_size: i64,
    time_expiry: i64,
    name: [u8; 16],
}

pub fn create_market(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        payer,
        market,
        bids,
        asks,
        system_program,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !market.is_data_empty() || !asks.is_data_empty() || !bids.is_data_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    if system_program.address() != &pinocchio_system::ID {
        return Err(OrderBookError::InvalidSystemProgram.into());
    }
    
    let clock=Clock::get()?;
    let rent=Rent::get()?;

    let ix_args = bytemuck::try_from_bytes::<CreateMarketParams>(data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if ix_args.time_expiry != 0 && ix_args.time_expiry <= clock.unix_timestamp {
        return Err(ProgramError::InvalidAccountData);
    }
    if ix_args.quote_lot_size <= 0 || ix_args.base_lot_size <= 0 {
        return Err(OrderBookError::InvalidInputLotsSize.into());
    }

    let bump_bytes = [ix_args.bump];
    let market_index = ix_args.market_index.to_le_bytes();
    let bid_bump_bytes = [ix_args.bids_bump];
    let ask_bump_bytes = [ix_args.asks_bump];

    // validate_pda
    {
        let market_seed = [MARKET_SEED, market_index.as_ref(), &bump_bytes];
        let market_account_pda = derive_address(&market_seed, None, &crate::ID);
        if market_account_pda != *market.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }

        let bids_seed = [BIDS_SEED, market_index.as_ref(), &bid_bump_bytes];
        let bids_account_pda = derive_address(&bids_seed, None, &crate::ID);
        if bids_account_pda != *bids.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }

        let asks_seed = [ASKS_SEED, market_index.as_ref(), &ask_bump_bytes];
        let asks_account_pda = derive_address(&asks_seed, None, &crate::ID);
        if asks_account_pda != *asks.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }
    }

    // required signer_seeds
    let market_signer_seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(market_index.as_ref()),
        Seed::from(&bump_bytes),
    ];
    let bids_signer_seeds = [
        Seed::from(BIDS_SEED),
        Seed::from(market_index.as_ref()),
        Seed::from(&bid_bump_bytes),
    ];
    let asks_signer_seeds = [
        Seed::from(ASKS_SEED),
        Seed::from(market_index.as_ref()),
        Seed::from(&ask_bump_bytes),
    ];

    CreateAccount {
        from: payer,
        to: market,
        lamports: rent.try_minimum_balance(MarketState::LEN)?,
        space: MarketState::LEN as u64,
        owner: &Address::from(crate::ID),
    }
    .invoke_signed(&[Signer::from(&market_signer_seeds)])?;

    CreateAccount {
        from: payer,
        to: bids,
        lamports: rent.try_minimum_balance(BookSide::LEN)?,
        space: BookSide::LEN as u64,
        owner: &Address::from(crate::ID),
    }
    .invoke_signed(&[Signer::from(&bids_signer_seeds)])?;

    CreateAccount {
        from: payer,
        to: asks,
        lamports: rent.try_minimum_balance(BookSide::LEN)?,
        space: BookSide::LEN as u64,
        owner: &Address::from(crate::ID),
    }
    .invoke_signed(&[Signer::from(&asks_signer_seeds)])?;

    {
        let mut market_data = market.try_borrow_mut()?;
        let market_state = bytemuck::from_bytes_mut::<MarketState>(&mut market_data);

        *market_state = MarketState {
            market_index: ix_args.market_index,
            bump: ix_args.bump,
            paused: 0,
            padding: [0; 4],
            name: ix_args.name,
            admin: ix_args.admin,
            bids: *bids.address().as_array(),
            asks: *asks.address().as_array(),
            base_lot_size: ix_args.base_lot_size,
            quote_lot_size: ix_args.quote_lot_size,
            seq_num: 0,
            registration_ts: Clock::get()?.unix_timestamp,
            time_expiry: ix_args.time_expiry,
            reserved: [0; 64],
        };
    }
    {
        let mut bids_data = bids.try_borrow_mut()?;
        let bookside_bid_state = bytemuck::from_bytes_mut::<BookSide>(&mut bids_data);
        bookside_bid_state.init(OrderTreeType::Bids);
    }
    {
        let mut asks_data = asks.try_borrow_mut()?;
        let bookside_ask_state = bytemuck::from_bytes_mut::<BookSide>(&mut asks_data);
        bookside_ask_state.init(OrderTreeType::Asks);
    }
    Ok(())
}
