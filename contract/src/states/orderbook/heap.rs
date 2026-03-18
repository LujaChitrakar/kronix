use bytemuck::{Pod, Zeroable};
use num_enum::{IntoPrimitive, TryFromPrimitive};
use pinocchio::error::ProgramError;

use crate::{
    constants::{EVENT_SIZE, MAX_NUM_EVENTS, NO_NODE},
    states::Side,
};

pub struct EventHeap {
    pub header: EventHeapHeader,
    pub nodes: [EventNode; MAX_NUM_EVENTS as usize],
    pub reserved: [u8; 64],
}
const _: () =
    assert!(size_of::<EventHeap>() == 16 + MAX_NUM_EVENTS as usize * (EVENT_SIZE + 8) + 64);
const _: () = assert!(size_of::<EventHeap>() % 8 == 0);

impl EventHeap {
    pub fn init(&mut self) {
        self.header = EventHeapHeader {
            free_head: 0,
            used_head: NO_NODE,
            count: 0,
            seq_num: 0,
            _padding: [0; 2],
        };

        for i in 0..MAX_NUM_EVENTS {
            self.nodes[i as usize].next = i + 1;
            self.nodes[i as usize].prev = NO_NODE;
        }
        self.nodes[MAX_NUM_EVENTS as usize - 1].next = NO_NODE;
    }

    pub fn len(&self) -> usize {
        self.header.count()
    }
    pub fn is_empty(&self) -> bool {
        self.header.count == 0
    }
    pub fn is_full(&self) -> bool {
        self.len() == self.nodes.len()
    }

    pub fn front(&self) -> Option<&AnyEvent> {
        if self.is_empty() {
            None
        } else {
            Some(&self.nodes[self.header.used_head()].event)
        }
    }

    pub fn at_slot(&self, slot: usize) -> Option<&AnyEvent> {
        if slot >= self.nodes.len() || self.nodes[slot].is_free() {
            None
        } else {
            Some(&self.nodes[slot].event)
        }
    }

    pub fn push_back(&mut self, value: AnyEvent) {
        assert!(!self.is_full());

        let slot = self.header.free_head;
        self.header.free_head = self.nodes[slot as usize].next;

        let new_next: u16;
        let new_prev: u16;

        if self.is_empty() {
            new_next = slot;
            new_prev = slot;

            self.header.used_head = slot;
        } else {
            new_next = self.header.used_head;
            new_prev = self.nodes[new_next as usize].prev;

            self.nodes[new_prev as usize].next = slot;
            self.nodes[new_next as usize].prev = slot;
        }
        self.header.increase_count();
        self.header.increase_event_id();
        self.nodes[slot as usize].event = value;
        self.nodes[slot as usize].next = new_next;
        self.nodes[slot as usize].prev = new_prev
    }

    pub fn pop_front(&mut self) -> Result<AnyEvent, ProgramError> {
        self.delete_slot(self.header.used_head())
    }

    pub fn delete_slot(&mut self, slot: usize) -> Result<AnyEvent, ProgramError> {
        if slot >= self.nodes.len() || self.is_empty() || self.nodes[slot].is_free() {
            return Err(ProgramError::InvalidAccountData);
        }

        let prev_slot = self.nodes[slot].prev;
        let next_slot = self.nodes[slot].next;
        let next_free = self.header.free_head;

        self.nodes[prev_slot as usize].next = next_slot;
        self.nodes[next_slot as usize].prev = prev_slot;

        if self.header.count() == 1 {
            self.header.used_head = NO_NODE;
        } else if self.header.used_head() == slot {
            self.header.used_head = next_slot;
        };

        self.header.decrease_count();
        self.header.free_head = slot.try_into().unwrap();
        self.nodes[slot].next = next_free;
        self.nodes[slot].prev = NO_NODE;

        Ok(self.nodes[slot].event)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&AnyEvent, usize)> {
        EventHeapIterator {
            heap: self,
            index: 0,
            slot: self.header.used_head(),
        }
    }
}

struct EventHeapIterator<'a> {
    heap: &'a EventHeap,
    index: usize,
    slot: usize,
}

