use litesvm::LiteSVM;
use litesvm_token::{CreateAccount, CreateMint, MintTo, spl_token};

use solana_address::{Address, address};
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_message::{AccountMeta, Instruction, Message};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use solana_transaction::Transaction;

use crate::{
    constants::{
        FUNDING_INTERVAL_SECS, FUNDING_SEED, INSURANCE_SEED, MARKET_CONFIG_SEED, POSITION_SEED,
        USER_ACCOUNT_SEED, VAULT_AUTHORITY_SEED, VAULT_SEED,
    },
    instructions::{
        AddMarginParams, ClosePositionParams, CoverBadDebtParams, CreateMarketParams,
        DepositParams, InitInsuranceFundParams, InitializeVaultParams, LiquidateParams,
        OpenPositionParams, RemoveMarginParams, SettleFillParams, UpdateFundingRateParams,
        WithdrawParams,
    },
    state::{MarketConfig, Position, UserAccount},
};

pub const PROGRAM_ID: Address = address!("2c88D4ELFGsJnxTvxWGY92GqcE7RNqXwXPMFjTXhnxLQ");

pub fn setup() -> (LiteSVM, Keypair, Keypair, Address) {
    let mut svm = LiteSVM::new();
    let user1 = Keypair::new();
    let user2 = Keypair::new();

    let oracle = Keypair::new().pubkey();

    svm.airdrop(&user1.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
    svm.airdrop(&user2.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

    let program_bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/target/sbpf-solana-solana/release/risk_program.so"
    ));
    svm.add_program(PROGRAM_ID, program_bytes).unwrap();

    (svm, user1, user2, oracle)
}

