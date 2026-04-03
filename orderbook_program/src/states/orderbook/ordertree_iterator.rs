use crate::{
    constants::ITER_STACK_DEPTH,
    states::{LeafNode, NodeHandle, NodeRef, OrderTreeNodes, OrderTreeRoot, OrderTreeType, Side},
};

// Iterate over the orders in an order tree( Accending for bids, descending for asks)
pub struct OrderTreeIter<'a> {
    order_tree: &'a OrderTreeNodes,
    // Innernode where the right side still has to be iterated on
    stack: [(NodeHandle, bool); ITER_STACK_DEPTH],
    // to keep track of the next leaf to return
    next_leaf: Option<(NodeHandle, &'a LeafNode)>,
    stack_len: usize,
    left: usize,
    right: usize,
}

impl<'a> OrderTreeIter<'a> {
    pub fn new(order_tree: &'a OrderTreeNodes, root: &OrderTreeRoot) -> Self {
        let (left, right) = if order_tree.order_tree_type() == OrderTreeType::Bids {
            (1, 0)
        } else {
            (0, 1)
        };
        let mut iter = Self {
            order_tree,
            stack: [(0, false); ITER_STACK_DEPTH],
            stack_len: 0,
            next_leaf: None,
            left,
            right,
        };
        if let Some(r) = root.node() {
            iter.next_leaf = iter.find_left_most_leaf(r);
        }
        iter
    }

    pub fn side(&self) -> Side {
        if self.left == 1 {
            Side::Bid
        } else {
            Side::Ask
        }
    }

    pub fn peek(&self) -> Option<(NodeHandle, &'a LeafNode)> {
        self.next_leaf
    }

    fn find_left_most_leaf(&mut self, start: NodeHandle) -> Option<(NodeHandle, &'a LeafNode)> {
        let mut current = start;
        loop {
            match self.order_tree.node(current).unwrap().case().unwrap() {
                NodeRef::Inner(inner) => {
                    if self.stack_len < ITER_STACK_DEPTH {
                        self.stack[self.stack_len] = (current, false); // store inner node handle
                        self.stack_len += 1;
                    }
                    current = inner.children[self.left];
                }
                NodeRef::Leaf(leaf) => {
                    return Some((current, leaf));
                }
            }
        }
    }
}

impl<'a> Iterator for OrderTreeIter<'a> {
    type Item = (NodeHandle, &'a LeafNode);

    fn next(&mut self) -> Option<Self::Item> {
        let current_left = self.next_leaf?;

        self.next_leaf = if self.stack_len == 0 {
            None
        } else {
            self.stack_len -= 1;
            let (inner_handle, _) = self.stack[self.stack_len];
            let inner = match self.order_tree.node(inner_handle).unwrap().case().unwrap() {
                NodeRef::Inner(inner) => inner,
                _ => unreachable!(),
            };
            let start = inner.children[self.right];
            self.find_left_most_leaf(start)
        };

        Some(current_left)
    }
}
