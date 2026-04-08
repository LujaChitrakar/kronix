use bytemuck::{Pod, Zeroable};
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use shank::ShankType;

use crate::{
    constants::{MARKET_SEED, OPEN_ORDERS_SEED},
    cpi::settle_fill_cpi,
    errors::OrderBookError,
    helper::{
        verify_account_owner, verify_initialized, verify_pda, verify_signer, verify_writtable,
    },
    states::{FillEvent, MarketState, OpenOrder, OpenOrdersAccount},
};

#[derive(Pod, Zeroable, Clone, Copy, ShankType)]
#[repr(C)]
pub struct ClaimFillParams {
    pub order_slot: u8,
    pub bump_position: u8,
    pub bump_user: u8,
    pub padding: [u8; 5],
}

pub fn process_claim_fill(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [signer, open_orders_account, market, risk_program, maker_user_account, maker_position, market_config, funding_state, system_program, _remaining @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    verify_signer(signer)?;
    verify_initialized(open_orders_account)?;
    verify_initialized(market)?;
    unsafe {
        verify_account_owner(open_orders_account, &crate::ID)?;
        verify_account_owner(market, &crate::ID)?;
    }

    verify_writtable(open_orders_account)?;

    let params = bytemuck::try_pod_read_unaligned::<ClaimFillParams>(data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    let slot = params.order_slot as usize;

    let now_ts = Clock::get()?.unix_timestamp;

    let market_data = market.try_borrow()?;
    let market_state = bytemuck::from_bytes::<MarketState>(&market_data[..MarketState::LEN]);

    if !market_state.is_active(now_ts) {
        return Err(OrderBookError::MarketInactive.into());
    }

    let mut oo_account_data = open_orders_account.try_borrow_mut()?;
    let oo_account_state = bytemuck::from_bytes_mut::<OpenOrdersAccount>(
        &mut oo_account_data[..OpenOrdersAccount::LEN],
    );

    // validations
    {
        let market_bump = [market_state.bump];
        let market_index = market_state.market_index.to_le_bytes();
        let open_orders_account_bump = [oo_account_state.bump];
        let open_orders_account_owner = oo_account_state.owner;

        if signer.address().as_array() != &open_orders_account_owner {
            return Err(ProgramError::InvalidAccountOwner);
        }
        if market.address().as_array() != &oo_account_state.market {
            return Err(ProgramError::InvalidAccountOwner);
        }

        verify_pda(
            market,
            &[MARKET_SEED, market_index.as_ref(), &market_bump],
            &crate::ID,
        )?;
        verify_pda(
            open_orders_account,
            &[
                OPEN_ORDERS_SEED,
                open_orders_account_owner.as_ref(),
                market.address().as_array().as_ref(),
                &open_orders_account_bump,
            ],
            &crate::ID,
        )?;
    }

    let oo = oo_account_state.open_order_by_raw_index(slot);

    if !oo.has_pending_fill() {
        return Err(OrderBookError::NoFillToClaim.into());
    }
    if oo.is_free() {
        return Err(OrderBookError::InvalidOrderSlot.into());
    }

    let fill = FillEvent {
        event_type: 0,
        taker_side: oo.side().invert_side() as u8,
        maker_out: if oo.filled_qty == 0 { 1 } else { 0 },
        maker_slot: slot as u8,
        _padding: [0; 4],
        timestamp: 0,
        maker_seq_num: 0,
        maker_timestamp: 0,
        maker_client_order_id: oo.client_id,
        taker_client_order_id: 0,
        price: oo.fill_price,
        quantity: oo.filled_qty,
        maker_pubkey: oo_account_state.owner,
        taker_pubkey: [0u8; 32],
        reserved: [0; 16],
    };

    let maker_out = oo.has_pending_fill() && oo.filled_qty > 0;

    settle_fill_cpi(
        risk_program,
        maker_user_account,
        maker_position,
        market_config,
        funding_state,
        system_program,
        &fill,
        market_state.market_index,
        false, // is_taker = false, this is maker
        params.bump_position,
        params.bump_user,
    )?;

    {
        let oo_mut = oo_account_state.open_order_mut_by_raw_index(slot);

        if maker_out {
            // order fully consumed
            *oo_mut = OpenOrder::default();
        } else {
            // order partially filled
            oo_mut.filled_qty = 0;
            oo_mut.fill_price = 0;
            oo_mut.is_filled = 0;
        }
    }

    Ok(())
}
