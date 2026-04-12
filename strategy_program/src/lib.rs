#![allow(unexpected_cfgs)]

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;

pub mod constants;
pub mod cpi;
pub mod errors;
pub mod helpers;
pub mod instructions;
pub mod states;

pinocchio_pubkey::declare_id!("5uPoD26g3gKYFhYR4poXe4oxHATBnWb3CUoGue9vaCpa");
