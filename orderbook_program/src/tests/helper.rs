use litesvm::LiteSVM;
use solana_address::{address, Address};
use solana_keypair::Keypair;
use solana_message::{AccountMeta, Instruction, Message};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use solana_transaction::Transaction;

use crate::{
    constants::{
        ASKS_SEED, BIDS_SEED, FUNDING_SEED, MARKET_CONFIG_SEED, MARKET_SEED, OPEN_ORDERS_SEED,
        POSITION_SEED, USER_ACCOUNT_SEED,
    },
    instructions::{
        CancelAllOrdersParams, CancelOrderByClientIdParams, CancelOrderParams, ClaimFillParams,
        CreateMarketParams, CreateOpenOrdersAccountParams, EditOrderParams, PlaceOrderParams,
        PlaceTakeOrderParams, PruneOrdersParams,
    },
    states::OpenOrdersAccount,
};

pub const PROGRAM_ID: Address = address!("j8VeDggFuwtiCjM8uo7am8i1bWWH2sj7mBRxqTaZniU");
pub const RISK_PROGRAM_ID: Address = address!("C8kAYt7vpmFxhguEJxbg6hMZY3LLNYACrU8mKveZ8eMu");

pub fn setup() -> (LiteSVM, Keypair, Keypair) {
    let mut svm = LiteSVM::new();
    let user1 = Keypair::new();
    let user2 = Keypair::new();

    svm.airdrop(&user1.pubkey(), 10 * LAMPORTS_PER_SOL)
        .expect("Airdrop failed");
    svm.airdrop(&user2.pubkey(), 10 * LAMPORTS_PER_SOL)
        .expect("Airdrop failed");
    let program_bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/target/sbpf-solana-solana/release/orderbook.so"
    ));
    svm.add_program(PROGRAM_ID, program_bytes)
        .expect("Failed to add program");
    let risk_bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../risk_program/target/sbpf-solana-solana/release/risk_program.so"
    ));
    svm.add_program(RISK_PROGRAM_ID, risk_bytes).unwrap();
    (svm, user1, user2)
}

pub fn create_market(svm: &mut LiteSVM, admin: &Keypair) -> u16 {
    let payer = admin;
    let market_index: u16 = 1;
    let market_index_bytes = market_index.to_le_bytes();

    let (market_pda, market_bump) =
        Address::find_program_address(&[MARKET_SEED, &market_index_bytes], &PROGRAM_ID);
    let (bids_pda, bids_bump) =
        Address::find_program_address(&[BIDS_SEED, &market_index_bytes], &PROGRAM_ID);
    let (asks_pda, asks_bump) =
        Address::find_program_address(&[ASKS_SEED, &market_index_bytes], &PROGRAM_ID);

    let params = CreateMarketParams {
        admin: payer.pubkey().to_bytes(),
        market_index,
        bump: market_bump,
        bids_bump,
        asks_bump,
        padding: [0u8; 3],
        base_lot_size: 100,
        quote_lot_size: 1,
        time_expiry: 0,
        name: *b"SOL-PERP\0\0\0\0\0\0\0\0",
    };

    let mut ix_data = vec![0u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(market_pda, false),
        AccountMeta::new(bids_pda, false),
        AccountMeta::new(asks_pda, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let message = Message::new(&[ix], Some(&payer.pubkey()));
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, blockhash);
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to create open orders account: {:?}",
        result.err()
    );
    market_index
}

pub fn open_orders_account(svm: &mut LiteSVM, market_index: &u16, user: &Keypair) -> Address {
    let market_index_bytes = market_index.to_le_bytes();
    let payer = user;
    let (market_pda, _) =
        Address::find_program_address(&[MARKET_SEED, &market_index_bytes], &PROGRAM_ID);
    let (oo_account_pda, oo_bump) = Address::find_program_address(
        &[
            OPEN_ORDERS_SEED,
            &payer.pubkey().to_bytes(),
            &market_pda.to_bytes(),
        ],
        &PROGRAM_ID,
    );

    let params = CreateOpenOrdersAccountParams {
        owner: payer.pubkey().to_bytes(),
        bump: oo_bump,
        padding: [0u8; 7],
    };

    let mut ix_data = vec![1u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(oo_account_pda, false),
        AccountMeta::new(market_pda, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let message = Message::new(&[ix], Some(&payer.pubkey()));
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, blockhash);
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to create open orders account: {:?}",
        result.err()
    );
    oo_account_pda
}

