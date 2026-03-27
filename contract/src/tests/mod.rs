#[cfg(test)]
pub mod helper;
// maker side 1 =ask
// take side 0 =bid

#[cfg(test)]
mod tests {
    use crate::{
        states::OpenOrdersAccount,
        tests::helper::{
            cancel_all_order, cancel_order, claim_fill, create_market, open_orders_account,
            place_order, setup,
        },
    };

    #[test]
    pub fn test_create_market() {
        let (mut svm, admin, _) = setup();
        create_market(&mut svm, &admin);
    }

    #[test]
    pub fn test_open_orders_account() {
        let (mut svm, user1, _) = setup();
        let market_index = create_market(&mut svm, &user1);
        open_orders_account(&mut svm, &market_index, &user1);
    }

    #[test]
    pub fn test_place_order() {
        let (mut svm, user1, _) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let side = 0u8;

        place_order(&mut svm, &market_index, &user1, side, 0, 1,50, None);
    }

    #[test]
    pub fn test_cancel_order() {
        let (mut svm, user1, _) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let side = 0u8;
        let side = place_order(&mut svm, &market_index, &user1, side, 0, 1,50, None);
        cancel_order(&mut svm, &market_index, &user1, side);
    }

    #[test]
    pub fn test_claim_fill() {
        let (mut svm, user1, user2) = setup();
        let market_index = create_market(&mut svm, &user1);
        let maker_oo_pda = open_orders_account(&mut svm, &market_index, &user1);
        let taker_oo_pda = open_orders_account(&mut svm, &market_index, &user2);

        let asks_side = 1u8;
        let bids_side = 0u8;

        place_order(&mut svm, &market_index, &user1, asks_side, 0, 1,50, None);
        place_order(
            &mut svm,
            &market_index,
            &user2,
            bids_side,
            3,
            2,50,
            Some(maker_oo_pda),
        );

        let maker_oo_data = svm.get_account(&maker_oo_pda).unwrap();
        let maker_oo = bytemuck::from_bytes::<OpenOrdersAccount>(
            &maker_oo_data.data[..OpenOrdersAccount::LEN],
        );
        for (i, oo) in maker_oo.open_orders.iter().enumerate() {
            if !oo.is_free() || oo.is_filled == 1 {
                println!(
                    "slot {}: is_free={}, is_filled={}, filled_qty={}, fill_price={}, id={:?}",
                    i, oo.is_free, oo.is_filled, oo.filled_qty, oo.fill_price, oo.id
                );
            }
        }

        claim_fill(&mut svm, &market_index, &user1, maker_oo_pda, taker_oo_pda);
    }

    #[test]
    pub fn test_cancel_all_order() {
        let (mut svm, user1, _user2) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let bids_side = 0u8;
        let asks_side = 1u8;
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 1, 48, None);
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 2, 49, None);
        place_order(&mut svm, &market_index, &user1, asks_side, 0, 3, 51, None);
        cancel_all_order(&mut svm, &market_index, &user1, bids_side, None, 10);
    }
}
