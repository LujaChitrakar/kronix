#[cfg(test)]
pub mod helper;
// maker side 1 =ask
// take side 0 =bid

#[cfg(test)]
mod tests {
    use crate::{
        states::OpenOrdersAccount,
        tests::helper::{
            cancel_all_order, cancel_order, cancel_order_by_client_id, claim_fill, create_market,
            edit_order, open_orders_account, place_order, place_take_order, prune_orders, setup,
        },
    };

    #[test]
    pub fn test_01_create_market() {
        let (mut svm, admin, _) = setup();
        create_market(&mut svm, &admin);
    }

    #[test]
    pub fn test_02_open_orders_account() {
        let (mut svm, user1, _) = setup();
        let market_index = create_market(&mut svm, &user1);
        open_orders_account(&mut svm, &market_index, &user1);
    }

    #[test]
    pub fn test_03_place_order() {
        let (mut svm, user1, _) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let side = 0u8;

        place_order(&mut svm, &market_index, &user1, side, 0, 1, 50, None);
    }

    #[test]
    pub fn test_04_place_take_order() {
        let (mut svm, user1, _user2) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let bids_side = 0u8;
        place_take_order(
            &mut svm,
            &market_index,
            &user1,
            bids_side,
            1,
            10,
            100,
            10,
            1,
            100,
            None,
        );
    }

    #[test]
    pub fn test_06_edit_order() {
        let (mut svm, user1, _user2) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let bids_side = 0u8;
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 1, 48, None);

        edit_order(
            &mut svm,
            &market_index,
            &user1,
            bids_side,
            0,
            0,
            49,
            10,
            100,
            1,
            1000,
        );
    }

    // #[test]
    // pub fn test_07_cancel_order() {
    //     let (mut svm, user1, _) = setup();
    //     let market_index = create_market(&mut svm, &user1);
    //     let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
    //     let side = 0u8;
    //     let side = place_order(&mut svm, &market_index, &user1, side, 0, 1, 50, None);
    //     cancel_order(&mut svm, &market_index, &user1, side);
    // }

    #[test]
    pub fn test_08_cancel_all_order_only_bids() {
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
    #[test]
    pub fn test_09_cancel_all_order_only_asks() {
        let (mut svm, user1, _user2) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let bids_side = 0u8;
        let asks_side = 1u8;
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 1, 48, None);
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 2, 49, None);
        place_order(&mut svm, &market_index, &user1, asks_side, 0, 3, 51, None);
        cancel_all_order(&mut svm, &market_index, &user1, asks_side, None, 10);
    }

    #[test]
    pub fn test_10_cancel_all_order_no_filter() {
        let (mut svm, user1, _user2) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let bids_side = 0u8;
        let asks_side = 1u8;
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 1, 48, None);
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 2, 49, None);
        place_order(&mut svm, &market_index, &user1, asks_side, 0, 3, 51, None);
        cancel_all_order(&mut svm, &market_index, &user1, bids_side, None, 10);
        // cancel_remainings
        cancel_all_order(&mut svm, &market_index, &user1, 255, None, 10);
    }

    #[test]
    pub fn test_11_cancel_order_by_client_id() {
        let (mut svm, user1, _user2) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let bids_side = 0u8;
        let asks_side = 1u8;
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 1, 48, None);
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 2, 49, None);
        place_order(&mut svm, &market_index, &user1, asks_side, 0, 3, 51, None);
        cancel_order_by_client_id(&mut svm, &market_index, &user1, 1);
    }

    #[test]
    pub fn test_12_claim_fill() {
        let (mut svm, user1, user2) = setup();
        let market_index = create_market(&mut svm, &user1);
        let maker_oo_pda = open_orders_account(&mut svm, &market_index, &user1);
        let _taker_oo_pda = open_orders_account(&mut svm, &market_index, &user2);

        let asks_side = 1u8;
        let bids_side = 0u8;

        place_order(&mut svm, &market_index, &user1, asks_side, 0, 1, 50, None);
        place_order(
            &mut svm,
            &market_index,
            &user2,
            bids_side,
            3,
            2,
            50,
            Some(maker_oo_pda),
        );

        claim_fill(&mut svm, &market_index, &user1, maker_oo_pda);
    }

    #[test]
    pub fn test_13_prune_orders() {
        let (mut svm, user1, _user2) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let bids_side = 0u8;
        let asks_side = 1u8;
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 1, 48, None);
        place_order(&mut svm, &market_index, &user1, bids_side, 0, 2, 49, None);

        prune_orders(&mut svm, &market_index, &user1, bids_side, 10);
        prune_orders(&mut svm, &market_index, &user1, asks_side, 10);
        prune_orders(&mut svm, &market_index, &user1, 255, 10);
    }

    #[test]
    pub fn test_05_orders_are_matching() {
        let (mut svm, user1, user2) = setup();
        let market_index = create_market(&mut svm, &user1);

        let maker_oo = open_orders_account(&mut svm, &market_index, &user1);
        let taker_oo = open_orders_account(&mut svm, &market_index, &user2);

        place_order(&mut svm, &market_index, &user1, 1, 0, 1, 50, None);
        place_order(&mut svm, &market_index, &user2, 0, 0, 2, 50, Some(maker_oo));

        // verify maker has fill recorded
        let oo_data = svm.get_account(&maker_oo).unwrap();
        let oo_state =
            bytemuck::from_bytes::<OpenOrdersAccount>(&oo_data.data[..OpenOrdersAccount::LEN]);
        let maker_filled = oo_state.open_orders.iter().any(|o| o.is_filled == 1);
        assert!(maker_filled, "Maker should have a fill recorded");

        // verify taker did not post to book
        let oo_data = svm.get_account(&taker_oo).unwrap();
        let oo_state =
            bytemuck::from_bytes::<OpenOrdersAccount>(&oo_data.data[..OpenOrdersAccount::LEN]);
        let taker_active = oo_state
            .open_orders
            .iter()
            .filter(|o| o.is_free == 0)
            .count();
        assert_eq!(
            taker_active, 0,
            "Taker should be fully matched, not posted to book"
        );

        // maker claims fill
        claim_fill(&mut svm, &market_index, &user1, maker_oo);

        // verify fill cleared
        let oo_data = svm.get_account(&maker_oo).unwrap();
        let oo_state =
            bytemuck::from_bytes::<OpenOrdersAccount>(&oo_data.data[..OpenOrdersAccount::LEN]);
        let still_filled = oo_state.open_orders.iter().any(|o| o.is_filled == 1);
        assert!(!still_filled, "Fill should be cleared after claim");
        let maker_active_final = oo_state
            .open_orders
            .iter()
            .filter(|o| o.is_free == 0)
            .count();
        assert_eq!(
            maker_active_final, 0,
            "Maker slot should be free after claim"
        );
    }
}