pub fn place_order(
    svm: &mut LiteSVM,
    market_index: &u16,
    user: &Keypair,
    side: u8,
    order_type: u8,
    client_order_id: u64,
    price_lots: i64,
    maker_oo: Option<Address>,
) {
    let payer = user;
    let signer_key = payer.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();
    let (market_pda, _) =
        Address::find_program_address(&[MARKET_SEED, &market_index_bytes], &PROGRAM_ID);
    let (oo_account_pda, _) = Address::find_program_address(
        &[
            OPEN_ORDERS_SEED,
            &payer.pubkey().to_bytes(),
            &market_pda.to_bytes(),
        ],
        &PROGRAM_ID,
    );

    let (bids_pda, _) =
        Address::find_program_address(&[BIDS_SEED, &market_index_bytes], &PROGRAM_ID);
    let (asks_pda, _) =
        Address::find_program_address(&[ASKS_SEED, &market_index_bytes], &PROGRAM_ID);

    let (taker_user_account_pda, bump_user) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &RISK_PROGRAM_ID);
    let (taker_position_pda, bump_position) = Address::find_program_address(
        &[POSITION_SEED, &signer_key, &market_index_bytes],
        &RISK_PROGRAM_ID,
    );
    let (market_config_pda, _) =
        Address::find_program_address(&[MARKET_CONFIG_SEED, &market_index_bytes], &RISK_PROGRAM_ID);
    let (funding_pda, _) =
        Address::find_program_address(&[FUNDING_SEED, &market_index_bytes], &RISK_PROGRAM_ID);

    let params = PlaceOrderParams {
        max_base_lots: 10,
        max_quote_lots: 1000,
        client_order_id,
        expiry_timestamp: 0,
        price_lots,
        side: side,
        order_type,
        limit: 10,
        bump_position,
        bump_user,
        padding: [0u8; 3],
    };

    let mut ix_data = vec![2u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let mut accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(oo_account_pda, false),
        AccountMeta::new(market_pda, false),
        AccountMeta::new(bids_pda, false),
        AccountMeta::new(asks_pda, false),
        AccountMeta::new(RISK_PROGRAM_ID, false),
        AccountMeta::new(taker_user_account_pda, false),
        AccountMeta::new(taker_position_pda, false),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(funding_pda, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];

    if let Some(maker_oo_pda) = maker_oo {
        accounts.push(AccountMeta::new(maker_oo_pda, false));
    }

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let message = Message::new(&[ix], Some(&payer.pubkey()));
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, blockhash);
    let result = svm.send_transaction(tx);
    match &result {
        Ok(meta) => println!("TX LOGS: {:#?}", meta.logs),
        Err(e) => println!("TX FAILED LOGS: {:#?}", e.meta.logs),
    }
    assert!(
        result.is_ok(),
        "Failed to create open orders account: {:?}",
        result.err()
    );
}

