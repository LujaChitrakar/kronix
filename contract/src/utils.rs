macro_rules! impl_load {
    ($t:ty) => {
        impl $t {
            pub const LEN: usize = core::mem::size_of::<Self>();

            #[inline(always)]
            pub fn load(data: &[u8]) -> Result<&Self, pinocchio::error::ProgramError> {
                if data.len() != Self::LEN {
                    return Err(pinocchio::error::ProgramError::InvalidAccountData);
                }

                Ok(unsafe { &*(data.as_ptr() as *const Self) })
            }

            #[inline(always)]
            pub fn load_mut(data: &mut [u8]) -> Result<&mut Self, pinocchio::error::ProgramError> {
                if data.len() != Self::LEN
                    || (data.as_ptr() as usize) % core::mem::align_of::<Self>() != 0
                {
                    return Err(pinocchio::error::ProgramError::InvalidAccountData);
                }

                Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
            }
        }
    };
}

macro_rules! check_ata {
    ($ata:expr,$owner:expr,$mint:expr) => {
        let ata_state = TokenAccount::from_account_view($ata)?;
        if ata_state.owner() != $owner.address() || ata_state.mint() != $mint.address() {
            return Err(ProgramError::InvalidAccountData);
        }
    };
}

pub(crate) use check_ata;
pub(crate) use impl_load;
