#[cfg(test)]
pub mod helper;

#[cfg(test)]
mod tests {
    use crate::tests::helper::{
        cancel_order, create_market, open_orders_account, place_order, setup,
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

        place_order(&mut svm, &market_index, &user1, side);
    }

    #[test]
    pub fn test_cancel_order() {
        let (mut svm, user1, _) = setup();
        let market_index = create_market(&mut svm, &user1);
        let _user_oo = open_orders_account(&mut svm, &market_index, &user1);
        let side = 0u8;
        let side = place_order(&mut svm, &market_index, &user1, side);
        cancel_order(&mut svm, &market_index, &user1, side);
    }
}
