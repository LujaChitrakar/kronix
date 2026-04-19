use bytemuck::{Pod, Zeroable};
use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use shank::ShankType;

use crate::{
    constants::{POSITION_SEED, USER_ACCOUNT_SEED},
    errors::RiskProgramError,
    helper::{
        verify_account_owner, verify_initialized, verify_pda, verify_program_id, verify_signer,
    },
    instructions::settle_funding_internal,
    state::{FundingState, MarketConfig, Position, UserAccount},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct SettleFillParams {
    pub price_lots: i64, // fill price in price lots
    pub base_lots: i64,  // base lots filled
    pub market_index: u16,
    pub is_taker: u8,      // 1 = taker, 0 = maker
    pub taker_side: u8,    // 0=bid, 1=ask — taker's side
    pub bump_position: u8, // PDA bump for position being created
    pub bump_user: u8,     // PDA bump for user account
    pub padding: [u8; 2],
    pub maker_pubkey: [u8; 32],
    pub taker_pubkey: [u8; 32],
}

pub fn process_settle_fill(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        user_account,      // taker or maker UserAccount
        position,          // taker or maker Position
        market_config,
        funding_state,
        orderbook_program, // must be orderbook_program ID
        system_program,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(orderbook_program)?;
    verify_program_id(
        orderbook_program,
        &Address::from(crate::ORDERBOOK_PROGRAM_ID),
    )?;
    verify_program_id(system_program, &pinocchio_system::ID)?;
    verify_initialized(user_account)?;
    verify_initialized(position)?;

    unsafe {
        verify_account_owner(market_config, &crate::ID)?;
        verify_account_owner(funding_state, &crate::ID)?;
        verify_account_owner(user_account, &crate::ID)?;
        verify_account_owner(position, &crate::ID)?;
    }

    let params = bytemuck::try_pod_read_unaligned::<SettleFillParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let market_config_data = market_config.try_borrow()?;
    let market_config_state =
        bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);

    if market_config_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }
    let trader_pubkey = if params.is_taker == 1 {
        &params.taker_pubkey
    } else {
        &params.maker_pubkey
    };

    // Taker side is what the taker did
    // If taker bought (bid), taker is long, maker is short
    // If taker sold (ask), taker is short, maker is long
    let position_side: u8 = if params.is_taker == 1 {
        params.taker_side
    } else {
        1 - params.taker_side
    };
    let mut funding_data = funding_state.try_borrow_mut()?;
    let funding = bytemuck::from_bytes_mut::<FundingState>(&mut funding_data[..FundingState::LEN]);

    let market_index_bytes = params.market_index.to_le_bytes();
    let bump_user_bytes = [params.bump_user];
    let bump_pos_bytes = [params.bump_position];

    verify_pda(
        user_account,
        &[USER_ACCOUNT_SEED, trader_pubkey.as_ref(), &bump_user_bytes],
        &crate::ID,
    )?;
    verify_pda(
        position,
        &[
            POSITION_SEED,
            trader_pubkey.as_ref(),
            market_index_bytes.as_ref(),
            &bump_pos_bytes,
        ],
        &crate::ID,
    )?;

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    if {
        let existing_data = position.try_borrow()?;
        let existing_position = bytemuck::from_bytes::<Position>(&existing_data[..Position::LEN]);
        existing_position.size == 0
    } {
        let required_margin =
            market_config_state.required_initial_margin(params.base_lots, params.price_lots);

        let mut position_data = position.try_borrow_mut()?;
        let position_state =
            bytemuck::from_bytes_mut::<Position>(&mut position_data[..Position::LEN]);

        *position_state = Position {
            owner: *trader_pubkey,
            market_index: params.market_index,
            bump: params.bump_position,
            side: position_side,
            padding: [0; 4],
            size: params.base_lots,
            entry_price: params.price_lots,
            entry_funding_index: funding.cumulative_index,
            initial_margin: required_margin,
            reserved: [0; 32],
        };

        user_account_state.margin_used = user_account_state
            .margin_used
            .checked_add(required_margin)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        user_account_state.position_count = user_account_state
            .position_count
            .checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    } else {
        let mut position_data = position.try_borrow_mut()?;
        let position_state =
            bytemuck::from_bytes_mut::<Position>(&mut position_data[..Position::LEN]);

        if position_state.owner != *trader_pubkey {
            return Err(RiskProgramError::InvalidOwner.into());
        }

        settle_funding_internal(
            user_account_state,
            position_state,
            funding,
            market_config_state.quote_lot_size,
        )?;

        if position_state.side == position_side {
            let old_size = position_state.size;
            let new_size = old_size
                .checked_add(params.base_lots)
                .ok_or(ProgramError::ArithmeticOverflow)?;

            let new_entry_price = ((old_size as i128 * position_state.entry_price as i128)
                + (params.base_lots as i128 * params.price_lots as i128))
                .checked_div(new_size as i128)
                .ok_or(ProgramError::ArithmeticOverflow)? as i64;

            let additional_margin =
                market_config_state.required_initial_margin(params.base_lots, params.price_lots);

            position_state.size = new_size;
            position_state.entry_price = new_entry_price;
            position_state.initial_margin = position_state
                .initial_margin
                .checked_add(additional_margin)
                .ok_or(ProgramError::ArithmeticOverflow)?;

            user_account_state.margin_used = user_account_state
                .margin_used
                .checked_add(additional_margin)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        } else {
            let close_size = params.base_lots.min(position_state.size);

            let price_diff = params
                .price_lots
                .checked_sub(position_state.entry_price)
                .ok_or(ProgramError::ArithmeticOverflow)?;

            let realized_pnl = if position_state.is_long() {
                (close_size as i128)
                    .checked_mul(price_diff as i128)
                    .ok_or(ProgramError::ArithmeticOverflow)?
                    .checked_mul(market_config_state.quote_lot_size as i128)
                    .ok_or(ProgramError::ArithmeticOverflow)? as i64
            } else {
                (close_size as i128)
                    .checked_mul(-price_diff as i128)
                    .ok_or(ProgramError::ArithmeticOverflow)?
                    .checked_mul(market_config_state.quote_lot_size as i128)
                    .ok_or(ProgramError::ArithmeticOverflow)? as i64
            };

            let margin_to_release = if close_size == position_state.size {
                position_state.initial_margin
            } else {
                (position_state.initial_margin as i128 * close_size as i128
                    / position_state.size as i128) as i64
            };

            user_account_state.collateral = user_account_state
                .collateral
                .checked_add(realized_pnl)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            user_account_state.margin_used = user_account_state
                .margin_used
                .saturating_sub(margin_to_release);

            let remaining_size = position_state
                .size
                .checked_sub(close_size)
                .ok_or(ProgramError::ArithmeticOverflow)?;

            if remaining_size == 0 {
                // fullly closed
                let flip_size = params
                    .base_lots
                    .checked_sub(close_size)
                    .ok_or(ProgramError::ArithmeticOverflow)?;

                if flip_size > 0 {
                    let new_margin =
                        market_config_state.required_initial_margin(flip_size, params.price_lots);
                    position_state.side = position_side;
                    position_state.size = flip_size;
                    position_state.entry_price = params.price_lots;
                    position_state.initial_margin = new_margin;
                    position_state.entry_funding_index = funding.cumulative_index;

                    user_account_state.margin_used = user_account_state
                        .margin_used
                        .checked_add(new_margin)
                        .ok_or(ProgramError::ArithmeticOverflow)?;
                } else {
                    position_state.size = 0;
                    position_state.initial_margin = 0;
                    user_account_state.position_count =
                        user_account_state.position_count.saturating_sub(1);
                }
            } else {
                position_state.size = remaining_size;
                position_state.initial_margin = position_state
                    .initial_margin
                    .checked_sub(margin_to_release)
                    .ok_or(ProgramError::ArithmeticOverflow)?;
            }
        }
    }
    Ok(())
}
