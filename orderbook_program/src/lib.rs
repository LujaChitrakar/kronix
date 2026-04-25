#![allow(unexpected_cfgs)]

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;

pub mod constants;
pub mod cpi;
pub mod errors;
pub mod events;
pub mod helper;
pub mod instructions;
pub mod states;
pub mod utils;

#[cfg(test)]
pub mod tests;

pub const RISK_PROGRAM_ID: [u8; 32] =
    pinocchio_pubkey::from_str("C8kAYt7vpmFxhguEJxbg6hMZY3LLNYACrU8mKveZ8eMu");

pinocchio_pubkey::declare_id!("j8VeDggFuwtiCjM8uo7am8i1bWWH2sj7mBRxqTaZniU");

