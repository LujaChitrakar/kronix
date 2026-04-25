#![allow(unexpected_cfgs)]

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;

pub mod constants;
pub mod errors;
pub mod helper;
pub mod instructions;
pub mod math;
pub mod oracle;
pub mod state;

#[cfg(test)]
pub mod tests;

// pub const ORDERBOOK_PROGRAM_ID: [u8; 32] =
//     pinocchio_pubkey::from_str("j8VeDggFuwtiCjM8uo7am8i1bWWH2sj7mBRxqTaZniU");

pinocchio_pubkey::declare_id!("C8kAYt7vpmFxhguEJxbg6hMZY3LLNYACrU8mKveZ8eMu");
