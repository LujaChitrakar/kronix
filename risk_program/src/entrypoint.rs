#![allow(unexpected_cfgs)]

use pinocchio::{
    AccountView, Address, ProgramResult, default_panic_handler, error::ProgramError, no_allocator,
    program_entrypoint,
};
use pinocchio_log::log;

use crate::instructions::{
    RiskProgramInstruction, process_add_margin, process_close_position, process_cover_bad_debt,
    process_create_risk_market, process_deposit, process_initialize_insurance_fund,
    process_initialize_vault, process_liquidate, process_open_position, process_remove_margin,
    process_settle_fill, process_settle_funding, process_update_funding_rate, process_withdraw,
};

program_entrypoint!(process_instruction);
no_allocator!();
default_panic_handler!();

#[inline(always)]
pub fn process_instruction(
    _program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (disc, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    log!("disc: {}", instruction_data.first().copied().unwrap_or(255));
    match RiskProgramInstruction::try_from(disc)? {
        RiskProgramInstruction::CreateRiskMarket => process_create_risk_market(accounts, data)?,
        RiskProgramInstruction::InitializeInsuranceFund => {
            process_initialize_insurance_fund(accounts, data)?
        }
        RiskProgramInstruction::InitializeVault => process_initialize_vault(accounts, data)?,
        RiskProgramInstruction::Deposit => process_deposit(accounts, data)?,
        RiskProgramInstruction::Withdraw => process_withdraw(accounts, data)?,
        RiskProgramInstruction::OpenPosition => process_open_position(accounts, data)?,
        RiskProgramInstruction::ClosePosition => process_close_position(accounts, data)?,
        RiskProgramInstruction::AddMargin => process_add_margin(accounts, data)?,
        RiskProgramInstruction::RemoveMargin => process_remove_margin(accounts, data)?,
        RiskProgramInstruction::SettleFill => process_settle_fill(accounts, data)?,
        RiskProgramInstruction::SettleFunding => process_settle_funding(accounts, data)?,
        RiskProgramInstruction::UpdateFundingRate => process_update_funding_rate(accounts, data)?,
        RiskProgramInstruction::Liquidate => process_liquidate(accounts, data)?,
        RiskProgramInstruction::CoverBadDebt => process_cover_bad_debt(accounts, data)?,
    }
    Ok(())
}
