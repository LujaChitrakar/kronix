use bytemuck::{Pod, Zeroable};
use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use shank::ShankType;

use crate::{
    errors::OrderBookError,
    helper::{verify_account_owner, verify_initialized, verify_signer},
    states::OpenOrdersAccount,
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct SetDelegateParams {
    pub delegate: [u8; 32], // set to [0;32] to remove delegate
}

pub fn process_set_delegate(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        signer,              // must be oo_account.owner
        open_orders_account,
        _remaining @ ..,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_initialized(open_orders_account)?;
    unsafe { verify_account_owner(open_orders_account, &crate::ID)? };

    let mut oo_data = open_orders_account.try_borrow_mut()?;
    let oo = bytemuck::from_bytes_mut::<OpenOrdersAccount>(&mut oo_data[..OpenOrdersAccount::LEN]);

    // Only owner can set delegate
    if oo.owner != *signer.address().as_array() {
        return Err(OrderBookError::InvalidOwner.into());
    }

    let params = bytemuck::try_pod_read_unaligned::<SetDelegateParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    oo.delegate = params.delegate;
    Ok(())
}
