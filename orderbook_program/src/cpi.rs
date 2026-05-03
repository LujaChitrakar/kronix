use crate::states::FillEntry;
use pinocchio::cpi::invoke;
use pinocchio::instruction::{InstructionAccount, InstructionView};
use pinocchio::{AccountView, ProgramResult};
use risk_program_cpi::{
    OrderMarginParams, SettleFillParams, RELEASE_ORDER_MARGIN_IX, RESERVE_ORDER_MARGIN_IX,
    SETTLE_FILL_IX,
};

pub fn order_margin_cpi(
    risk_program: &AccountView,
    signer: &AccountView,
    user_account: &AccountView,
    market_config: &AccountView,
    quote_lots: i64,
    margin_amount: i64,
    market_index: u16,
    leverage: u8,
    bump_user: u8,
    reserve: bool,
) -> ProgramResult {
    let params = OrderMarginParams {
        quote_lots,
        margin_amount,
        market_index,
        leverage,
        bump_user,
        padding: [0; 4],
        owner: *signer.address().as_array(),
    };

    let params_bytes = bytemuck::bytes_of(&params);

    let mut ix_data = [0u8; 1 + core::mem::size_of::<OrderMarginParams>()];
    ix_data[0] = if reserve {
        RESERVE_ORDER_MARGIN_IX
    } else {
        RELEASE_ORDER_MARGIN_IX
    };
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(signer.address(), false, true),
        InstructionAccount::new(user_account.address(), true, false),
        InstructionAccount::new(market_config.address(), false, false),
    ];

    let account_infos = [signer, user_account, market_config];

    let ix = InstructionView {
        program_id: risk_program.address(),
        accounts: &account_metas,
        data: &ix_data,
    };

    invoke::<3>(&ix, &account_infos)?;

    Ok(())
}

pub fn settle_fill_cpi(
    risk_program: &AccountView,
    user_account: &AccountView,
    position: &AccountView,
    market_config: &AccountView,
    funding_state: &AccountView,
    system_program: &AccountView,
    payer: &AccountView,
    fill: &FillEntry,
    market_index: u16,
    is_taker: bool,
    bump_position: u8,
    bump_user: u8,
) -> ProgramResult {
    let params = SettleFillParams {
        price_lots: fill.price,
        base_lots: fill.quantity,
        reserved_margin: if is_taker {
            fill.taker_reserved_margin
        } else {
            fill.maker_reserved_margin
        },
        filled_base_lots: if is_taker {
            fill.taker_filled_base_lots
        } else {
            fill.maker_filled_base_lots
        },
        original_base_lots: if is_taker {
            fill.taker_original_base_lots
        } else {
            fill.maker_original_base_lots
        },
        market_index,
        is_taker: is_taker as u8,
        taker_side: fill.taker_side,
        bump_position,
        bump_user,
        padding: [0; 2],
        maker_pubkey: fill.maker_pubkey,
        taker_pubkey: fill.taker_pubkey,
    };

    let params_bytes = bytemuck::bytes_of(&params);

    let mut ix_data = [0u8; 1 + core::mem::size_of::<SettleFillParams>()];
    ix_data[0] = SETTLE_FILL_IX;
    ix_data[1..].copy_from_slice(params_bytes);

    let account_metas = [
        InstructionAccount::new(user_account.address(), true, false),
        InstructionAccount::new(position.address(), true, false),
        InstructionAccount::new(market_config.address(), false, false),
        InstructionAccount::new(funding_state.address(), true, false),
        InstructionAccount::new(system_program.address(), false, false),
        InstructionAccount::new(payer.address(), true, true),
    ];

    let account_infos = [
        user_account,
        position,
        market_config,
        funding_state,
        system_program,
        payer,
    ];

    let ix = InstructionView {
        program_id: risk_program.address(),
        accounts: &account_metas,
        data: &ix_data,
    };

    invoke::<6>(&ix, &account_infos)?;

    Ok(())
}
