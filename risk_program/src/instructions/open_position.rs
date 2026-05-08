use bytemuck::{Pod, Zeroable};
use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
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
    oracle::validate_switchboard_price,
    state::{FundingState, MarketConfig, Position, UserAccount},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct OpenPositionParams {
    pub size_lots: i64,    // base lots
    pub leverage_bps: u16, // e.g. 1000 = 10x
    pub market_index: u16,
    pub side: u8, // 0=long, 1=short
    pub bump_position: u8,
    pub bump_user: u8,
    pub padding: [u8; 1],
}

pub fn process_open_position(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, user_account, position, market_config, funding_state, oracle, system_program, _remaining @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;
    verify_initialized(user_account)?;
    verify_initialized(market_config)?;
    verify_initialized(funding_state)?;
    unsafe {
        verify_account_owner(user_account, &crate::ID)?;
        verify_account_owner(market_config, &crate::ID)?;
        verify_account_owner(funding_state, &crate::ID)?;
    }

    let params = bytemuck::try_pod_read_unaligned::<OpenPositionParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if params.size_lots <= 0 {
        return Err(RiskProgramError::InvalidAmount.into());
    }
    if params.side > 1 {
        return Err(RiskProgramError::InvalidSide.into());
    }

    let clock = Clock::get()?;
    let signer_key = signer.address().as_array();

    let market_config_data = market_config.try_borrow_mut()?;
    let market_config_state =
        bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);

    if market_config_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }

    let mark_price_native = validate_switchboard_price(oracle, params.market_index, clock.slot)?;
    let mark_price = market_config_state
        .native_price_to_lots(mark_price_native)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if mark_price <= 0 {
        return Err(RiskProgramError::InvalidOraclePrice.into());
    }

    // calculate required margin
    let required_margin = market_config_state.required_initial_margin(params.size_lots, mark_price);

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);
    if user_account_state.owner != *signer_key {
        return Err(RiskProgramError::InvalidOwner.into());
    }

    let funding_data = funding_state.try_borrow()?;
    let funding = bytemuck::from_bytes::<FundingState>(&funding_data[..FundingState::LEN]);
    if funding.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }

    let free_collateral = user_account_state.free_collateral();
    if required_margin > free_collateral {
        return Err(RiskProgramError::InsufficientCollateral.into());
    }

    let market_index_bytes = params.market_index.to_le_bytes();
    let position_bump_bytes = [params.bump_position];
    let user_bump_bytes = [params.bump_user];

    {
        verify_pda(
            position,
            &[
                POSITION_SEED,
                signer_key.as_ref(),
                market_index_bytes.as_ref(),
                &position_bump_bytes,
            ],
            &crate::ID,
        )?;
        verify_pda(
            user_account,
            &[USER_ACCOUNT_SEED, signer_key.as_ref(), &user_bump_bytes],
            &crate::ID,
        )?;
    }

    if !position.is_data_empty() {
        unsafe {
            verify_account_owner(position, &crate::ID)?;
        }
        let position_data = position.try_borrow()?;
        let existing_pos_state = bytemuck::from_bytes::<Position>(&position_data[..Position::LEN]);
        if existing_pos_state.size != 0 {
            return Err(RiskProgramError::PositionAlreadyOpen.into());
        }
        if existing_pos_state.owner != *signer_key {
            return Err(RiskProgramError::InvalidOwner.into());
        }
    }

    if position.is_data_empty() {
        let position_seeds = [
            Seed::from(POSITION_SEED),
            Seed::from(signer_key.as_ref()),
            Seed::from(market_index_bytes.as_ref()),
            Seed::from(&position_bump_bytes),
        ];

        CreateAccount {
            from: signer,
            to: position,
            space: Position::LEN as u64,
            lamports: Rent::get()?.try_minimum_balance(Position::LEN)?,
            owner: &Address::from(crate::ID),
        }
        .invoke_signed(&[Signer::from(&position_seeds)])?;
    }

    {
        let mut position_data = position.try_borrow_mut()?;
        let position_state =
            bytemuck::from_bytes_mut::<Position>(&mut position_data[..Position::LEN]);

        *position_state = Position {
            size: params.size_lots,
            entry_price: mark_price,
            entry_funding_index: funding.cumulative_index,
            initial_margin: required_margin,
            market_index: params.market_index,
            bump: params.bump_position,
            side: params.side,
            padding: [0; 4],
            owner: *signer_key,
            reserved: [0; 32],
        };
    }

    user_account_state.margin_used = user_account_state
        .margin_used
        .checked_add(required_margin)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    user_account_state.position_count = user_account_state
        .position_count
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    Ok(())
}
