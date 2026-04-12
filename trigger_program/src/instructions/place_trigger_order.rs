use bytemuck::{Pod, Zeroable};
use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::TRIGGER_ORDER_SEED,
    errors::TriggerProgramError,
    helpers::{verify_pda, verify_program_id, verify_signer, verify_uninitialized},
    states::TriggerOrder,
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct PlaceTriggerOrderParams {
    pub client_order_id: u64,
    pub trigger_price: i64,
    pub size_lots: i64,
    pub expiry: i64, // unix ts, 0 = never
    pub market_index: u16,
    pub trigger_type: u8, // 0=StopLoss, 1=TakeProfit
    pub side: u8,         // 0=Buy, 1=Sell
    pub bump: u8,
    pub padding: [u8; 3],
}

pub fn process_place_trigger_order(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, trigger_order, open_orders_account, system_program, _remaining @ ..] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_uninitialized(trigger_order)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;

    let params = bytemuck::try_from_bytes::<PlaceTriggerOrderParams>(data)
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

    {
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
    }
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

    Ok(())
}
