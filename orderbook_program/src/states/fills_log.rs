use bytemuck::{Pod, Zeroable};
use core::mem::size_of;
use shank::ShankAccount;

pub const MAX_FILLS_PER_LOG: usize = 8;
pub const MAX_SETTLE_SLOTS: u64 = 150; // ~60 seconds

#[derive(Pod, Zeroable, Copy, Clone, ShankAccount)]
#[repr(C)]
pub struct FillsLog {
    pub client_order_id: u64,
    pub created_slot: u64,
    pub fill_count: u8,
    pub all_settled: u8, // 0=pending, 1=ready for next order
    pub bump: u8,
    pub padding: [u8; 5],
    pub fills: [FillEntry; 8],
    pub market: [u8; 32],
    pub taker: [u8; 32],
    pub reserved: [u8; 32],
}

const _: () = assert!(size_of::<FillsLog>() % 8 == 0);

impl FillsLog {
    pub const LEN: usize = size_of::<FillsLog>();
    
    pub fn is_ready(&self, current_slot: u64) -> bool {
        if self.all_settled == 1 {
            return true;
        }
        // Timeout — previous fills abandoned, keeper missed them
        let slots_elapsed = current_slot.saturating_sub(self.created_slot);
        slots_elapsed > MAX_SETTLE_SLOTS
    }

    pub fn reset(&mut self, market: [u8; 32], taker: [u8; 32], client_order_id: u64, slot: u64) {
        self.market = market;
        self.taker = taker;
        self.client_order_id = client_order_id;
        self.created_slot = slot;
        self.fill_count = 0;
        self.all_settled = 0;
        self.fills = [FillEntry::zeroed(); MAX_FILLS_PER_LOG];
    }
}

#[derive(Pod, Zeroable, Copy, Clone)]
#[repr(C)]
pub struct FillEntry {
    pub taker_client_id: u64,
    pub maker_client_id: u64,
    pub price: i64,
    pub quantity: i64,
    pub taker_side: u8,
    pub maker_slot: u8,
    pub maker_out: u8,
    pub settled: u8, // 0=pending, 1=settled
    pub market_index: u16,
    pub padding: [u8; 2],
    pub taker_pubkey: [u8; 32],
    pub maker_pubkey: [u8; 32],
}

const _: () = assert!(size_of::<FillEntry>() == 8 + 8 + 8 + 8 + 1 + 1 + 1 + 1 + 2 + 2 + 32 + 32);
const _: () = assert!(size_of::<FillEntry>() % 8 == 0);
