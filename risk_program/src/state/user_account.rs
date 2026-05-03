use bytemuck::{Pod, Zeroable};
use shank::ShankAccount;

#[derive(Pod, Zeroable, Copy, Clone, ShankAccount)]
#[repr(C)]
pub struct UserAccount {
    pub collateral: i64,  // total deposited USDC in native units
    pub margin_used: i64, // sum of initial margin across all positions
    pub bump: u8,
    pub position_count: u8, // active open positions
    pub padding: [u8; 6],
    pub owner: [u8; 32],
    pub reserved: [u8; 32],
}

const _: () = assert!(size_of::<UserAccount>() == 8 + 8 + 1 + 1 + 6 + 32 + 32);
const _: () = assert!(size_of::<UserAccount>() % 8 == 0);

impl UserAccount {
    pub const LEN: usize = size_of::<UserAccount>();

    pub fn free_collateral(&self) -> i64 {
        self.collateral.saturating_sub(self.margin_used)
    }

    pub fn reserved_order_margin(&self) -> i64 {
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&self.reserved[..8]);
        i64::from_le_bytes(bytes)
    }

    pub fn set_reserved_order_margin(&mut self, amount: i64) {
        self.reserved[..8].copy_from_slice(&amount.to_le_bytes());
    }

    pub fn reserve_order_margin(
        &mut self,
        amount: i64,
    ) -> Result<(), pinocchio::error::ProgramError> {
        let new_reserved = self
            .reserved_order_margin()
            .checked_add(amount)
            .ok_or(pinocchio::error::ProgramError::ArithmeticOverflow)?;
        self.margin_used = self
            .margin_used
            .checked_add(amount)
            .ok_or(pinocchio::error::ProgramError::ArithmeticOverflow)?;
        self.set_reserved_order_margin(new_reserved);
        Ok(())
    }

    pub fn release_order_margin(&mut self, amount: i64) {
        let reserved = self.reserved_order_margin();
        let release = amount.min(reserved).max(0);
        self.set_reserved_order_margin(reserved.saturating_sub(release));
        self.margin_used = self.margin_used.saturating_sub(release);
    }

    pub fn consume_reserved_order_margin(
        &mut self,
        required_margin: i64,
    ) -> Result<(), pinocchio::error::ProgramError> {
        let reserved = self.reserved_order_margin();
        let consumed = required_margin.min(reserved).max(0);
        self.set_reserved_order_margin(reserved.saturating_sub(consumed));

        let additional_margin = required_margin
            .checked_sub(consumed)
            .ok_or(pinocchio::error::ProgramError::ArithmeticOverflow)?;
        self.margin_used = self
            .margin_used
            .checked_add(additional_margin)
            .ok_or(pinocchio::error::ProgramError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn health_factor(&self) -> Option<i64> {
        if self.margin_used == 0 {
            return None;
        }
        Some((self.collateral as i128 * 100 / self.margin_used as i128) as i64)
    }

    pub fn is_healthy(&self, maintenance_margin: u16) -> bool {
        match self.health_factor() {
            None => true,
            Some(hf) => hf >= maintenance_margin as i64,
        }
    }
}
