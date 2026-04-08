use pinocchio::Address;
use solana_clock::Clock;

use crate::{
    constants::{POSITION_SEED, USER_ACCOUNT_SEED},
    state::{Position, UserAccount},
    tests::helper::{
        PROGRAM_ID, add_margin, close_position, cover_bad_debt, create_market, create_mint,
        deposit, initialize_insurance_fund, initialize_vault, liquidate, open_position,
        remove_margin, settle_fill, settle_funding, setup, update_funding_rate, withdraw,
    },
};

#[cfg(test)]
pub mod client;
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
    deposit(&mut svm, &user1, &user1, &mint, 10);
}

#[test]
pub fn test_withdraw() {
    let (mut svm, user1, _, _) = setup();
    let mint = create_mint(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);
    deposit(&mut svm, &user1, &user1, &mint, 10);
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
    deposit(&mut svm, &user1, &user1, &mint, 10000000);
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
    deposit(&mut svm, &user1, &user1, &mint, 10000000);
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
    deposit(&mut svm, &user1, &user1, &mint, 10000000);
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
    deposit(&mut svm, &user1, &user1, &mint, 10000000);
    open_position(&mut svm, &user1, market_index, 0, 100, 1000);
    remove_margin(&mut svm, &user1, market_index, 100);
}

#[test]
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

    initialize_insurance_fund(&mut svm, &user1);
    deposit(&mut svm, &user1, &user1, &mint, 10000000);
    open_position(&mut svm, &user1, market_index, 0, 100, 1000);

    let mut clock: Clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp += 4000;
    svm.set_sysvar::<Clock>(&clock);

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
    deposit(&mut svm, &user1, &user1, &mint, 10000000);
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
    deposit(&mut svm, &user1, &user1, &mint, 5_000);
    open_position(&mut svm, &user1, market_index, 0, 10, 1000);
    liquidate(&mut svm, &user1, market_index, &mint);
}

#[test]
pub fn test_cover_bad_debt() {
    let (mut svm, user1, user2, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1u16;

    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        100,
        50,
        100,
        20,
        oracle,
    );
    initialize_insurance_fund(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);

    // user1 liquidated → funds insurance with 2 units
    deposit(&mut svm, &user1, &user1, &mint, 5_000);
    open_position(&mut svm, &user1, market_index, 0, 10, 1000);
    liquidate(&mut svm, &user1, market_index, &mint);

    // user2: shortfall = 1, insurance has 2 → covered
    deposit(&mut svm, &user1, &user2, &mint, 898);
    open_position(&mut svm, &user2, market_index, 0, 1, 1000);
    cover_bad_debt(&mut svm, &user1, &user2, market_index);
}

#[test]
pub fn test_settle_fill_maker() {
    let (mut svm, user1, user2, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1u16;

    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        20,
        oracle,
    );
    initialize_insurance_fund(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);

    let maker_pubkey: [u8; 32] = user1.to_bytes()[32..64].try_into().unwrap();
    let taker_pubkey: [u8; 32] = user2.to_bytes()[32..64].try_into().unwrap();

    settle_fill(
        &mut svm,
        &user1,
        market_index,
        1000, // price_lots
        10,   // base_lots
        0,    // is_taker = maker
        0,    // taker_side = bid (taker bought, maker sold)
        maker_pubkey,
        taker_pubkey,
    );
}

#[test]
pub fn test_settle_fill_taker() {
    let (mut svm, user1, user2, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1u16;

    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        20,
        oracle,
    );
    initialize_insurance_fund(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);

    let maker_pubkey: [u8; 32] = user1.to_bytes()[32..64].try_into().unwrap();
    let taker_pubkey: [u8; 32] = user2.to_bytes()[32..64].try_into().unwrap();

    settle_fill(
        &mut svm,
        &user2,
        market_index,
        1000, // price_lots
        10,   // base_lots
        1,    // is_taker = maker
        0,    // taker_side = bid (taker bought, maker sold)
        maker_pubkey,
        taker_pubkey,
    );
}

#[test]
pub fn test_settle_fill_increase_position() {
    let (mut svm, user1, user2, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1u16;

    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        20,
        oracle,
    );
    initialize_insurance_fund(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);

    let maker_pubkey: [u8; 32] = user1.to_bytes()[32..64].try_into().unwrap();
    let taker_pubkey: [u8; 32] = user2.to_bytes()[32..64].try_into().unwrap();

    settle_fill(
        &mut svm,
        &user2,
        market_index,
        1000, // price_lots
        10,   // base_lots
        1,    // is_taker = maker
        0,    // taker_side = bid (taker bought, maker sold)
        maker_pubkey,
        taker_pubkey,
    );
    settle_fill(
        &mut svm,
        &user2,
        market_index,
        1200, // price_lots
        5,    // base_lots
        1,    // is_taker = maker
        0,    // taker_side = bid (taker bought, maker sold)
        maker_pubkey,
        taker_pubkey,
    );
}

#[test]
pub fn test_settle_fill_close_position() {
    let (mut svm, user1, user2, oracle) = setup();
    let mint = create_mint(&mut svm, &user1);
    let market_index = 1u16;

    create_market(
        &mut svm,
        &user1,
        market_index,
        100,
        1,
        1000,
        500,
        100,
        20,
        oracle,
    );
    initialize_insurance_fund(&mut svm, &user1);
    initialize_vault(&mut svm, &user1, &mint);

    let maker_pubkey: [u8; 32] = user1.to_bytes()[32..64].try_into().unwrap();
    let taker_pubkey: [u8; 32] = user2.to_bytes()[32..64].try_into().unwrap();

    let market_index_bytes = market_index.to_le_bytes();

    settle_fill(
        &mut svm,
        &user2,
        market_index,
        1000, // price_lots
        10,   // base_lots
        1,    // is_taker = maker
        0,    // taker_side = bid (taker bought, maker sold)
        maker_pubkey,
        taker_pubkey,
    );

    let (user_account_pda, _) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &taker_pubkey], &PROGRAM_ID);
    let ua_before = svm.get_account(&user_account_pda).unwrap();
    let ua_before = bytemuck::from_bytes::<UserAccount>(&ua_before.data[..UserAccount::LEN]);
    let collateral_before = ua_before.collateral;

    settle_fill(
        &mut svm,
        &user2,
        market_index,
        1200, // price_lots
        10,   // base_lots
        1,    // is_taker = maker
        1,    // taker_side = bid (taker bought, maker sold)
        maker_pubkey,
        taker_pubkey,
    );

    let (position_pda, _) = Address::find_program_address(
        &[POSITION_SEED, &taker_pubkey, &market_index_bytes],
        &PROGRAM_ID,
    );
    let pos_data = svm.get_account(&position_pda).unwrap();
    let pos = bytemuck::from_bytes::<Position>(&pos_data.data[..Position::LEN]);
    assert_eq!(pos.size, 0, "Position fully closed");

    // verify PnL credited — long closed at 1200 vs entry 1000
    // pnl = 10 * (1200 - 1000) * quote_lot_size(1) = 2000
    let ua_after = svm.get_account(&user_account_pda).unwrap();
    let ua_after = bytemuck::from_bytes::<UserAccount>(&ua_after.data[..UserAccount::LEN]);
    assert_eq!(
        ua_after.collateral,
        collateral_before + 2000,
        "PnL should be credited on close"
    );
    assert_eq!(ua_after.position_count, 0);
}
