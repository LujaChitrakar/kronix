// Hand-written. Mirrors strategy_program/src/states/strategy.rs `StrategyAccount`.
// Codama emitted incorrect layout (wrong field types/order) — replaced.

import {
  combineCodec,
  fixDecoderSize,
  fixEncoderSize,
  getBytesDecoder,
  getBytesEncoder,
  getI64Decoder,
  getI64Encoder,
  getStructDecoder,
  getStructEncoder,
  getU16Decoder,
  getU16Encoder,
  getU64Decoder,
  getU64Encoder,
  getU8Decoder,
  getU8Encoder,
  type FixedSizeCodec,
  type FixedSizeDecoder,
  type FixedSizeEncoder,
  type ReadonlyUint8Array,
} from "@solana/kit";
import {
  getStrategyParamsDecoder,
  getStrategyParamsEncoder,
  type StrategyParams,
  type StrategyParamsArgs,
} from "./strategyParams";

export type StrategyAccount = {
  clientOrderId: bigint;
  takeProfitPrice: bigint;
  stopLossPrice: bigint;
  sizeLots: bigint;
  limitPriceLots: bigint;
  createdAt: bigint;
  dayStartTs: bigint;
  lastExecutedTs: bigint;
  cooldownSecs: bigint;
  maxExecutionsPerDay: bigint;
  executionsToday: bigint;
  strategyType: number;
  status: number;
  bump: number;
  side: number;
  marketIndex: number;
  leverage: number;
  padding: ReadonlyUint8Array;
  params: StrategyParams;
  owner: ReadonlyUint8Array;
  reserved: ReadonlyUint8Array;
};

export type StrategyAccountArgs = {
  clientOrderId: number | bigint;
  takeProfitPrice: number | bigint;
  stopLossPrice: number | bigint;
  sizeLots: number | bigint;
  limitPriceLots: number | bigint;
  createdAt: number | bigint;
  dayStartTs: number | bigint;
  lastExecutedTs: number | bigint;
  cooldownSecs: number | bigint;
  maxExecutionsPerDay: number | bigint;
  executionsToday: number | bigint;
  strategyType: number;
  status: number;
  bump: number;
  side: number;
  marketIndex: number;
  leverage: number;
  padding: ReadonlyUint8Array;
  params: StrategyParamsArgs;
  owner: ReadonlyUint8Array;
  reserved: ReadonlyUint8Array;
};

export function getStrategyAccountEncoder(): FixedSizeEncoder<StrategyAccountArgs> {
  return getStructEncoder([
    ["clientOrderId", getU64Encoder()],
    ["takeProfitPrice", getI64Encoder()],
    ["stopLossPrice", getI64Encoder()],
    ["sizeLots", getI64Encoder()],
    ["limitPriceLots", getI64Encoder()],
    ["createdAt", getI64Encoder()],
    ["dayStartTs", getI64Encoder()],
    ["lastExecutedTs", getI64Encoder()],
    ["cooldownSecs", getU64Encoder()],
    ["maxExecutionsPerDay", getU64Encoder()],
    ["executionsToday", getU64Encoder()],
    ["strategyType", getU8Encoder()],
    ["status", getU8Encoder()],
    ["bump", getU8Encoder()],
    ["side", getU8Encoder()],
    ["marketIndex", getU16Encoder()],
    ["leverage", getU8Encoder()],
    ["padding", fixEncoderSize(getBytesEncoder(), 1)],
    ["params", getStrategyParamsEncoder()],
    ["owner", fixEncoderSize(getBytesEncoder(), 32)],
    ["reserved", fixEncoderSize(getBytesEncoder(), 32)],
  ]);
}

export function getStrategyAccountDecoder(): FixedSizeDecoder<StrategyAccount> {
  return getStructDecoder([
    ["clientOrderId", getU64Decoder()],
    ["takeProfitPrice", getI64Decoder()],
    ["stopLossPrice", getI64Decoder()],
    ["sizeLots", getI64Decoder()],
    ["limitPriceLots", getI64Decoder()],
    ["createdAt", getI64Decoder()],
    ["dayStartTs", getI64Decoder()],
    ["lastExecutedTs", getI64Decoder()],
    ["cooldownSecs", getU64Decoder()],
    ["maxExecutionsPerDay", getU64Decoder()],
    ["executionsToday", getU64Decoder()],
    ["strategyType", getU8Decoder()],
    ["status", getU8Decoder()],
    ["bump", getU8Decoder()],
    ["side", getU8Decoder()],
    ["marketIndex", getU16Decoder()],
    ["leverage", getU8Decoder()],
    ["padding", fixDecoderSize(getBytesDecoder(), 1)],
    ["params", getStrategyParamsDecoder()],
    ["owner", fixDecoderSize(getBytesDecoder(), 32)],
    ["reserved", fixDecoderSize(getBytesDecoder(), 32)],
  ]);
}

export function getStrategyAccountCodec(): FixedSizeCodec<
  StrategyAccountArgs,
  StrategyAccount
> {
  return combineCodec(getStrategyAccountEncoder(), getStrategyAccountDecoder());
}

export const STRATEGY_ACCOUNT_LEN = 312;
