use pinocchio::cpi::invoke;
use pinocchio::instruction::{InstructionAccount, InstructionView};
use pinocchio::{AccountView, ProgramResult};
use risk_program_cpi::{SettleFillParams, SETTLE_FILL_IX};
use crate::states::heap::FillEvent;

pub fn settle_fill_cpi(
    risk_program: &AccountView,
    user_account: &AccountView,
    position: &AccountView,
    market_config: &AccountView,
    funding_state: &AccountView,
    system_program: &AccountView,
    fill: &FillEvent,
    market_index: u16,
    is_taker: bool,
    bump_position: u8,
    bump_user: u8,
) -> ProgramResult {
    let params = SettleFillParams {
        is_taker: is_taker as u8,
        taker_side: fill.taker_side,
        price_lots: fill.price,
        base_lots: fill.quantity,
        maker_pubkey: fill.maker_pubkey,
        taker_pubkey: fill.taker_pubkey,
        market_index,
        bump_position,
        bump_user,
        padding: [0; 2],
    };

    let params_bytes = bytemuck::bytes_of(&params);

    let mut ix_data = [0u8; 1 + core::mem::size_of::<SettleFillParams>()];
    ix_data[0] = SETTLE_FILL_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(risk_program.address(), false, false),
        InstructionAccount::new(user_account.address(), true, false),
        InstructionAccount::new(position.address(), true, false),
        InstructionAccount::new(market_config.address(), false, false),
        InstructionAccount::new(funding_state.address(), true, false),
        InstructionAccount::new(system_program.address(), false, false),
    ];

    let account_infos = [
        risk_program,
        user_account,
        position,
        market_config,
        funding_state,
        system_program,
    ];

    let ix = InstructionView {
        program_id: risk_program.address(),
        accounts: &account_metas,
        data: &ix_data,
    };

    invoke::<6>(&ix, &account_infos)?;

    Ok(())
}
