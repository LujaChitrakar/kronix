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

pinocchio_pubkey::declare_id!("j8VeDggFuwtiCjM8uo7am8i1bWWH2sj7mBRxqTaZniU");
