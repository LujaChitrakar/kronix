use bytemuck::{Pod, Zeroable};
use shank::{ShankAccount};

#[derive(Pod, Zeroable, Copy, Clone, ShankAccount)]
#[repr(C)]
pub struct TriggerOrder {
    pub client_order_id: u64,
    pub trigger_price: i64, // price lots — fires at this level
    pub size_lots: i64,     // base lots to execute
    pub created_at: i64,
    pub expiry: i64, // 0 = no expiry
    pub market_index: u16,
    pub trigger_type: u8, // 0=StopLoss, 1=TakeProfit
    pub side: u8,         // 0=Buy, 1=Sell
    pub status: u8,       // 0=Active, 1=Executed, 2=Cancelled, 3=Paused
    pub bump: u8,
    pub padding: [u8; 2],
    pub owner: [u8; 32], // user who placed trigger
    pub open_orders_account: [u8; 32],
    pub reserved: [u8; 32],
}

const _: () =
    assert!(size_of::<TriggerOrder>() == 8 + 8 + 8 + 8 + 8 + 2 + 1 + 1 + 1 + 1 + 2 + 32 + 32 + 32);
const _: () = assert!(size_of::<TriggerOrder>() % 8 == 0);

impl TriggerOrder {
    pub const LEN: usize = size_of::<TriggerOrder>();

    pub fn is_active(&self) -> bool {
        self.status == 0
    }
    pub fn is_paused(&self) -> bool {
        self.status == 3
    }
    pub fn is_expired(&self, now_ts: i64) -> bool {
        self.expiry != 0 && now_ts >= self.expiry
    }

    /// Returns true if trigger should fire at given mark_price
    pub fn should_trigger(&self, mark_price: i64) -> bool {
        match (self.trigger_type, self.side) {
            // StopLoss Sell (Long SL)  — fire when price <= trigger_price
            (0, 1) => mark_price <= self.trigger_price,
            // TakeProfit Sell (Long TP) — fire when price >= trigger_price
            (1, 1) => mark_price >= self.trigger_price,
            // StopLoss Buy (Short SL)  — fire when price >= trigger_price
            (0, 0) => mark_price >= self.trigger_price,
            // TakeProfit Buy (Short TP) — fire when price <= trigger_price
            (1, 0) => mark_price <= self.trigger_price,
            _ => false,
        }
    }
}
