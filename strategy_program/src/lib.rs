#![allow(unexpected_cfgs)]

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;

pub mod constants;
pub mod cpi;
pub mod errors;
pub mod helpers;
pub mod instructions;
pub mod states;

pinocchio_pubkey::declare_id!("7jUHqPKWF4ebe4gSRMwy1FfAWyuiQjpjTdzqtbMK6S9q");
