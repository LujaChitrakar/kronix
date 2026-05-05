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
    constants::{STRATEGY_AUTHORITY_SEED, STRATEGY_SEED},
    cpi::{initialize_fills_log_cpi, set_delegate_cpi},
    errors::StrategyProgramError,
    helpers::{
        verify_initialized, verify_pda, verify_program_id, verify_signer, verify_uninitialized,
    },
    states::{StrategyAccount, StrategyParams},
};

// OpenOrdersAccount.delegate offset (owner @0, market @32, delegate @64)
const OO_DELEGATE_OFFSET: usize = 64;

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct CreateStrategyParams {
    pub client_order_id: u64,
    pub size_lots: i64,
    pub limit_price_lots: i64,
    pub take_profit_price: i64,
    pub stop_loss_price: i64,
    pub cooldown_secs: u64,
    pub max_executions_per_day: u64,
    pub market_index: u16,
    pub bump: u8,
    pub strategy_type: u8,
    pub side: u8,
    pub bump_authority: u8,
    pub bump_fills_log: u8,
    pub leverage: u8,
    pub params: StrategyParams,
}

pub fn process_create_strategy(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, strategy_account, strategy_authority, open_orders_account, fills_log, market, orderbook_program, system_program, _remaining @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_uninitialized(strategy_account)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;
    verify_initialized(open_orders_account)?;

    let params = bytemuck::try_pod_read_unaligned::<CreateStrategyParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if params.size_lots <= 0 {
        return Err(StrategyProgramError::InvalidSize.into());
    }
    if params.strategy_type > 4 {
        return Err(StrategyProgramError::InvalidStrategyType.into());
    }
    if params.leverage == 0 || params.leverage > 10 {
        return Err(StrategyProgramError::InvalidSize.into());
    }

    let signer_key = signer.address().as_array();
    let bump_bytes = [params.bump];
    let market_index_bytes = params.market_index.to_le_bytes();
    let strategy_type_bytes = params.strategy_type.to_le_bytes();
    let clock = Clock::get()?;

    verify_pda(
        strategy_account,
        &[
            STRATEGY_SEED,
            signer_key.as_ref(),
            market_index_bytes.as_ref(),
            &strategy_type_bytes,
            &bump_bytes,
        ],
        &crate::ID,
    )?;

    let authority_bump_bytes = [params.bump_authority];
    verify_pda(
        strategy_authority,
        &[
            STRATEGY_AUTHORITY_SEED,
            signer_key.as_ref(),
            &authority_bump_bytes,
        ],
        &crate::ID,
    )?;

    let seeds = [
        Seed::from(STRATEGY_SEED),
        Seed::from(signer_key.as_ref()),
        Seed::from(market_index_bytes.as_ref()),
        Seed::from(strategy_type_bytes.as_ref()),
        Seed::from(bump_bytes.as_ref()),
    ];

    CreateAccount {
        from: signer,
        to: strategy_account,
        lamports: Rent::get()?.try_minimum_balance(StrategyAccount::LEN)?,
        space: StrategyAccount::LEN as u64,
        owner: &Address::from(crate::ID),
    }
    .invoke_signed(&[Signer::from(&seeds)])?;

    {
        let mut acc_data = strategy_account.try_borrow_mut()?;
        let strategy =
            bytemuck::from_bytes_mut::<StrategyAccount>(&mut acc_data[..StrategyAccount::LEN]);
        *strategy = StrategyAccount {
            client_order_id: params.client_order_id,
            take_profit_price: params.take_profit_price,
            stop_loss_price: params.stop_loss_price,
            size_lots: params.size_lots,
            limit_price_lots: params.limit_price_lots,
            created_at: clock.unix_timestamp,
            day_start_ts: clock.unix_timestamp,
            last_executed_ts: 0,
            strategy_type: params.strategy_type,
            status: 0, // Active
            bump: params.bump,
            side: params.side,
            max_executions_per_day: params.max_executions_per_day,
            cooldown_secs: params.cooldown_secs,
            executions_today: 0,
            market_index: params.market_index,
            leverage: params.leverage,
            padding: [0; 1],
            params: params.params,
            owner: *signer_key,
            reserved: [0; 32],
        };
    }

    initialize_fills_log_cpi(
        orderbook_program,
        system_program,
        signer,
        strategy_authority,
        fills_log,
        market,
        params.client_order_id,
        params.bump_fills_log,
    )?;

    let strategy_authority_key: [u8; 32] = *strategy_authority.address().as_array();
    let needs_delegate_set = {
        let oo_data = open_orders_account.try_borrow()?;
        let current = &oo_data[OO_DELEGATE_OFFSET..OO_DELEGATE_OFFSET + 32];
        current != strategy_authority_key.as_ref()
    };
    if needs_delegate_set {
        set_delegate_cpi(
            orderbook_program,
            signer,
            open_orders_account,
            strategy_authority_key,
        )?;
    }

    Ok(())
}
