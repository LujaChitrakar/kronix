use bytemuck::{Pod, Zeroable};
use pinocchio::{
    AccountView, Address, ProgramResult,
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{Sysvar, rent::Rent},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{MARKET_SEED, MAX_OPEN_ORDERS, OPEN_ORDERS_SEED},
    helper::{
        verify_account_owner, verify_initialized, verify_pda, verify_program_id, verify_signer,
        verify_uninitialized,
    },
    states::{MarketState, OpenOrder, OpenOrdersAccount},
};

#[derive(Pod, Zeroable, Clone, Copy, PartialEq, Eq)]
#[repr(C)]
pub struct CreateOpenOrdersAccountParams {
    pub owner: [u8; 32],
    pub bump: u8,
    pub padding: [u8; 7],
}

pub fn process_create_open_orders_account(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        payer,
        open_orders_account,
        market,
        system_program,
        _remaining @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    verify_signer(payer)?;
    verify_initialized(market)?;
    verify_uninitialized(open_orders_account)?;
    verify_program_id(system_program, &pinocchio_system::ID)?;
    unsafe {
        verify_account_owner(market, &crate::ID)?;
    }

    let args = bytemuck::try_pod_read_unaligned::<CreateOpenOrdersAccountParams>(data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let bump_bytes = [args.bump];
    let owner = args.owner;

    // validation
    {
        let market_data = market.try_borrow()?;
        let market_state = bytemuck::from_bytes::<MarketState>(&market_data[..MarketState::LEN]);
        let market_bump = [market_state.bump];
        let market_index = market_state.market_index.to_le_bytes();

        verify_pda(
            market,
            &[MARKET_SEED, market_index.as_ref(), &market_bump],
            &crate::ID,
        )?;
        verify_pda(
            open_orders_account,
            &[
                OPEN_ORDERS_SEED,
                owner.as_ref(),
                market.address().as_array().as_ref(),
                &bump_bytes,
            ],
            &crate::ID,
        )?;
    }

    let signer_seeds = [
        Seed::from(OPEN_ORDERS_SEED),
        Seed::from(owner.as_ref()),
        Seed::from(market.address().as_array().as_ref()),
        Seed::from(&bump_bytes),
    ];

    let rent = Rent::get()?;
    CreateAccount {
        from: payer,
        to: open_orders_account,
        lamports: rent.try_minimum_balance(OpenOrdersAccount::LEN)?,
        space: OpenOrdersAccount::LEN as u64,
        owner: &Address::from(crate::ID),
    }
    .invoke_signed(&[Signer::from(&signer_seeds)])?;

    {
        let mut oo_accounts_data = open_orders_account.try_borrow_mut()?;
        let oo_account_state = bytemuck::from_bytes_mut::<OpenOrdersAccount>(
            &mut oo_accounts_data[..OpenOrdersAccount::LEN],
        );

        *oo_account_state = OpenOrdersAccount {
            owner,
            market: *market.address().as_array(),
            delegate: [0u8; 32],
            bump: args.bump,
            padding: [0u8; 7],
            open_orders: [OpenOrder::default(); MAX_OPEN_ORDERS],
            reserved: [0u8; 32],
        }
    }

    Ok(())
}
