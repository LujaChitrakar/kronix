// Hand-written. Mirrors strategy_program/src/instructions/create_strategy.rs `CreateStrategyParams`.

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

export type CreateStrategyParams = {
  clientOrderId: bigint;
  sizeLots: bigint;
  limitPriceLots: bigint;
  takeProfitPrice: bigint;
  stopLossPrice: bigint;
  cooldownSecs: bigint;
  maxExecutionsPerDay: bigint;
  marketIndex: number;
  bump: number;
  strategyType: number;
  side: number;
  bumpAuthority: number;
  bumpFillsLog: number;
  leverage: number;
  params: StrategyParams;
};

export type CreateStrategyParamsArgs = {
  clientOrderId: number | bigint;
  sizeLots: number | bigint;
  limitPriceLots: number | bigint;
  takeProfitPrice: number | bigint;
  stopLossPrice: number | bigint;
  cooldownSecs: number | bigint;
  maxExecutionsPerDay: number | bigint;
  marketIndex: number;
  bump: number;
  strategyType: number;
  side: number;
  bumpAuthority: number;
  bumpFillsLog: number;
  leverage: number;
  params: StrategyParamsArgs;
};

export function getCreateStrategyParamsEncoder(): FixedSizeEncoder<CreateStrategyParamsArgs> {
  return getStructEncoder([
    ["clientOrderId", getU64Encoder()],
    ["sizeLots", getI64Encoder()],
    ["limitPriceLots", getI64Encoder()],
    ["takeProfitPrice", getI64Encoder()],
    ["stopLossPrice", getI64Encoder()],
    ["cooldownSecs", getU64Encoder()],
    ["maxExecutionsPerDay", getU64Encoder()],
    ["marketIndex", getU16Encoder()],
    ["bump", getU8Encoder()],
    ["strategyType", getU8Encoder()],
    ["side", getU8Encoder()],
    ["bumpAuthority", getU8Encoder()],
    ["bumpFillsLog", getU8Encoder()],
    ["leverage", getU8Encoder()],
    ["params", getStrategyParamsEncoder()],
  ]);
}

export function getCreateStrategyParamsDecoder(): FixedSizeDecoder<CreateStrategyParams> {
  return getStructDecoder([
    ["clientOrderId", getU64Decoder()],
    ["sizeLots", getI64Decoder()],
    ["limitPriceLots", getI64Decoder()],
    ["takeProfitPrice", getI64Decoder()],
    ["stopLossPrice", getI64Decoder()],
    ["cooldownSecs", getU64Decoder()],
    ["maxExecutionsPerDay", getU64Decoder()],
    ["marketIndex", getU16Decoder()],
    ["bump", getU8Decoder()],
    ["strategyType", getU8Decoder()],
    ["side", getU8Decoder()],
    ["bumpAuthority", getU8Decoder()],
    ["bumpFillsLog", getU8Decoder()],
    ["leverage", getU8Decoder()],
    ["params", getStrategyParamsDecoder()],
  ]);
}

export function getCreateStrategyParamsCodec(): FixedSizeCodec<
  CreateStrategyParamsArgs,
  CreateStrategyParams
> {
  return combineCodec(
    getCreateStrategyParamsEncoder(),
    getCreateStrategyParamsDecoder(),
  );
}