impl<'a> Iterator for EventHeapIterator<'a> {
    type Item = (&'a AnyEvent, usize);

    fn next(&mut self) -> Option<Self::Item> {
        if self.index == self.heap.len() {
            return None;
        } else {
            let current_slot = self.slot;
            self.slot = self.heap.nodes[current_slot].next as usize;
            self.index = self
                .index
                .checked_add(1)
                .ok_or(ProgramError::ArithmeticOverflow)
                .unwrap();
            Some((&self.heap.nodes[current_slot].event, current_slot))
        }
    }
}

pub struct EventHeapHeader {
    free_head: u16,
    used_head: u16,
    count: u16,
    _padding: [u8; 2],
    pub seq_num: u64,
}
const _: () = assert!(size_of::<EventHeapHeader>() == 16);
const _: () = assert!(size_of::<EventHeap>() % 8 == 0);

impl EventHeapHeader {
    pub fn count(&self) -> usize {
        self.count as usize
    }
    pub fn free_head(&self) -> usize {
        self.free_head as usize
    }
    pub fn used_head(&self) -> usize {
        self.used_head as usize
    }
    pub fn increase_count(&mut self) {
        self.count = self.count.checked_add(1).unwrap();
    }
    pub fn decrease_count(&mut self) {
        self.count = self.count.checked_sub(1).unwrap();
    }
    pub fn increase_event_id(&mut self) {
        self.seq_num = self.seq_num.checked_add(1).unwrap();
    }
}

#[derive(Debug)]
pub struct EventNode {
    next: u16,
    prev: u16,
    _padding: [u8; 4],
    pub event: AnyEvent,
}
const _: () = assert!(size_of::<EventNode>() == 8 + EVENT_SIZE);
const _: () = assert!(size_of::<EventNode>() % 8 == 0);

impl EventNode {
    pub fn is_free(&self) -> bool {
        self.prev == NO_NODE
    }
}

#[derive(Debug, Copy, Clone)]
pub struct AnyEvent {
    pub event_type: u8,
    pub padding: [u8; 143],
}
const _: () = assert!(size_of::<AnyEvent>() == EVENT_SIZE);
const _: () = assert!(size_of::<AnyEvent>() % 8 == 0);

#[derive(Copy, Clone, IntoPrimitive, TryFromPrimitive, Eq, PartialEq)]
#[repr(u8)]
pub enum EventType {
    Fill,
    Out,
}

#[derive(Copy, Clone, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct FillEvent {
    pub event_type: u8,
    pub taker_side: u8,
    pub maker_out: u8, //1 if maker order quanity==0
    pub maker_slot: u8,
    pub _padding: [u8; 4],
    pub timestamp: u64,
    pub maker_seq_num: u64,
    // When order was placed
    pub maker_timestamp: u64,
    pub maker_client_order_id: u64,
    pub taker_client_order_id: u64,
    pub price: i64,
    pub quantity: i64, //no of base lots
    pub peg_limit: i64,
    pub maker_pubkey: [u8; 32],
    pub taker_pubkey: [u8; 32],
    pub reserved: [u8; 8],
}
const _: () = assert!(size_of::<FillEvent>() == EVENT_SIZE);
const _: () = assert!(size_of::<FillEvent>() % 8 == 0);

impl FillEvent {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        taker_side: Side,
        maker_out: bool,
        maker_slot: u8,
        timestamp: u64,
        maker_seq_num: u64,
        maker_timestamp: u64,
        maker_client_order_id: u64,
        taker_client_order_id: u64,
        price: i64,
        quantity: i64,
        peg_limit: i64,
        maker_pubkey: [u8; 32],
        taker_pubkey: [u8; 32],
    ) -> Self {
        Self {
            event_type: EventType::Fill as u8,
            taker_side: taker_side as u8,
            maker_out: maker_out as u8,
            maker_slot,
            timestamp,
            maker_seq_num,
            maker_timestamp,
            maker_client_order_id,
            taker_client_order_id,
            price,
            quantity,
            peg_limit,
            maker_pubkey,
            taker_pubkey,
            _padding: [0u8; 4],
            reserved: [0u8; 8],
        }
    }

    pub fn taker_side(&self) -> Side {
        self.taker_side.try_into().unwrap()
    }

    pub fn maker_out(&self) -> bool {
        self.maker_out == 1
    }
}

#[derive(Debug, Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct OutEvent {
    pub event_type: u8,
    pub side: u8,
    pub owner_slot: u8,
    pub _padding: [u8; 5],
    pub timestamp: u64,
    pub seq_num: u64,
    pub quantity: i64,
    pub owner: [u8; 32],
    pub reserved: [u8; 80],
}
const _: () = assert!(size_of::<OutEvent>() == EVENT_SIZE);
const _: () = assert!(size_of::<OutEvent>() % 8 == 0);

impl OutEvent {
    pub fn new(
        side: Side,
        owner_slot: u8,
        timestamp: u64,
        seq_num: u64,
        quantity: i64,
        owner: [u8; 32],
    ) -> Self {
        Self {
            event_type: EventType::Out as u8,
            side: side as u8,
            owner_slot,
            timestamp,
            seq_num,
            quantity,
            owner,
            _padding: [0u8; 5],
            reserved: [0u8; 80],
        }
    }

    pub fn side(&self) -> Side {
        self.side.try_into().unwrap()
    }
}