pub fn cancel_order(svm: &mut LiteSVM, market_index: &u16, user: &Keypair, side: u8) -> [u8; 16] {
    let payer = user;
    let market_index_bytes = market_index.to_le_bytes();

    let (market_pda, _) =
        Address::find_program_address(&[MARKET_SEED, &market_index_bytes], &PROGRAM_ID);
    let (oo_account_pda, _) = Address::find_program_address(
        &[
            OPEN_ORDERS_SEED,
            &payer.pubkey().to_bytes(),
            &market_pda.to_bytes(),
        ],
        &PROGRAM_ID,
    );
    let (bids_pda, _) =
        Address::find_program_address(&[BIDS_SEED, &market_index_bytes], &PROGRAM_ID);
    let (asks_pda, _) =
        Address::find_program_address(&[ASKS_SEED, &market_index_bytes], &PROGRAM_ID);

    let oo_account_data = svm
        .get_account(&oo_account_pda)
        .expect("OO account not found");
    let oo_account_state =
        bytemuck::from_bytes::<OpenOrdersAccount>(&oo_account_data.data[..OpenOrdersAccount::LEN]);
    let order_id = oo_account_state
        .open_orders
        .iter()
        .find(|o| u128::from_le_bytes(o.id) != 0)
        .expect("No active orders found")
        .id;

    let params = CancelOrderParams {
        order_id,
        side,
        padding: [0u8; 7],
    };

    let mut ix_data = vec![5u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(oo_account_pda, false),
        AccountMeta::new(market_pda, false),
        AccountMeta::new(bids_pda, false),
        AccountMeta::new(asks_pda, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let message = Message::new(&[ix], Some(&payer.pubkey()));
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, blockhash);
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to create open orders account: {:?}",
        result.err()
    );
    order_id
}

