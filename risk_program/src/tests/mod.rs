use pinocchio::Address;

use crate::{
    constants::{POSITION_SEED, USER_ACCOUNT_SEED},
    state::{Position, UserAccount},
    tests::helper::{
        PROGRAM_ID, add_margin, close_position, cover_bad_debt, create_market, create_mint,
        deposit, initialize_insurance_fund, initialize_vault, liquidate, open_position,
        remove_margin, settle_funding, setup, update_funding_rate, withdraw,
    },
};

#[cfg(test)]
pub mod helper;

#[test]
pub fn test_create_market() {
    let (mut svm, user1, _, oracle) = setup();
    let market_index = 1;
    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        10,
        oracle,
    );
}
#[test]
pub fn test_init_insurance_fund() {
    let (mut svm, user1, _, _) = setup();
    initialize_insurance_fund(&mut svm, &user1);
}
#[test]
pub fn test_initialize_vault() {
    let (mut svm, user1, _, _) = setup();
    let mint = create_mint(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);
}
#[test]
pub fn test_deposit() {
    let (mut svm, user1, _, _) = setup();
    let mint = create_mint(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &mint, 10);
}

#[test]
pub fn test_withdraw() {
    let (mut svm, user1, _, _) = setup();
    let mint = create_mint(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &mint, 10);
    withdraw(&mut svm, &user1, &mint, 1);
}
#[test]
pub fn test_open_position() {
    let (mut svm, user1, _, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1;
    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        10,
        oracle,
    );

    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &mint, 10000000);
    open_position(&mut svm, &user1, market_index, 0, 100, 1000);
}
#[test]
pub fn test_close_position() {
    let (mut svm, user1, _, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1;
    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        10,
        oracle,
    );

    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &mint, 10000000);
    open_position(&mut svm, &user1, market_index, 0, 100, 1000);
    close_position(&mut svm, &user1, market_index, 100);
}
#[test]
pub fn test_add_margin() {
    let (mut svm, user1, _, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1;
    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        10,
        oracle,
    );

    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &mint, 10000000);
    open_position(&mut svm, &user1, market_index, 0, 100, 1000);
    add_margin(&mut svm, &user1, market_index, 100);
}
#[test]
pub fn test_remove_margin() {
    let (mut svm, user1, _, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1;
    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        10,
        oracle,
    );

    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &mint, 10000000);
    open_position(&mut svm, &user1, market_index, 0, 100, 1000);
    remove_margin(&mut svm, &user1, market_index, 100);
}

pub fn test_update_funding_rate() {
    let (mut svm, user1, _, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1;
    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        10,
        oracle,
    );

    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &mint, 10000000);
    open_position(&mut svm, &user1, market_index, 0, 100, 1000);
    update_funding_rate(&mut svm, &user1, market_index, 1000);
}

#[test]
pub fn test_settle_funding() {
    let (mut svm, user1, _, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1;
    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        10,
        oracle,
    );
    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &mint, 10000000);
    open_position(&mut svm, &user1, market_index, 0, 100, 1000);
    settle_funding(&mut svm, &user1, market_index);
}

#[test]
pub fn test_liquidate() {
    let (mut svm, user1, _, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1u16;

    create_market(
        &mut svm,
        &user1,
        market_index,
        100, // base_lot_size
        1,   // quote_lot_size
        100, // initial_margin_bps = 1%
        50,  // maintenance_margin_bps = 0.5%
        100, // liquidation_fee_bps = 1%
        20,  // max_leverage
        oracle,
    );

    initialize_insurance_fund(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &mint, 5_000);
    open_position(&mut svm, &user1, market_index, 1, 10, 1000);
    liquidate(&mut svm, &user1, market_index, &mint);
}

#[test]
pub fn test_cover_bad_debt() {
    let (mut svm, user1, _, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1u16;

    create_market(
        &mut svm,
        &user1,
        market_index,
        100, // base_lot_size
        1,   // quote_lot_size
        100, // initial_margin_bps = 1%
        50,  // maintenance_margin_bps = 0.5%
        100, // liquidation_fee_bps = 1%
        20,  // max_leverage
        oracle,
    );

    initialize_insurance_fund(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &mint, 5_000);
    open_position(&mut svm, &user1, market_index, 1, 10, 1000);

    cover_bad_debt(&mut svm, &user1, market_index);
}
