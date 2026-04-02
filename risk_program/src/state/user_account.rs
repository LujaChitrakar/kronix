use bytemuck::{Pod, Zeroable};

#[derive(Pod, Zeroable, Copy, Clone)]
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
