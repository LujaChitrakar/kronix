#![allow(unexpected_cfgs)]

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;

pub mod constants;
pub mod cpi;
pub mod errors;
pub mod helpers;
pub mod instructions;
pub mod oracle;
pub mod states;

pinocchio_pubkey::declare_id!("FBux8UY7koXsvDp3GThjvtiMo4GagsDdkPDbU4VbQzV2");
