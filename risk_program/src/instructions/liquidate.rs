use bytemuck::{Pod, Zeroable};
use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;
use shank::ShankType;

use crate::{
    constants::VAULT_AUTHORITY_SEED,
    errors::RiskProgramError,
    helper::{verify_account_owner, verify_program_id, verify_signer, verify_writtable},
    instructions::settle_funding_internal,
    oracle::validate_pyth_price,
    state::{FundingState, InsuranceFund, MarketConfig, Position, UserAccount},
};

// CALLED BY Crankers
#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct LiquidateParams {
    pub market_index: u16,
    pub bump_authority: u8,
    pub padding: [u8; 5],
}

pub fn process_liquidate(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        liquidator,   // permissionless bot — any signer
        user_account, // account being liquidated
        position,     // position being liquidated
        market_config,
        funding_state,
        insurance_fund,
        vault,
        vault_authority,
        liquidator_token_account,
        oracle,
        token_program,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(liquidator)?;
    verify_program_id(token_program, &pinocchio_token::ID)?;
    // ── Owner checks ──────────────────────────────────────────────
    unsafe {
        verify_account_owner(user_account, &crate::ID)?;
        verify_account_owner(position, &crate::ID)?;
        verify_account_owner(market_config, &crate::ID)?;
        verify_account_owner(funding_state, &crate::ID)?;
        verify_account_owner(insurance_fund, &crate::ID)?;
        verify_writtable(user_account)?;
        verify_writtable(position)?;
        verify_writtable(insurance_fund)?;
    }

    let params = bytemuck::try_pod_read_unaligned::<LiquidateParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let clock = Clock::get()?;

    let market_config_data = market_config.try_borrow()?;
    let market_config_state =
        bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);

    if market_config_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }
    // uncommet during oracle fixed
    let mark_price = validate_pyth_price(oracle, clock.unix_timestamp)?;
    // let mark_price = validated.price;
    // let mark_price: i64 = 100;

    let mut position_data = position.try_borrow_mut()?;
    let position_state = bytemuck::from_bytes_mut::<Position>(&mut position_data[..Position::LEN]);

    if position_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }
    if position_state.size == 0 {
        return Err(RiskProgramError::InvalidPositionSize.into());
    }

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    if user_account_state.owner != position_state.owner {
        return Err(RiskProgramError::InvalidOwner.into());
    }

    let mut funding_data = funding_state.try_borrow_mut()?;
    let funding = bytemuck::from_bytes_mut::<FundingState>(&mut funding_data[..FundingState::LEN]);

    settle_funding_internal(
        user_account_state,
        position_state,
        funding,
        market_config_state.quote_lot_size,
    )?;

    // health check
    let maintenance_margin =
        market_config_state.required_maintenance_margin(position_state.size, mark_price);

    let unrealised_pnl =
        position_state.unrealised_pnl(mark_price, market_config_state.quote_lot_size);

    let equity = user_account_state
        .collateral
        .checked_add(unrealised_pnl)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    if equity >= maintenance_margin {
        return Err(RiskProgramError::NotLiquidatable.into());
    }

    let total_fee = market_config_state.liquidation_fee(position_state.size, mark_price);

    // Split fee
    // 75% → liquidator reward
    // 20% → insurance fund
    // 5%  → protocol
    let liquidator_reward = (total_fee as i128 * 75 / 100) as u64;
    let insurance_fee = total_fee as i128 * 25 / 100;

    let collateral = user_account_state.collateral;
    let is_solvent = collateral >= total_fee;

    let mut insurance_data = insurance_fund.try_borrow_mut()?;
    let insurance_state =
        bytemuck::from_bytes_mut::<InsuranceFund>(&mut insurance_data[..InsuranceFund::LEN]);

    let vault_authority_bump = [params.bump_authority];
    let vault_authority_seed = [
        Seed::from(VAULT_AUTHORITY_SEED),
        Seed::from(vault_authority_bump.as_ref()),
    ];
    if is_solvent {
        // deduct full fee from user_collateral
        user_account_state.collateral = user_account_state
            .collateral
            .checked_sub(total_fee)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // insurance fund collect its share
        insurance_state.collect(insurance_fee as u64);

        log!("insurance collected: {}", insurance_fee);
        log!("insurance balance after: {}", insurance_state.balance);

        Transfer {
            from: vault,
            to: liquidator_token_account,
            authority: vault_authority,
            amount: liquidator_reward,
        }
        .invoke_signed(&[Signer::from(&vault_authority_seed)])?;
    } else {
        // bad debt
        let shortfall = (total_fee - collateral).max(0) as u64;

        let uncovered = insurance_state.cover_bad_debt(shortfall);
        user_account_state.collateral = 0;

        if uncovered > 0 {
            // Insurance fund depleted — trigger ADL
            // For now: emit error so off-chain can trigger ADL
            // In v2: on-chain ADL against most profitable position
            return Err(RiskProgramError::InsuranceFundDepleted.into());
        }
    }

    user_account_state.margin_used = user_account_state
        .margin_used
        .saturating_sub(position_state.initial_margin);
    user_account_state.position_count = user_account_state.position_count.saturating_sub(1);

    position_state.size = 0;
    position_state.initial_margin = 0;
    Ok(())
}
