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

pinocchio_pubkey::declare_id!("2c88D4ELFGsJnxTvxWGY92GqcE7RNqXwXPMFjTXhnxLQ");
