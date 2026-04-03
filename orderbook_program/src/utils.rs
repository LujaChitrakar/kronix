use pinocchio::{error::ProgramError, AccountView};

pub trait DataLen {
    const LEN: usize;
}
pub trait Initialized {
    fn is_initialized(&self) -> bool;
}

#[inline(always)]
pub unsafe fn load_acc_unchecked<T: DataLen>(bytes: &[u8]) -> Result<&T, ProgramError> {
    if bytes.len() != T::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(&*(bytes.as_ptr() as *const T))
}

#[inline(always)]
pub unsafe fn load_acc<T: DataLen + Initialized>(bytes: &[u8]) -> Result<&T, ProgramError> {
    load_acc_unchecked::<T>(bytes).and_then(|acc| {
        if acc.is_initialized() {
            Ok(acc)
        } else {
            Err(ProgramError::UninitializedAccount)
        }
    })
}

#[inline(always)]
pub unsafe fn load_acc_mut_unchecked<T: DataLen>(bytes: &mut [u8]) -> Result<&mut T, ProgramError> {
    if bytes.len() != T::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(&mut *{ bytes.as_mut_ptr() as *mut T })
}

#[inline(always)]
pub unsafe fn load_acc_mut<T: DataLen + Initialized>(
    bytes: &mut [u8],
) -> Result<&mut T, ProgramError> {
    load_acc_mut_unchecked::<T>(bytes).and_then(|acc| {
        if acc.is_initialized() {
            Ok(acc)
        } else {
            Err(ProgramError::UninitializedAccount)
        }
    })
}

#[inline(always)]
pub unsafe fn load_ix_data<T: DataLen>(bytes: &[u8]) -> Result<&T, ProgramError> {
    if bytes.len() != T::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(&*(bytes.as_ptr() as *const T))
}

#[inline(always)]
pub unsafe fn load_ix_data_mut<T: DataLen>(bytes: &mut [u8]) -> Result<&mut T, ProgramError> {
    if bytes.len() != T::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(&mut *(bytes.as_mut_ptr() as *mut T))
}

#[inline(always)]
pub unsafe fn to_bytes<T: DataLen>(data: &T) -> &[u8] {
    core::slice::from_raw_parts(data as *const T as *const u8, T::LEN)
}

#[inline(always)]
pub unsafe fn to_mut_bytes<T: DataLen>(data: &mut T) -> &mut [u8] {
    core::slice::from_raw_parts_mut(data as *mut T as *mut u8, T::LEN)
}

#[inline(always)]
pub unsafe fn try_from_account_info<T: DataLen>(acc: &AccountView) -> Result<&T, ProgramError> {
    if acc.owner().as_array() != &crate::ID {
        return Err(ProgramError::IllegalOwner);
    }
    let bytes = acc.try_borrow()?;

    if bytes.len() != T::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(&*(bytes.as_ptr() as *const T))
}

#[inline(always)]
pub unsafe fn try_from_account_info_mut<T: DataLen>(
    acc: &mut AccountView,
) -> Result<&mut T, ProgramError> {
    if acc.owner().as_array() != &crate::ID {
        return Err(ProgramError::IllegalOwner);
    }
    let mut bytes = acc.try_borrow_mut()?;

    if bytes.len() != T::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(&mut *(bytes.as_mut_ptr() as *mut T))
}

macro_rules! check_ata {
    ($ata:expr,$owner:expr,$mint:expr) => {
        let ata_state = pinocchio_token::state::TokenAccount::from_account_view($ata)?;
        if ata_state.owner() != $owner.address() || ata_state.mint() != $mint.address() {
            return Err(ProgramError::InvalidAccountData);
        }
    };
}

pub(crate) use check_ata;
