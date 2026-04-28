// Hand-written. Mirrors strategy_program/src/instructions/edit_strategy.rs `EditStrategyParams`.

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
  getU64Decoder,
  getU64Encoder,
  getU8Decoder,
  getU8Encoder,
  type FixedSizeCodec,
  type FixedSizeDecoder,
  type FixedSizeEncoder,
  type ReadonlyUint8Array,
} from "@solana/kit";

export type EditStrategyParams = {
  newLimitPriceLots: bigint;
  newTakeProfitPrice: bigint;
  newStopLossPrice: bigint;
  newSizeLots: bigint;
  newCooldownSecs: bigint;
  newMaxExecutionsPerDay: bigint;
  newStatus: number; // 255 = no change
  padding: ReadonlyUint8Array;
};

export type EditStrategyParamsArgs = {
  newLimitPriceLots: number | bigint;
  newTakeProfitPrice: number | bigint;
  newStopLossPrice: number | bigint;
  newSizeLots: number | bigint;
  newCooldownSecs: number | bigint;
  newMaxExecutionsPerDay: number | bigint;
  newStatus: number;
  padding: ReadonlyUint8Array;
};

export function getEditStrategyParamsEncoder(): FixedSizeEncoder<EditStrategyParamsArgs> {
  return getStructEncoder([
    ["newLimitPriceLots", getI64Encoder()],
    ["newTakeProfitPrice", getI64Encoder()],
    ["newStopLossPrice", getI64Encoder()],
    ["newSizeLots", getI64Encoder()],
    ["newCooldownSecs", getU64Encoder()],
    ["newMaxExecutionsPerDay", getU64Encoder()],
    ["newStatus", getU8Encoder()],
    ["padding", fixEncoderSize(getBytesEncoder(), 7)],
  ]);
}

export function getEditStrategyParamsDecoder(): FixedSizeDecoder<EditStrategyParams> {
  return getStructDecoder([
    ["newLimitPriceLots", getI64Decoder()],
    ["newTakeProfitPrice", getI64Decoder()],
    ["newStopLossPrice", getI64Decoder()],
    ["newSizeLots", getI64Decoder()],
    ["newCooldownSecs", getU64Decoder()],
    ["newMaxExecutionsPerDay", getU64Decoder()],
    ["newStatus", getU8Decoder()],
    ["padding", fixDecoderSize(getBytesDecoder(), 7)],
  ]);
}

export function getEditStrategyParamsCodec(): FixedSizeCodec<
  EditStrategyParamsArgs,
  EditStrategyParams
> {
  return combineCodec(
    getEditStrategyParamsEncoder(),
    getEditStrategyParamsDecoder(),
  );
}
