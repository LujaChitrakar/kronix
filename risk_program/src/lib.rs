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

pub const ORDERBOOK_PROGRAM_ID: [u8; 32] =
    pinocchio_pubkey::from_str("2c88D4ELFGsJnxTvxWGY92GqcE7RNqXwXPMFjTXhnxLQ");

pinocchio_pubkey::declare_id!("2c88D4ELFGsJnxTvxWGY92GqcE7RNqXwXPMFjTXhnxLQ");
