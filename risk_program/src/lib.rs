#![allow(unexpected_cfgs)]

#[cfg(not(feature="no-entrypoint"))]
mod entrypoint;

pub mod instructions;
pub mod state;
pub mod errors;
pub mod math;
pub mod oracle;
pub mod constants;

#[cfg(test)]
pub mod tests;

pinocchio_pubkey::declare_id!("2c88D4ELFGsJnxTvxWGY92GqcE7RNqXwXPMFjTXhnxLQ");