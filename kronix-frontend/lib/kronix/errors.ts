export const ORDERBOOK_ERRORS: Record<number, string> = {
  1: "InvalidOrderType",
  2: "InvalidOrderPostMarket",
  3: "InvalidOrderPostIOC",
  4: "InvalidOrderPostFOC",
  5: "InvalidPriceLots",
  6: "InvalidPriceData",
  7: "OracleFeedMismatch",
  8: "OracleStale",
  9: "InvalidOraclePrice",
  10: "OracleConfidenceTooLow",
  11: "InvalidOracle",
  12: "OpenOrdersFull",
  13: "OrderNotFound",
  14: "InvalidInputLotsSize",
  15: "WouldSelfTrade — your own resting order is on the opposite side at this price; cancel it first or pick a non-crossing price",
  16: "WouldExecutePartially",
  17: "InvalidPostAmount",
  18: "BookFull",
  19: "OrderIdNotFound",
  20: "InvalidOwner",
  21: "InvalidSystemProgram",
  22: "MarketInactive",
  23: "OrderAlreadyExpired",
  24: "OpenOrderNotFound",
  25: "InvalidSide",
  26: "InvalidOrderSlot",
  27: "NoFillToClaim",
  28: "InvalidInputLots",
  29: "PreviousFillsNotSettled — prior fills_log still has unsettled fills; wait for keeper or call settle_fills",
  30: "InvalidMarket",
  31: "InvalidMakerAccount",
};

export function annotateOrderbookError(s: string): string {
  // Match either {"Custom":15} or 0xf / 0x0f patterns and append name.
  return s.replace(/(?:"Custom":\s*(\d+))|0x([0-9a-f]+)/gi, (_full, dec, hex) => {
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    const name = ORDERBOOK_ERRORS[code];
    if (!name) return _full;
    return `${_full} (${name})`;
  });
}
