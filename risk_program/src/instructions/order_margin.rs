use bytemuck::{Pod, Zeroable};
use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use shank::ShankType;

use crate::{
    constants::USER_ACCOUNT_SEED,
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
    pub market_index: u16,
    pub bump_user: u8,
    pub padding: [u8; 5],
    pub owner: [u8; 32],
}

fn order_margin_amount(_market: &MarketConfig, quote_lots: i64) -> Result<i64, ProgramError> {
    if quote_lots <= 0 {
        return Err(RiskProgramError::InvalidAmount.into());
    }

    let notional = (quote_lots as i128)
        .checked_mul(QUOTE_NATIVE_UNIT)
        .ok_or(RiskProgramError::InsufficientCollateral)?;

    i64::try_from(notional).map_err(|_| RiskProgramError::InsufficientCollateral.into())
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
    let [signer, user_account, market_config, _remaining @ ..] = accounts else {
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

    if signer.address().as_array() != &params.owner {
        return Err(RiskProgramError::InvalidOwner.into());
    }

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

    let required_margin = order_margin_amount(market_config_state, params.quote_lots)?;

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

    let release_margin = order_margin_amount(market_config_state, params.quote_lots)?;

    let mut user_account_data = user_account.try_borrow_mut()?;
    let user_account_state =
        bytemuck::from_bytes_mut::<UserAccount>(&mut user_account_data[..UserAccount::LEN]);

    user_account_state.release_order_margin(release_margin);
    Ok(())
}
