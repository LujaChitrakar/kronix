#[derive(PartialEq)]
#[repr(u8)]
pub enum BookSideOrderTree{
    Fixed = 0,
    OraclePegged = 1,
}
