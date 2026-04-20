use pinocchio::{error::ProgramError, AccountView, ProgramResult};

use crate::{
    errors::TriggerProgramError,
    helpers::{close_account, verify_account_owner, verify_signer, verify_writtable},
    states::TriggerOrder,
};

pub fn process_cancel_trigger_order(accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    let [signer, trigger_order, _remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    verify_signer(signer)?;
    unsafe {
        verify_account_owner(trigger_order, &crate::ID)?;
    }
    verify_writtable(trigger_order)?;

    let mut data = trigger_order.try_borrow_mut()?;
    let order = bytemuck::from_bytes_mut::<TriggerOrder>(&mut data[..TriggerOrder::LEN]);

    if order.owner != *signer.address().as_array() {
        return Err(TriggerProgramError::InvalidOwner.into());
    }
    if !order.is_active() {
        return Err(TriggerProgramError::TriggerNotActive.into());
    }
    order.status = 2; // Cancelled

    drop(data);

    close_account(trigger_order, signer)?;

    Ok(())
}
