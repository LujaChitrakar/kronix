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

export const RISK_ERRORS: Record<number, string> = {
  1: "InvalidAmount",
  2: "ExceedsMaxLeverage",
  3: "InvalidOracle",
  4: "StalePriceFeed",
  5: "OracleConfidenceTooWide",
  6: "InvalidOraclePrice",
  7: "InvalidOwner",
  8: "InsufficientCollateral",
  9: "InvalidSide",
  10: "InvalidMarketIndex",
  11: "InvalidPositionSize",
  12: "PositionAlreadyOpen",
  13: "FundingNotDue",
  14: "InsufficientMaintenanceMargin",
  15: "InsuranceFundDepleted",
  16: "NotLiquidatable",
  17: "NotInBadDebt",
};

export const TRIGGER_ERRORS: Record<number, string> = {
  0: "InvalidSize",
  1: "InvalidTriggerPrice",
  2: "InvalidTriggerType",
  3: "InvalidOwner",
  4: "TriggerNotActive",
  5: "TriggerExpired",
  6: "TriggerConditionNotMet",
  7: "InvalidOOAccount",
  8: "EditTriggerFailed",
  9: "InvalidExpiry",
  10: "TriggerNotPaused",
  11: "NoMatchingPosition — TP/SL can only execute after a matching open position exists",
};

export function annotateOrderbookError(s: string): string {
  // Match either {"Custom":15} or 0xf / 0x0f patterns and append name.
  return s.replace(/(?:"Custom":\s*(\d+))|custom program error:\s*(\d+)|custom\s+(\d+)|0x([0-9a-f]+)/gi, (_full, jsonDec, programDec, plainDec, hex) => {
    const dec = jsonDec ?? programDec ?? plainDec;
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    const names = [
      ORDERBOOK_ERRORS[code] ? `Orderbook: ${ORDERBOOK_ERRORS[code]}` : null,
      RISK_ERRORS[code] ? `Risk: ${RISK_ERRORS[code]}` : null,
      TRIGGER_ERRORS[code] ? `Trigger: ${TRIGGER_ERRORS[code]}` : null,
    ].filter(Boolean);
    if (names.length === 0) return _full;
    return `${_full} (${names.join("; ")})`;
  });
}
