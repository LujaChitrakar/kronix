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
    constants::{TRIGGER_AUTHORITY_SEED, TRIGGER_ORDER_SEED},
    cpi::{initialize_fills_log_cpi, set_delegate_cpi},
    errors::TriggerProgramError,
    helpers::{
        verify_initialized, verify_pda, verify_program_id, verify_signer, verify_uninitialized,
    },
    states::TriggerOrder,
};

// OpenOrdersAccount.delegate offset (owner @0, market @32, delegate @64)
const OO_DELEGATE_OFFSET: usize = 64;

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct PlaceTriggerOrderParams {
    pub client_order_id: u64,
    pub trigger_price: i64,
    pub size_lots: i64,
    pub expiry: i64, // unix ts, 0 = never
    pub market_index: u16,
    pub trigger_type: u8, // 0=StopLoss, 1=TakeProfit
    pub side: u8,         // 0=Buy, 1=Sell
    pub bump: u8,         // trigger_order PDA bump
    pub bump_authority: u8,
    pub bump_fills_log: u8,
    pub padding: [u8; 1],
}

pub fn process_place_trigger_order(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, trigger_order, open_orders_account, trigger_authority, fills_log, market, orderbook_program, system_program, _remaining @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_uninitialized(trigger_order)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;
    verify_initialized(open_orders_account)?;

    let params = bytemuck::try_pod_read_unaligned::<PlaceTriggerOrderParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if params.size_lots <= 0 {
        return Err(TriggerProgramError::InvalidSize.into());
    }
    if params.trigger_price <= 0 {
        return Err(TriggerProgramError::InvalidTriggerPrice.into());
    }
    if params.trigger_type > 1 || params.side > 1 {
        return Err(TriggerProgramError::InvalidTriggerType.into());
    }

    let clock = Clock::get()?;
    let signer_key = signer.address().as_array();
    let bump_bytes = [params.bump];
    let client_id_bytes = params.client_order_id.to_le_bytes();

    verify_pda(
        trigger_order,
        &[
            TRIGGER_ORDER_SEED,
            signer_key.as_ref(),
            client_id_bytes.as_ref(),
            &bump_bytes,
        ],
        &crate::ID,
    )?;

    let authority_bump_bytes = [params.bump_authority];
    verify_pda(
        trigger_authority,
        &[
            TRIGGER_AUTHORITY_SEED,
            signer_key.as_ref(),
            &authority_bump_bytes,
        ],
        &crate::ID,
    )?;

    let seeds = [
        Seed::from(TRIGGER_ORDER_SEED),
        Seed::from(signer_key.as_ref()),
        Seed::from(client_id_bytes.as_ref()),
        Seed::from(bump_bytes.as_ref()),
    ];

    CreateAccount {
        from: signer,
        to: trigger_order,
        lamports: Rent::get()?.try_minimum_balance(TriggerOrder::LEN)?,
        space: TriggerOrder::LEN as u64,
        owner: &Address::from(crate::ID),
    }
    .invoke_signed(&[Signer::from(&seeds)])?;

    {
        let mut data = trigger_order.try_borrow_mut()?;
        let order = bytemuck::from_bytes_mut::<TriggerOrder>(&mut data[..TriggerOrder::LEN]);
        *order = TriggerOrder {
            client_order_id: params.client_order_id,
            trigger_price: params.trigger_price,
            size_lots: params.size_lots,
            created_at: clock.unix_timestamp,
            expiry: params.expiry,
            market_index: params.market_index,
            trigger_type: params.trigger_type,
            side: params.side,
            status: 0, // Active
            bump: params.bump,
            padding: [0; 2],
            owner: *signer_key,
            open_orders_account: *open_orders_account.address().as_array(),
            reserved: [0; 32],
        };
    }

    initialize_fills_log_cpi(
        orderbook_program,
        system_program,
        signer,
        trigger_authority,
        fills_log,
        market,
        params.client_order_id,
        params.bump_fills_log,
    )?;

    let trigger_authority_key: [u8; 32] = *trigger_authority.address().as_array();
    let needs_delegate_set = {
        let oo_data = open_orders_account.try_borrow()?;
        let current = &oo_data[OO_DELEGATE_OFFSET..OO_DELEGATE_OFFSET + 32];
        current != trigger_authority_key.as_ref()
    };
    if needs_delegate_set {
        set_delegate_cpi(
            orderbook_program,
            signer,
            open_orders_account,
            trigger_authority_key,
        )?;
    }

    Ok(())
}