pub fn claim_fill(svm: &mut LiteSVM, market_index: &u16, user: &Keypair, maker_oo_pda: Address) {
    let payer = user;

    let signer_key = payer.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();

    let (market_pda, _) =
        Address::find_program_address(&[MARKET_SEED, &market_index_bytes], &PROGRAM_ID);
    let (position_pda, bump_position) = Address::find_program_address(
        &[POSITION_SEED, &signer_key, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (user_account_pda, bump_user) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &PROGRAM_ID);

    let maker_oo_data = svm.get_account(&maker_oo_pda).expect("Maker OO not found");
    let maker_oo_state =
        bytemuck::from_bytes::<OpenOrdersAccount>(&maker_oo_data.data[..OpenOrdersAccount::LEN]);

    let (slot, _) = maker_oo_state
        .open_orders
        .iter()
        .enumerate()
        .find(|(_, o)| o.is_filled == 1)
        .expect("No filled order found on maker OO account");

    let params = ClaimFillParams {
        order_slot: slot as u8,
        bump_position,
        bump_user,
        padding: [0u8; 5],
    };

    let mut ix_data = vec![8u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(maker_oo_pda, false),
        AccountMeta::new(market_pda, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let message = Message::new(&[ix], Some(&payer.pubkey()));
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, blockhash);
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to create open orders account: {:?}",
        result.err()
    ); // verify fill was cleared
    let oo_data = svm.get_account(&maker_oo_pda).expect("Maker OO not found");
    let oo_state =
        bytemuck::from_bytes::<OpenOrdersAccount>(&oo_data.data[..OpenOrdersAccount::LEN]);
    assert_eq!(
        oo_state.open_orders[slot].is_filled, 0,
        "Fill should be cleared after claim"
    );
    assert_eq!(
        oo_state.open_orders[slot].filled_qty, 0,
        "filled_qty should be 0 after claim"
    );
}

pub fn cancel_all_order(
    svm: &mut LiteSVM,
    market_index: &u16,
    user: &Keypair,
    side_filter: u8,
    client_id_filter: Option<u64>,
    limit: u8,
) {
    let payer = user;
    let market_index_bytes = market_index.to_le_bytes();

    let (market_pda, _) =
        Address::find_program_address(&[MARKET_SEED, &market_index_bytes], &PROGRAM_ID);
    let (oo_account_pda, _) = Address::find_program_address(
        &[
            OPEN_ORDERS_SEED,
            &payer.pubkey().to_bytes(),
            &market_pda.to_bytes(),
        ],
        &PROGRAM_ID,
    );
    let (bids_pda, _) =
        Address::find_program_address(&[BIDS_SEED, &market_index_bytes], &PROGRAM_ID);
    let (asks_pda, _) =
        Address::find_program_address(&[ASKS_SEED, &market_index_bytes], &PROGRAM_ID);

    let params = CancelAllOrdersParams {
        side_filter,
        has_client_filter: if client_id_filter.is_some() { 1 } else { 0 },
        limit,
        padding: [0u8; 5],
        client_id_filter: client_id_filter.unwrap_or(0),
    };

    let mut ix_data = vec![7u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(oo_account_pda, false),
        AccountMeta::new(market_pda, false),
        AccountMeta::new(bids_pda, false),
        AccountMeta::new(asks_pda, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let message = Message::new(&[ix], Some(&payer.pubkey()));
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, blockhash);
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to create open orders account: {:?}",
        result.err()
    );
}

pub fn cancel_order_by_client_id(
    svm: &mut LiteSVM,
    market_index: &u16,
    user: &Keypair,
    client_id: u64,
) {
    let payer = user;
    let market_index_bytes = market_index.to_le_bytes();

    let (market_pda, _) =
        Address::find_program_address(&[MARKET_SEED, &market_index_bytes], &PROGRAM_ID);
    let (oo_account_pda, _) = Address::find_program_address(
        &[
            OPEN_ORDERS_SEED,
            &payer.pubkey().to_bytes(),
            &market_pda.to_bytes(),
        ],
        &PROGRAM_ID,
    );
    let (bids_pda, _) =
        Address::find_program_address(&[BIDS_SEED, &market_index_bytes], &PROGRAM_ID);
    let (asks_pda, _) =
        Address::find_program_address(&[ASKS_SEED, &market_index_bytes], &PROGRAM_ID);

    let params = CancelOrderByClientIdParams { client_id };

    let mut ix_data = vec![6u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(oo_account_pda, false),
        AccountMeta::new(market_pda, false),
        AccountMeta::new(bids_pda, false),
        AccountMeta::new(asks_pda, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let message = Message::new(&[ix], Some(&payer.pubkey()));
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, blockhash);
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to create open orders account: {:?}",
        result.err()
    );
}

pub fn edit_order(
    svm: &mut LiteSVM,
    market_index: &u16,
    user: &Keypair,
    side: u8,
    order_type: u8,
    limit: u8,
    new_price_lots: i64,
    new_base_lots: i64,
    new_quote_lots: i64,
    client_order_id: u64,
    expiry_timestamp: u64,
) {
    let payer = user;

    let signer_key = payer.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();

    let (market_pda, _) =
        Address::find_program_address(&[MARKET_SEED, &market_index_bytes], &PROGRAM_ID);
    let (oo_account_pda, _) = Address::find_program_address(
        &[
            OPEN_ORDERS_SEED,
            &payer.pubkey().to_bytes(),
            &market_pda.to_bytes(),
        ],
        &PROGRAM_ID,
    );
    let (bids_pda, _) =
        Address::find_program_address(&[BIDS_SEED, &market_index_bytes], &PROGRAM_ID);
    let (asks_pda, _) =
        Address::find_program_address(&[ASKS_SEED, &market_index_bytes], &PROGRAM_ID);

    let (taker_user_account_pda, bump_user) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &RISK_PROGRAM_ID);
    let (taker_position_pda, bump_position) = Address::find_program_address(
        &[POSITION_SEED, &signer_key, &market_index_bytes],
        &RISK_PROGRAM_ID,
    );
    let (market_config_pda, _) =
        Address::find_program_address(&[MARKET_CONFIG_SEED, &market_index_bytes], &RISK_PROGRAM_ID);
    let (funding_pda, _) =
        Address::find_program_address(&[FUNDING_SEED, &market_index_bytes], &RISK_PROGRAM_ID);

    let oo_account_data = svm
        .get_account(&oo_account_pda)
        .expect("OO account not found");
    let oo_account_state =
        bytemuck::from_bytes::<OpenOrdersAccount>(&oo_account_data.data[..OpenOrdersAccount::LEN]);
    let order_id = oo_account_state
        .open_orders
        .iter()
        .find(|o| u128::from_le_bytes(o.id) != 0)
        .expect("No active orders found")
        .id;

    let params = EditOrderParams {
        side,
        order_type,
        limit,
        padding: [0u8; 3],
        order_id,
        new_price_lots,
        new_base_lots,
        new_quote_lots,
        client_order_id,
        expiry_timestamp,
        bump_position,
        bump_user,
    };

    let mut ix_data = vec![4u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(oo_account_pda, false),
        AccountMeta::new(market_pda, false),
        AccountMeta::new(bids_pda, false),
        AccountMeta::new(asks_pda, false),
        AccountMeta::new(RISK_PROGRAM_ID, false),
        AccountMeta::new(taker_user_account_pda, false),
        AccountMeta::new(taker_position_pda, false),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(funding_pda, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let message = Message::new(&[ix], Some(&payer.pubkey()));
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, blockhash);
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to create open orders account: {:?}",
        result.err()
    );
}

