use crate::states::{
    BookSide, LeafNode, OrderTreeIter, fixed_price_lots,
};

pub struct BookSideIterItem<'a> {
    pub node: &'a LeafNode,
    pub price_lots: i64,
    pub state: OrderState,
}

impl<'a> BookSideIterItem<'a> {
    pub fn is_valid(&self) -> bool {
        self.state == OrderState::Valid
    }
}

// Iterates the fixed and oracle pegged orderTrees simultaneously,
// allowing users to walk the orderbook without cargin where the order came from.
pub struct BookSideIter<'a> {
    inner: OrderTreeIter<'a>,
    now_ts: u64,
}

impl<'a> BookSideIter<'a> {
    pub fn new(book_side: &'a BookSide, now_ts: u64) -> Self {
        Self {
            inner: book_side.nodes.iter(&book_side.roots),
            now_ts,
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum OrderState {
    Valid,
    Invalid,
}

impl<'a> Iterator for BookSideIter<'a> {
    type Item = BookSideIterItem<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        let (_, node) = self.inner.next()?;
        let expired = node.is_expired(self.now_ts);
        Some(BookSideIterItem {
            node,
            price_lots: fixed_price_lots(node.price_data()).unwrap(),
            state: if expired {
                OrderState::Invalid
            } else {
                OrderState::Valid
            },
        })
    }
}