pub fn create_market(
    svm: &mut LiteSVM,
    payer: &Keypair,
    market_index: u16,
    base_lot_size: i64,
    quote_lot_size: i64,
    initial_margin_bps: u16,
    maintenance_margin_bps: u16,
    liquidation_fee_bps: u16,
    max_leverage: u8,
    oracle: Address,
) {
    let market_index_bytes = market_index.to_le_bytes();

    let (market_config_pda, bump_market_config) = Address::find_program_address(
        &[MARKET_CONFIG_SEED, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (funding_pda, bump_funding) =
        Address::find_program_address(&[FUNDING_SEED, market_index_bytes.as_ref()], &PROGRAM_ID);

    let params = CreateMarketParams {
        base_lot_size,
        quote_lot_size,
        market_index,
        initial_margin_bps,
        maintenance_margin_bps,
        liquidation_fee_bps,
        max_leverage,
        bump_config: bump_market_config,
        bump_funding,
        padding: [0; 5],
        oracle: oracle.to_bytes(),
    };

    let mut ix_data = vec![0u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
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
    let recent_blockhash = svm.latest_blockhash();
    let tx = Transaction::new(&[&payer], message, recent_blockhash);
    let result = svm.send_transaction(tx);

    assert!(
        result.is_ok(),
        "Failed to create market: {:?}",
        result.err()
    );
}

pub fn initialize_insurance_fund(svm: &mut LiteSVM, payer: &Keypair) -> Address {
    let (insurance_pda, bump) = Address::find_program_address(&[INSURANCE_SEED], &PROGRAM_ID);

    let params = InitInsuranceFundParams {
        bump,
        padding: [0u8; 7],
    };

    let mut ix_data = vec![1u8]; // InitInsuranceFund discriminator
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(insurance_pda, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to init insurance fund: {:?}",
        result.err()
    );

    insurance_pda
}

pub fn initialize_vault(svm: &mut LiteSVM, payer: &Keypair, mint: &Address) -> (Address, Address) {
    let (vault_pda, vault_bump) = Address::find_program_address(&[VAULT_SEED], &PROGRAM_ID);
    let (authority_pda, authority_bump) =
        Address::find_program_address(&[VAULT_AUTHORITY_SEED], &PROGRAM_ID);

    let params = InitializeVaultParams {
        vault_bump,
        authority_bump,
        padding: [0u8; 6],
    };

    let mut ix_data = vec![2u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(vault_pda, false),
        AccountMeta::new(authority_pda, false),
        AccountMeta::new_readonly(*mint, false),
        AccountMeta::new_readonly(spl_token::ID, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to initialize vault: {:?}",
        result.err()
    );

    (vault_pda, authority_pda)
}

pub fn deposit(
    svm: &mut LiteSVM,
    mint_authority: &Keypair,
    payer: &Keypair,
    mint: &Address,
    amount: u64,
) -> Address {
    let signer_key = payer.pubkey().to_bytes();

    let (user_account_pda, bump_user) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &PROGRAM_ID);
    let (vault_pda, bump_vault) = Address::find_program_address(&[VAULT_SEED], &PROGRAM_ID);

    let user_ata = create_token_account(svm, payer, mint, &payer.pubkey());
    mint_to(svm, mint_authority, mint, &user_ata, amount);

    let params = DepositParams {
        amount,
        bump_user,
        bump_vault,
        padding: [0u8; 6],
    };

    let mut ix_data = vec![3u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(user_account_pda, false),
        AccountMeta::new(user_ata, false),
        AccountMeta::new(vault_pda, false),
        AccountMeta::new_readonly(spl_token::ID, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Failed to deposit: {:?}", result.err());

    user_account_pda
}

pub fn withdraw(svm: &mut LiteSVM, payer: &Keypair, mint: &Address, amount: u64) {
    let signer_key = payer.pubkey().to_bytes();

    let (user_account_pda, bump_user) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &PROGRAM_ID);
    let (vault_pda, bump_vault) = Address::find_program_address(&[VAULT_SEED], &PROGRAM_ID);
    let (authority_pda, bump_authority) =
        Address::find_program_address(&[VAULT_AUTHORITY_SEED], &PROGRAM_ID);

    let user_ata = create_token_account(svm, payer, mint, &payer.pubkey());

    let params = WithdrawParams {
        amount,
        bump_user,
        bump_vault,
        bump_authority,
        padding: [0u8; 5],
    };

    let mut ix_data = vec![4u8]; // Withdraw discriminator
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(user_account_pda, false),
        AccountMeta::new(user_ata, false),
        AccountMeta::new(vault_pda, false),
        AccountMeta::new(authority_pda, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Failed to withdraw: {:?}", result.err());
}

pub fn open_position(
    svm: &mut LiteSVM,
    payer: &Keypair,
    market_index: u16,
    side: u8,
    size_lots: i64,
    leverage_bps: u16,
) {
    let signer_key = payer.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();

    let (user_account_pda, bump_user) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &PROGRAM_ID);
    let (market_config_pda, _) = Address::find_program_address(
        &[MARKET_CONFIG_SEED, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (funding_pda, _) =
        Address::find_program_address(&[FUNDING_SEED, market_index_bytes.as_ref()], &PROGRAM_ID);
    let (position_pda, bump_position) = Address::find_program_address(
        &[POSITION_SEED, &signer_key, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );

    let market_account = svm
        .get_account(&market_config_pda)
        .expect("Market not found");
    let market_state: &MarketConfig =
        bytemuck::from_bytes(&market_account.data[..MarketConfig::LEN]);

    let oracle = Address::from(market_state.oracle);
    let params = OpenPositionParams {
        size_lots,
        leverage_bps,
        market_index,
        side,
        bump_position,
        bump_user,
        padding: [0u8; 1],
    };

    let mut ix_data = vec![5u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(user_account_pda, false),
        AccountMeta::new(position_pda, false),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(funding_pda, false),
        AccountMeta::new(oracle, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to open position: {:?}",
        result.err()
    );
}

pub fn close_position(svm: &mut LiteSVM, payer: &Keypair, market_index: u16, size_lots: i64) {
    let signer_key = payer.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();

    let (user_account_pda, _) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &PROGRAM_ID);
    let (market_config_pda, _) = Address::find_program_address(
        &[MARKET_CONFIG_SEED, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (funding_pda, _) =
        Address::find_program_address(&[FUNDING_SEED, market_index_bytes.as_ref()], &PROGRAM_ID);
    let (position_pda, _) = Address::find_program_address(
        &[POSITION_SEED, &signer_key, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );

    let market_account = svm
        .get_account(&market_config_pda)
        .expect("Market not found");
    let market_state: &MarketConfig =
        bytemuck::from_bytes(&market_account.data[..MarketConfig::LEN]);

    let oracle = Address::from(market_state.oracle);
    let params = ClosePositionParams {
        size_lots,
        market_index,
        padding: [0u8; 6],
    };

    let mut ix_data = vec![6u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(user_account_pda, false),
        AccountMeta::new(position_pda, false),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(funding_pda, false),
        AccountMeta::new(oracle, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to close_position: {:?}",
        result.err()
    );
}

pub fn add_margin(svm: &mut LiteSVM, payer: &Keypair, market_index: u16, amount: i64) {
    let signer_key = payer.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();

    let (user_account_pda, _) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &PROGRAM_ID);
    let (market_config_pda, _) = Address::find_program_address(
        &[MARKET_CONFIG_SEED, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (position_pda, _) = Address::find_program_address(
        &[POSITION_SEED, &signer_key, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );

    let params = AddMarginParams {
        amount,
        market_index,
        padding: [0u8; 6],
    };

    let mut ix_data = vec![7u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(user_account_pda, false),
        AccountMeta::new(position_pda, false),
        AccountMeta::new(market_config_pda, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Failed to add margin: {:?}", result.err());
}

pub fn remove_margin(svm: &mut LiteSVM, payer: &Keypair, market_index: u16, amount: i64) {
    let signer_key = payer.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();

    let (user_account_pda, _) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &PROGRAM_ID);
    let (market_config_pda, _) = Address::find_program_address(
        &[MARKET_CONFIG_SEED, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (position_pda, _) = Address::find_program_address(
        &[POSITION_SEED, &signer_key, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );

    let market_account = svm
        .get_account(&market_config_pda)
        .expect("Market not found");
    let market_state: &MarketConfig =
        bytemuck::from_bytes(&market_account.data[..MarketConfig::LEN]);

    let oracle = Address::from(market_state.oracle);

    let params = RemoveMarginParams {
        amount,
        market_index,
        padding: [0u8; 6],
    };

    let mut ix_data = vec![8u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(user_account_pda, false),
        AccountMeta::new(position_pda, false),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(oracle, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to remove margin: {:?}",
        result.err()
    );
}

pub fn update_funding_rate(svm: &mut LiteSVM, payer: &Keypair, market_index: u16, mark_price: i64) {
    let market_index_bytes = market_index.to_le_bytes();

    let clock: Clock = svm.get_sysvar();
    svm.warp_to_slot(clock.slot + FUNDING_INTERVAL_SECS as u64);
    let (market_config_pda, _) = Address::find_program_address(
        &[MARKET_CONFIG_SEED, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );

    let (funding_pda, _) =
        Address::find_program_address(&[FUNDING_SEED, market_index_bytes.as_ref()], &PROGRAM_ID);

    let market_account = svm
        .get_account(&market_config_pda)
        .expect("Market not found");
    let market_state: &MarketConfig =
        bytemuck::from_bytes(&market_account.data[..MarketConfig::LEN]);
    let oracle = Address::from(market_state.oracle);

    let params = UpdateFundingRateParams {
        mark_price,
        market_index,
        padding: [0u8; 6],
    };

    let mut ix_data = vec![11u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(funding_pda, false),
        AccountMeta::new(oracle, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to update funding rate: {:?}",
        result.err()
    );
}

pub fn settle_funding(svm: &mut LiteSVM, payer: &Keypair, market_index: u16) {
    let signer_key = payer.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();

    let (user_account_pda, _) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &PROGRAM_ID);
    let (market_config_pda, _) = Address::find_program_address(
        &[MARKET_CONFIG_SEED, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (funding_pda, _) =
        Address::find_program_address(&[FUNDING_SEED, market_index_bytes.as_ref()], &PROGRAM_ID);
    let (position_pda, _) = Address::find_program_address(
        &[POSITION_SEED, &signer_key, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );

    let ix_data = vec![10u8];

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(user_account_pda, false),
        AccountMeta::new(position_pda, false),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(funding_pda, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to settle funding: {:?}",
        result.err()
    );
}

pub fn liquidate(svm: &mut LiteSVM, payer: &Keypair, market_index: u16, mint: &Address) {
    let signer_key = payer.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();

    let (user_account_pda, _) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &signer_key], &PROGRAM_ID);
    let (market_config_pda, _) = Address::find_program_address(
        &[MARKET_CONFIG_SEED, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (funding_pda, _) =
        Address::find_program_address(&[FUNDING_SEED, market_index_bytes.as_ref()], &PROGRAM_ID);
    let (position_pda, _) = Address::find_program_address(
        &[POSITION_SEED, &signer_key, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (authority_pda, bump_authority) =
        Address::find_program_address(&[VAULT_AUTHORITY_SEED], &PROGRAM_ID);

    let (vault_pda, _) = Address::find_program_address(&[VAULT_SEED], &PROGRAM_ID);
    let (insurance_pda, _) = Address::find_program_address(&[INSURANCE_SEED], &PROGRAM_ID);

    let market_account = svm
        .get_account(&market_config_pda)
        .expect("Market not found");
    let market_state: &MarketConfig =
        bytemuck::from_bytes(&market_account.data[..MarketConfig::LEN]);

    let oracle = Address::from(market_state.oracle);

    let liquidator_ata = create_token_account(svm, payer, mint, &payer.pubkey());
    mint_to(svm, payer, mint, &liquidator_ata, 1000000);

    let params = LiquidateParams {
        market_index,
        bump_authority,
        padding: [0u8; 5],
    };

    let mut ix_data = vec![12u8];
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(user_account_pda, false),
        AccountMeta::new(position_pda, false),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(funding_pda, false),
        AccountMeta::new(insurance_pda, false),
        AccountMeta::new(vault_pda, false),
        AccountMeta::new(authority_pda, false),
        AccountMeta::new(liquidator_ata, false),
        AccountMeta::new(oracle, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Failed to liquidate: {:?}", result.err());
}

pub fn cover_bad_debt(svm: &mut LiteSVM, caller: &Keypair, user: &Keypair, market_index: u16) {
    let user_key = user.pubkey().to_bytes();
    let market_index_bytes = market_index.to_le_bytes();

    let (user_account_pda, _) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, &user_key], &PROGRAM_ID);
    let (market_config_pda, _) = Address::find_program_address(
        &[MARKET_CONFIG_SEED, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (funding_pda, _) =
        Address::find_program_address(&[FUNDING_SEED, market_index_bytes.as_ref()], &PROGRAM_ID);
    let (position_pda, _) = Address::find_program_address(
        &[POSITION_SEED, &user_key, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (insurance_pda, _) = Address::find_program_address(&[INSURANCE_SEED], &PROGRAM_ID);

    let market_account = svm
        .get_account(&market_config_pda)
        .expect("Market not found");
    let market_state =
        bytemuck::from_bytes::<MarketConfig>(&market_account.data[..MarketConfig::LEN]);
    let oracle = Address::from(market_state.oracle);

    let params = CoverBadDebtParams {
        market_index,
        padding: [0u8; 6],
    };

    let mut ix_data = vec![13u8]; // CoverBadDebt discriminator
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(caller.pubkey(), true),
        AccountMeta::new(user_account_pda, false),
        AccountMeta::new(position_pda, false),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(funding_pda, false),
        AccountMeta::new(insurance_pda, false),
        AccountMeta::new(oracle, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&caller.pubkey()));
    let tx = Transaction::new(&[caller], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Failed to cover bad debt: {:?}",
        result.err()
    );

    // verify position wiped
    let pos_data = svm.get_account(&position_pda).unwrap();
    let pos = bytemuck::from_bytes::<Position>(&pos_data.data[..Position::LEN]);
    assert_eq!(pos.size, 0, "Position should be wiped");
    assert_eq!(pos.initial_margin, 0);

    // verify user collateral zeroed
    let ua_data = svm.get_account(&user_account_pda).unwrap();
    let ua = bytemuck::from_bytes::<UserAccount>(&ua_data.data[..UserAccount::LEN]);
    assert_eq!(ua.collateral, 0, "Collateral should be zeroed");
}

pub fn settle_fill(
    svm: &mut LiteSVM,
    caller: &Keypair, // acts as orderbook_program signer in tests
    market_index: u16,
    price_lots: i64,
    base_lots: i64,
    is_taker: u8,
    taker_side: u8,
    maker_pubkey: [u8; 32],
    taker_pubkey: [u8; 32],
) {
    let market_index_bytes = market_index.to_le_bytes();
    let trader_pubkey = if is_taker == 1 {
        taker_pubkey
    } else {
        maker_pubkey
    };
    let (user_account_pda, bump_user) =
        Address::find_program_address(&[USER_ACCOUNT_SEED, trader_pubkey.as_ref()], &PROGRAM_ID);
    let (position_pda, bump_position) = Address::find_program_address(
        &[
            POSITION_SEED,
            trader_pubkey.as_ref(),
            market_index_bytes.as_ref(),
        ],
        &PROGRAM_ID,
    );
    let (market_config_pda, _) = Address::find_program_address(
        &[MARKET_CONFIG_SEED, market_index_bytes.as_ref()],
        &PROGRAM_ID,
    );
    let (funding_pda, _) =
        Address::find_program_address(&[FUNDING_SEED, market_index_bytes.as_ref()], &PROGRAM_ID);

    let params = SettleFillParams {
        price_lots,
        base_lots,
        market_index,
        is_taker,
        taker_side,
        bump_position,
        bump_user,
        padding: [0u8; 2],
        maker_pubkey,
        taker_pubkey,
    };

    let mut ix_data = vec![9u8]; // SettleFill discriminator
    ix_data.extend_from_slice(bytemuck::bytes_of(&params));

    let accounts = vec![
        AccountMeta::new(caller.pubkey(), true), // orderbook_program signer
        AccountMeta::new(user_account_pda, false),
        AccountMeta::new(position_pda, false),
        AccountMeta::new(market_config_pda, false),
        AccountMeta::new(funding_pda, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: ix_data,
    };
    let msg = Message::new(&[ix], Some(&caller.pubkey()));
    let tx = Transaction::new(&[caller], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Failed to settle fill: {:?}", result.err());
}

// EXTRA HELPERS
pub fn create_mint(svm: &mut LiteSVM, payer: &Keypair) -> Address {
    CreateMint::new(svm, payer)
        .decimals(6)
        .authority(&payer.pubkey())
        .send()
        .unwrap()
}

pub fn create_token_account(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Address,
    owner: &Address,
) -> Address {
    CreateAccount::new(svm, payer, mint)
        .owner(owner)
        .send()
        .unwrap()
}

pub fn mint_to(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Address,
    destination: &Address,
    amount: u64,
) {
    MintTo::new(svm, payer, mint, destination, amount)
        .owner(payer)
        .send()
        .unwrap();
}

pub fn check_ata(svm: &mut LiteSVM, payer: &Keypair, mint: &Address, owner: &Address) -> Address {
    let ata = spl_associated_token_account::get_associated_token_address(owner, mint);

    if svm.get_account(&ata).is_none() {
        create_token_account(svm, &payer, &mint, &owner);
    }
    ata
}