pub fn place_take_order(
    svm: &mut LiteSVM,
    market_index: &u16,
    user: &Keypair,
    side: u8,
    order_type: u8,
    limit: u8,
    max_base_lots: i64,
    max_quote_lots: i64,
    client_order_id: u64,
    price_lots: i64,
    maker_oo: Option<Address>,
) {
    let payer = user;

    let signer_key = payer.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();

    let (market_pda, _) =
        Address::find_program_address(&[MARKET_SEED, &market_index_bytes], &PROGRAM_ID);
    let (oo_account_pda, _) = Address::find_program_address(
        &[
            OPEN_ORDERS_SEED,
            &payer.pubkey().to_bytes(),
            &market_pda.to_bytes(),
        ],
        &PROGRAM_ID,
    );
    let (bids_pda, _) =
        Address::find_program_address(&[BIDS_SEED, &market_index_bytes], &PROGRAM_ID);
    let (asks_pda, _) =
        Address::find_program_address(&[ASKS_SEED, &market_index_bytes], &PROGRAM_ID);

    let (taker_user_account_pda, bump_user) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &RISK_PROGRAM_ID);
    let (taker_position_pda, bump_position) = Address::find_program_address(
        &[POSITION_SEED, &signer_key, &market_index_bytes],
        &RISK_PROGRAM_ID,
    );
    let (market_config_pda, _) =
        Address::find_program_address(&[MARKET_CONFIG_SEED, &market_index_bytes], &RISK_PROGRAM_ID);
    let (funding_pda, _) =
        Address::find_program_address(&[FUNDING_SEED, &market_index_bytes], &RISK_PROGRAM_ID);

    let params = PlaceTakeOrderParams {
        side,
        order_type,
        limit,
        padding: [0u8; 3],
        max_base_lots,
        max_quote_lots,
        client_order_id,
        price_lots,
        bump_position,
        bump_user,
    };

    let mut ix_data = vec![3u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let mut accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(oo_account_pda, false),
        AccountMeta::new(market_pda, false),
        AccountMeta::new(bids_pda, false),
        AccountMeta::new(asks_pda, false),
        AccountMeta::new(RISK_PROGRAM_ID, false),
        AccountMeta::new(taker_user_account_pda, false),
        AccountMeta::new(taker_position_pda, false),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(funding_pda, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];

    if let Some(maker_oo_pda) = maker_oo {
        accounts.push(AccountMeta::new(maker_oo_pda, false));
    }

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let message = Message::new(&[ix], Some(&payer.pubkey()));
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, blockhash);
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to create open orders account: {:?}",
        result.err()
    );
}

pub fn prune_orders(svm: &mut LiteSVM, market_index: &u16, user: &Keypair, side: u8, limit: u8) {
    let payer = user;
    let market_index_bytes = market_index.to_le_bytes();

    let (market_pda, _) =
        Address::find_program_address(&[MARKET_SEED, &market_index_bytes], &PROGRAM_ID);
    let (bids_pda, _) =
        Address::find_program_address(&[BIDS_SEED, &market_index_bytes], &PROGRAM_ID);
    let (asks_pda, _) =
        Address::find_program_address(&[ASKS_SEED, &market_index_bytes], &PROGRAM_ID);

    let params = PruneOrdersParams {
        side,
        limit,
        padding: [0u8; 6],
    };

    let mut ix_data = vec![9u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(market_pda, false),
        AccountMeta::new(bids_pda, false),
        AccountMeta::new(asks_pda, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let message = Message::new(&[ix], Some(&payer.pubkey()));
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, blockhash);
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to create open orders account: {:?}",
        result.err()
    );
}
