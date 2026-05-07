use pinocchio::{AccountView, ProgramResult};

pub unsafe fn verify_account_owner(
    account: &AccountView,
    expected_owner: &[u8; 32],
) -> ProgramResult {
    if account.owner().as_array() != expected_owner {
        return Err(pinocchio::error::ProgramError::InvalidAccountOwner);
    }
    Ok(())
}

pub fn verify_signer(account: &AccountView) -> ProgramResult {
    if !account.is_signer() {
        return Err(pinocchio::error::ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

pub fn verify_writtable(account: &AccountView) -> ProgramResult {
    if !account.is_writable() {
        return Err(pinocchio::error::ProgramError::InvalidAccountData);
    }
    Ok(())
}

pub fn verify_uninitialized(account: &AccountView) -> ProgramResult {
    if !account.is_data_empty() {
        return Err(pinocchio::error::ProgramError::AccountAlreadyInitialized);
    }
    Ok(())
}

pub fn verify_initialized(account: &AccountView) -> ProgramResult {
    if account.is_data_empty() {
        return Err(pinocchio::error::ProgramError::UninitializedAccount);
    }
    Ok(())
}

pub fn verify_pda<const N: usize>(
    account: &AccountView,
    seeds: &[&[u8]; N],
    program_id: &[u8; 32],
) -> ProgramResult {
    let derived = pinocchio_pubkey::derive_address(seeds, None, program_id);
    if derived != *account.address().as_array() {
        return Err(pinocchio::error::ProgramError::InvalidAccountData);
    }
    Ok(())
}

pub fn verify_ix_data_len<T>(data: &[u8]) -> ProgramResult {
    if data.len() != core::mem::size_of::<T>() {
        return Err(pinocchio::error::ProgramError::InvalidInstructionData);
    }
    Ok(())
}

pub fn verify_program_id(account: &AccountView, expected: &pinocchio::Address) -> ProgramResult {
    if account.address() != expected {
        return Err(pinocchio::error::ProgramError::IncorrectProgramId);
    }
    Ok(())
}

pub fn close_account(account: &AccountView, destination: &AccountView) -> ProgramResult {
    let account_lamports = account.lamports();
    let dest_lamports = destination.lamports();
    destination.set_lamports(
        dest_lamports
            .checked_add(account_lamports)
            .ok_or(pinocchio::error::ProgramError::ArithmeticOverflow)?,
    );
    account.set_lamports(0);
    let mut data = account.try_borrow_mut()?;
    data.fill(0);
    Ok(())
}
