use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};

use crate::{
    errors::TriggerProgramError,
    helpers::{verify_account_owner, verify_signer, verify_writtable},
    states::TriggerOrder,
};

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct EditTriggerParams {
    pub new_trigger_price: i64, // 0 = no change
    pub new_size_lots: i64,     // 0 = no change
    pub new_expiry: i64,        // -1 = no change, 0 = remove expiry
    pub padding: [u8; 8],
}

pub fn process_edit_trigger(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, trigger_order, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    unsafe {
        verify_account_owner(trigger_order, &crate::ID)?;
    }
    verify_writtable(trigger_order)?;

    let params = bytemuck::try_from_bytes::<EditTriggerParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let clock = Clock::get()?;

    let mut order_data = trigger_order.try_borrow_mut()?;
    let order = bytemuck::from_bytes_mut::<TriggerOrder>(&mut order_data[..TriggerOrder::LEN]);

    if order.owner != *signer.address().as_array() {
        return Err(TriggerProgramError::InvalidOwner.into());
    }

    if !order.is_active() {
        return Err(TriggerProgramError::TriggerNotActive.into());
    }

    if order.is_expired(clock.unix_timestamp) {
        order.status = 2; //CANCELED
        return Err(TriggerProgramError::TriggerExpired.into());
    }

    if params.new_trigger_price < 0 {
        return Err(TriggerProgramError::InvalidTriggerPrice.into());
    }
    if params.new_size_lots < 0 {
        return Err(TriggerProgramError::InvalidSize.into());
    }

    // Apply changes — 0 means no change except expiry
    if params.new_trigger_price > 0 {
        order.trigger_price = params.new_trigger_price;
    }
    if params.new_size_lots > 0 {
        order.size_lots = params.new_size_lots;
    }

    // expiry: -1 = no change, 0 = remove expiry, >0 = set new expiry
    if params.new_expiry == 0 {
        order.expiry = 0; // remove expiry — GTC
    } else if params.new_expiry > 0 {
        if params.new_expiry <= clock.unix_timestamp {
            return Err(TriggerProgramError::InvalidExpiry.into());
        }
        order.expiry = params.new_expiry;
    }
    // if new_expiry == -1: no change to expiry

    Ok(())
}
