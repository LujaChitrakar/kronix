#[cfg(feature = "devnet")]
use solana_client::rpc_config::CommitmentConfig;
use solana_keypair::Keypair;
#[cfg(feature = "devnet")]
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_sdk::account::Account;
use solana_sdk::hash::Hash;
use solana_signer::Signer;
use solana_transaction::Transaction;
#[cfg(feature = "devnet")]
use std::time::Duration;

#[cfg(not(feature = "devnet"))]
use litesvm::LiteSVM;

#[cfg(feature = "devnet")]
use solana_client::rpc_client::RpcClient;

#[derive(Debug)]
pub struct TransactionResult {
    pub compute_units_consumed: u64,
}

pub struct TestClient {
    #[cfg(not(feature = "devnet"))]
    pub svm: LiteSVM,

    #[cfg(feature = "devnet")]
    pub rpc: RpcClient,
}

#[cfg(feature = "devnet")]
use spl_token;

#[cfg(feature = "devnet")]
use spl_associated_token_account;

impl TestClient {
    #[cfg(not(feature = "devnet"))]
    pub fn new() -> Self {
        Self {
            svm: LiteSVM::new(),
        }
    }

    #[cfg(feature = "devnet")]
    pub fn new() -> Self {
        let url = std::env::var("RPC_URL")
            .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());
        Self {
            rpc: RpcClient::new_with_commitment(&url, CommitmentConfig::confirmed()),
        }
    }

    pub fn airdrop(
        &mut self,
        pubkey: &Pubkey,
        lamports: u64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        #[cfg(not(feature = "devnet"))]
        {
            self.svm
                .airdrop(pubkey, lamports)
                .map(|_| ())
                .map_err(|e| format!("{:?}", e).into())
        }
        #[cfg(feature = "devnet")]
        {
            let sig = self.rpc.request_airdrop(pubkey, lamports)?;
            loop {
                let confirmed = self.rpc.confirm_transaction(&sig)?;
                if confirmed {
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            Ok(())
        }
    }

    pub fn get_account(&self, pubkey: &Pubkey) -> Option<Account> {
        #[cfg(not(feature = "devnet"))]
        return self.svm.get_account(pubkey);

        #[cfg(feature = "devnet")]
        return self.rpc.get_account(pubkey).ok();
    }

    pub fn set_account(
        &mut self,
        #[cfg(not(feature = "devnet"))] pubkey: Pubkey,
        #[cfg(not(feature = "devnet"))] account: Account,
        #[cfg(feature = "devnet")] _pubkey: Pubkey,
        #[cfg(feature = "devnet")] _account: Account,
    ) -> Result<(), Box<dyn std::error::Error>> {
        #[cfg(not(feature = "devnet"))]
        {
            self.svm.set_account(pubkey, account).unwrap();
            Ok(())
        }
        #[cfg(feature = "devnet")]
        {
            panic!("set_account is not supported on Devnet.");
        }
    }

    pub fn latest_blockhash(&self) -> Hash {
        #[cfg(not(feature = "devnet"))]
        return self.svm.latest_blockhash();

        #[cfg(feature = "devnet")]
        return self.rpc.get_latest_blockhash().unwrap();
    }

    pub fn add_program(&mut self, _program_id: Pubkey, _program_data: &[u8]) {
        #[cfg(not(feature = "devnet"))]
        {
            self.svm.add_program(_program_id, _program_data).unwrap();
        }
    }

    pub fn send_transaction(
        &mut self,
        tx: Transaction,
    ) -> Result<TransactionResult, Box<dyn std::error::Error>> {
        #[cfg(not(feature = "devnet"))]
        {
            let res = self
                .svm
                .send_transaction(tx)
                .map_err(|e| format!("{:?}", e))?;
            Ok(TransactionResult {
                compute_units_consumed: res.compute_units_consumed,
            })
        }

        #[cfg(feature = "devnet")]
        {
            let _sig = self.rpc.send_and_confirm_transaction(&tx)?;
            Ok(TransactionResult {
                compute_units_consumed: 0,
            })
        }
    }

    pub fn create_mint(
        &mut self,
        admin: &Keypair,
        decimals: u8,
    ) -> Result<Pubkey, Box<dyn std::error::Error>> {
        #[cfg(not(feature = "devnet"))]
        {
            let mint = litesvm_token::CreateMint::new(&mut self.svm, admin)
                .decimals(decimals)
                .authority(&admin.pubkey())
                .send()
                .map_err(|e| format!("{:?}", e))?;
            Ok(mint)
        }
        #[cfg(feature = "devnet")]
        {
            let mint_keypair = Keypair::new();
            let space = 82;
            let lamports = self.rpc.get_minimum_balance_for_rent_exemption(space)?;
            let ix1 = solana_system_interface::instruction::create_account(
                &admin.pubkey(),
                &mint_keypair.pubkey(),
                lamports,
                space as u64,
                &spl_token::id(),
            );
            let ix2 = spl_token::instruction::initialize_mint(
                &spl_token::id(),
                &mint_keypair.pubkey(),
                &admin.pubkey(),
                None,
                decimals,
            )?;
            let msg = Message::new(&[ix1, ix2], Some(&admin.pubkey()));
            let tx = Transaction::new(&[admin, &mint_keypair], msg, self.latest_blockhash());
            self.send_transaction(tx)?;
            Ok(mint_keypair.pubkey())
        }
    }

    pub fn create_ata(
        &mut self,
        payer: &Keypair,
        owner: &Pubkey,
        mint: &Pubkey,
    ) -> Result<Pubkey, Box<dyn std::error::Error>> {
        #[cfg(not(feature = "devnet"))]
        {
            let ata = litesvm_token::CreateAssociatedTokenAccount::new(&mut self.svm, payer, mint)
                .owner(owner)
                .send()
                .map_err(|e| format!("{:?}", e))?;
            Ok(ata)
        }
        #[cfg(feature = "devnet")]
        {
            let ata = spl_associated_token_account::get_associated_token_address(owner, mint);
            if self.get_account(&ata).is_some() {
                return Ok(ata);
            }

            let ix = spl_associated_token_account::instruction::create_associated_token_account(
                &payer.pubkey(),
                owner,
                mint,
                &spl_token::id(),
            );
            let msg = Message::new(&[ix], Some(&payer.pubkey()));
            let tx = Transaction::new(&[payer], msg, self.latest_blockhash());
            self.send_transaction(tx)?;
            Ok(ata)
        }
    }

    pub fn mint_to(
        &mut self,
        admin: &Keypair,
        mint: &Pubkey,
        ata: &Pubkey,
        amount: u64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        #[cfg(not(feature = "devnet"))]
        {
            litesvm_token::MintTo::new(&mut self.svm, admin, mint, ata, amount)
                .send()
                .map_err(|e| format!("{:?}", e))?;
            Ok(())
        }
        #[cfg(feature = "devnet")]
        {
            let ix = spl_token::instruction::mint_to(
                &spl_token::id(),
                mint,
                ata,
                &admin.pubkey(),
                &[],
                amount,
            )?;
            let msg = Message::new(&[ix], Some(&admin.pubkey()));
            let tx = Transaction::new(&[admin], msg, self.latest_blockhash());
            self.send_transaction(tx)?;
            Ok(())
        }
    }
}
