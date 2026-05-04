use bytemuck::{Pod, Zeroable};
use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use shank::ShankType;

use crate::{
    constants::{
        OPEN_ORDERS_AUTHORITY_BYTES, OPEN_ORDERS_DELEGATE_OFFSET, OPEN_ORDERS_OWNER_OFFSET,
        ORDERBOOK_PROGRAM_ID, STRATEGY_AUTHORITY_SEED, STRATEGY_PROGRAM_ID,
        TRIGGER_AUTHORITY_SEED, TRIGGER_PROGRAM_ID, USER_ACCOUNT_SEED,
    },
    errors::RiskProgramError,
    helper::{
        verify_account_owner, verify_initialized, verify_pda, verify_signer, verify_writtable,
    },
    state::{MarketConfig, UserAccount, QUOTE_NATIVE_UNIT},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct OrderMarginParams {
    pub quote_lots: i64,
    pub margin_amount: i64,
    pub market_index: u16,
    pub leverage: u8,
    pub bump_user: u8,
    pub padding: [u8; 4],
    pub owner: [u8; 32],
}

fn div_ceil_i128(numerator: i128, denominator: i128) -> Result<i128, ProgramError> {
    numerator
        .checked_add(denominator - 1)
        .ok_or(ProgramError::ArithmeticOverflow)?
        .checked_div(denominator)
        .ok_or(ProgramError::ArithmeticOverflow)
}

fn order_margin_amount(
    market: &MarketConfig,
    quote_lots: i64,
    leverage: u8,
) -> Result<i64, ProgramError> {
    if quote_lots <= 0 {
        return Err(RiskProgramError::InvalidAmount.into());
    }
    let max_leverage = market.max_leverage.min(10);
    if leverage == 0 || max_leverage == 0 || leverage > max_leverage {
        return Err(RiskProgramError::ExceedsMaxLeverage.into());
    }

    let notional = (quote_lots as i128)
        .checked_mul(QUOTE_NATIVE_UNIT)
        .ok_or(RiskProgramError::InsufficientCollateral)?;

    let required = div_ceil_i128(notional, leverage as i128)?;
    let minimum = div_ceil_i128(notional, max_leverage as i128)?;
    if required < minimum || required <= 0 {
        return Err(RiskProgramError::InsufficientCollateral.into());
    }

    i64::try_from(required).map_err(|_| RiskProgramError::InsufficientCollateral.into())
}

fn verify_margin_authority(
    signer: &AccountView,
    params: &OrderMarginParams,
    remaining: &[AccountView],
) -> ProgramResult {
    if signer.address().as_array() == &params.owner {
        return Ok(());
    }

    let signer_key = signer.address().as_array();
    for bump in (0..=u8::MAX).rev() {
        let derived = pinocchio_pubkey::derive_address(
            &[TRIGGER_AUTHORITY_SEED, params.owner.as_ref()],
            Some(bump),
            &TRIGGER_PROGRAM_ID,
        );
        if &derived == signer_key {
            return Ok(());
        }

        let derived = pinocchio_pubkey::derive_address(
            &[STRATEGY_AUTHORITY_SEED, params.owner.as_ref()],
            Some(bump),
            &STRATEGY_PROGRAM_ID,
        );
        if &derived == signer_key {
            return Ok(());
        }
    }

    let open_orders_account = remaining.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    verify_initialized(open_orders_account)?;
    unsafe {
        verify_account_owner(open_orders_account, &ORDERBOOK_PROGRAM_ID)?;
    }

    let data = open_orders_account.try_borrow()?;
    if data.len() < OPEN_ORDERS_AUTHORITY_BYTES {
        return Err(ProgramError::InvalidAccountData);
    }

    if &data[OPEN_ORDERS_OWNER_OFFSET..OPEN_ORDERS_OWNER_OFFSET + 32] != params.owner.as_ref() {
        return Err(RiskProgramError::InvalidOwner.into());
    }

    let delegate =
        &data[OPEN_ORDERS_DELEGATE_OFFSET..OPEN_ORDERS_DELEGATE_OFFSET + 32];
    if delegate == [0u8; 32].as_ref() || delegate != signer_key.as_ref() {
        return Err(RiskProgramError::InvalidOwner.into());
    }

    Ok(())
}

fn load_accounts<'a>(
    accounts: &'a [AccountView],
    data: &[u8],
) -> Result<
    (
        &'a AccountView,
        &'a AccountView,
        &'a AccountView,
        OrderMarginParams,
    ),
    ProgramError,
> {
    let [signer, user_account, market_config, remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_initialized(user_account)?;
    verify_initialized(market_config)?;
    verify_writtable(user_account)?;

    unsafe {
        verify_account_owner(user_account, &crate::ID)?;
        verify_account_owner(market_config, &crate::ID)?;
    }

    let params = bytemuck::try_pod_read_unaligned::<OrderMarginParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    verify_margin_authority(signer, &params, remaining)?;

    {
        let user_account_data = user_account.try_borrow()?;
        let user_account_state =
            bytemuck::from_bytes::<UserAccount>(&user_account_data[..UserAccount::LEN]);

        if user_account_state.owner != params.owner {
            return Err(RiskProgramError::InvalidOwner.into());
        }

        verify_pda(
            user_account,
            &[
                USER_ACCOUNT_SEED,
                params.owner.as_ref(),
                &[user_account_state.bump],
            ],
            &crate::ID,
        )?;
    }

    Ok((signer, user_account, market_config, params))
}

pub fn process_reserve_order_margin(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let (_signer, user_account, market_config, params) = load_accounts(accounts, data)?;

    let market_config_data = market_config.try_borrow()?;
    let market_config_state =
        bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);

    if market_config_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }

    let required_margin =
        order_margin_amount(market_config_state, params.quote_lots, params.leverage)?;

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    if required_margin > user_account_state.free_collateral() {
        return Err(RiskProgramError::InsufficientCollateral.into());
    }

    user_account_state.reserve_order_margin(required_margin)
}

pub fn process_release_order_margin(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let (_signer, user_account, market_config, params) = load_accounts(accounts, data)?;

    let market_config_data = market_config.try_borrow()?;
    let market_config_state =
        bytemuck::from_bytes::<MarketConfig>(&market_config_data[..MarketConfig::LEN]);

    if market_config_state.market_index != params.market_index {
        return Err(RiskProgramError::InvalidMarketIndex.into());
    }

    if params.margin_amount <= 0 {
        return Err(RiskProgramError::InvalidAmount.into());
    }

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    user_account_state.release_order_margin(params.margin_amount);
    Ok(())
}
