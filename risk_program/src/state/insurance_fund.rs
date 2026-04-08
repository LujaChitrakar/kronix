use bytemuck::{Pod, Zeroable};
use shank::ShankAccount;

#[derive(Pod, Zeroable, Copy, Clone, ShankAccount)]
#[repr(C)]
pub struct InsuranceFund {
    pub balance: u64,         // USDC native units
    pub total_collected: u64, // lifetime fees collected
    pub total_paid_out: u64,  // lifetime bad debt covered
    pub bump: u8,
    pub padding: [u8; 7],
    pub reserved: [u8; 32],
}

const _: () = assert!(size_of::<InsuranceFund>() == 8 + 8 + 8 + 1 + 7 + 32);
const _: () = assert!(size_of::<InsuranceFund>() % 8 == 0);

impl InsuranceFund {
    pub const LEN: usize = size_of::<InsuranceFund>();

    pub fn collect(&mut self, amount: u64) {
        self.balance = self.balance.saturating_add(amount);
        self.total_collected = self.total_collected.saturating_add(amount);
    }

    /// Cover bad debt — called when liquidation proceeds < position loss
    /// Returns shortfall that could NOT be covered (triggers ADL if > 0)
    pub fn cover_bad_debt(&mut self, shortfall: u64) -> u64 {
        if self.balance >= shortfall {
            self.balance -= shortfall;
            self.total_paid_out = self.total_paid_out.saturating_add(shortfall);
            0 // fully covered
        } else {
            let covered = self.balance;
            self.total_paid_out = self.total_paid_out.saturating_add(covered);
            self.balance = 0;
            shortfall - covered // uncovered remainder → triggers ADL
        }
    }

    pub fn is_solvent(&self) -> bool {
        self.balance > 0
    }
}
