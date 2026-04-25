use bytemuck::{Pod, Zeroable};
use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use shank::ShankType;

use crate::{
    constants::{FILLS_LOG_SEED, OPEN_ORDERS_SEED, POSITION_SEED, USER_ACCOUNT_SEED},
    cpi::settle_fill_cpi,
    errors::OrderBookError,
    helper::{verify_account_owner, verify_pda, verify_signer, verify_writtable},
    states::{FillsLog, OpenOrdersAccount},
};

#[derive(Pod, Zeroable, Clone, Copy,ShankType)]
#[repr(C)]
pub struct FillSettleParams {
    pub taker_bump_user: u8,
    pub taker_bump_position: u8,
    pub maker_bump_user: u8,
    pub maker_bump_position: u8,
    pub maker_bump_oo: u8,
    pub padding: [u8; 3],
}

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct SettleFillsParams {
    pub start: u8,
    pub end: u8, // exclusive
    pub padding: [u8; 6],
    pub fill_params: [FillSettleParams; 8],
}

pub fn process_settle_fills(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
         caller,            // permissionless
         fills_log,
         market,
         market_config,
         funding_state,
         risk_program,
         system_program,
         _remaining @ ..,   // per fill: taker_ua, taker_pos, maker_oo, maker_ua, maker_pos
     ] = accounts else {
         return Err(ProgramError::NotEnoughAccountKeys);
     };

    verify_signer(caller)?;
    unsafe {
        verify_account_owner(fills_log, &crate::ID)?;
    }
    verify_writtable(fills_log)?;

    let params = bytemuck::try_from_bytes::<SettleFillsParams>(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if params.start >= params.end {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut log_data = fills_log.try_borrow_mut()?;
    let log = bytemuck::from_bytes_mut::<FillsLog>(&mut log_data[..FillsLog::LEN]);

    {
        let client_id_bytes = log.client_order_id.to_le_bytes();
        let bump_bytes = [log.bump];

        verify_pda(
            fills_log,
            &[
                FILLS_LOG_SEED,
                log.taker.as_ref(),
                client_id_bytes.as_ref(),
                &bump_bytes,
            ],
            &crate::ID,
        )?;
    }

    if log.market != *market.address().as_array() {
        return Err(OrderBookError::InvalidMarket.into());
    }

    let end = (params.end as usize).min(log.fill_count as usize);
    let start = params.start as usize;

    if start >= end {
        return Ok(()); // nothing to settle in this range
    }

    // remaining layout per fill (5 accounts):
    //   [i*5 + 0] taker_user_account
    //   [i*5 + 1] taker_position
    //   [i*5 + 2] maker_open_orders_account
    //   [i*5 + 3] maker_user_account
    //   [i*5 + 4] maker_position

    for i in start..end {
        let fill = &mut log.fills[i];
        if fill.settled == 1 {
            continue; // already settled
        }

        let local_idx = i - start;
        let base = local_idx * 5;
        let fp = &params.fill_params[i];

        let taker_ua = _remaining
            .get(base)
            .ok_or(ProgramError::NotEnoughAccountKeys)?;
        let taker_pos = _remaining
            .get(base + 1)
            .ok_or(ProgramError::NotEnoughAccountKeys)?;
        let maker_oo = _remaining
            .get(base + 2)
            .ok_or(ProgramError::NotEnoughAccountKeys)?;
        let maker_ua = _remaining
            .get(base + 3)
            .ok_or(ProgramError::NotEnoughAccountKeys)?;
        let maker_pos = _remaining
            .get(base + 4)
            .ok_or(ProgramError::NotEnoughAccountKeys)?;

        {
            let market_index_bytes = fill.market_index.to_le_bytes();
            verify_pda(
                taker_ua,
                &[
                    USER_ACCOUNT_SEED,
                    fill.taker_pubkey.as_ref(),
                    &[fp.taker_bump_user],
                ],
                &crate::RISK_PROGRAM_ID,
            )?;
            verify_pda(
                taker_pos,
                &[
                    POSITION_SEED,
                    fill.taker_pubkey.as_ref(),
                    market_index_bytes.as_ref(),
                    &[fp.taker_bump_position],
                ],
                &crate::RISK_PROGRAM_ID,
            )?;
            verify_pda(
                maker_oo,
                &[
                    OPEN_ORDERS_SEED,
                    fill.maker_pubkey.as_ref(),
                    market.address().as_array().as_ref(),
                    &[fp.maker_bump_oo],
                ],
                &crate::ID,
            )?;
            verify_pda(
                maker_ua,
                &[
                    USER_ACCOUNT_SEED,
                    fill.maker_pubkey.as_ref(),
                    &[fp.maker_bump_user],
                ],
                &crate::RISK_PROGRAM_ID,
            )?;
            verify_pda(
                maker_pos,
                &[
                    POSITION_SEED,
                    fill.maker_pubkey.as_ref(),
                    market_index_bytes.as_ref(),
                    &[fp.maker_bump_position],
                ],
                &crate::RISK_PROGRAM_ID,
            )?;
        }

        settle_fill_cpi(
            risk_program,
            taker_ua,
            taker_pos,
            market_config,
            funding_state,
            system_program,
            fill,
            fill.market_index,
            true, // is_taker
            fp.taker_bump_position,
            fp.taker_bump_user,
        )?;
        settle_fill_cpi(
            risk_program,
            maker_ua,
            maker_pos,
            market_config,
            funding_state,
            system_program,
            fill,
            fill.market_index,
            false, // is_taker
            fp.maker_bump_position,
            fp.maker_bump_user,
        )?;
        {
            unsafe {
                verify_account_owner(maker_oo, &crate::ID)?;
            }
            verify_writtable(maker_oo)?;

            let mut maker_oo_data = maker_oo.try_borrow_mut()?;
            let maker_oo_state = bytemuck::from_bytes_mut::<OpenOrdersAccount>(
                &mut maker_oo_data[..OpenOrdersAccount::LEN],
            );

            if maker_oo_state.owner != fill.maker_pubkey {
                return Err(OrderBookError::InvalidMakerAccount.into());
            }

            if fill.maker_out == 1 {
                // Fully consumed — free the slot
                maker_oo_state.remove_order(fill.maker_slot as usize);
            }
            // Partial fill — slot stays in book with reduced quantity
            // critbit tree already updated during matching
        }

        // ── Mark as settled LAST ──────────────────────────────────
        fill.settled = 1;
    }
    let all_done = (0..log.fill_count as usize).all(|i| log.fills[i].settled == 1);

    if all_done {
        log.all_settled = 1;
    }
    Ok(())
}
