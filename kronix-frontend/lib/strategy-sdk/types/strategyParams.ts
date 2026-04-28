// Hand-written. Mirrors strategy_program/src/states/strategy.rs `StrategyParams`.
// Codama omitted this struct.

import {
  combineCodec,
  fixDecoderSize,
  fixEncoderSize,
  getArrayDecoder,
  getArrayEncoder,
  getBytesDecoder,
  getBytesEncoder,
  getI32Decoder,
  getI32Encoder,
  getI64Decoder,
  getI64Encoder,
  getStructDecoder,
  getStructEncoder,
  getU32Decoder,
  getU32Encoder,
  getU8Decoder,
  getU8Encoder,
  type FixedSizeCodec,
  type FixedSizeDecoder,
  type FixedSizeEncoder,
  type ReadonlyUint8Array,
} from "@solana/kit";

export type StrategyParams = {
  levels: bigint[]; // [i64; 8]
  lowerPrice: bigint;
  upperPrice: bigint;
  levelCount: number;
  padding: ReadonlyUint8Array;
  gridCount: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  emaFast: number;
  emaSlow: number;
  structureLookback: number;
  orderBlockSensitivity: number;
  toleranceBps: number;
  reserved: ReadonlyUint8Array;
};

export type StrategyParamsArgs = {
  levels: (number | bigint)[];
  lowerPrice: number | bigint;
  upperPrice: number | bigint;
  levelCount: number;
  padding: ReadonlyUint8Array;
  gridCount: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  emaFast: number;
  emaSlow: number;
  structureLookback: number;
  orderBlockSensitivity: number;
  toleranceBps: number;
  reserved: ReadonlyUint8Array;
};

export function getStrategyParamsEncoder(): FixedSizeEncoder<StrategyParamsArgs> {
  return getStructEncoder([
    ["levels", getArrayEncoder(getI64Encoder(), { size: 8 })],
    ["lowerPrice", getI64Encoder()],
    ["upperPrice", getI64Encoder()],
    ["levelCount", getU8Encoder()],
    ["padding", fixEncoderSize(getBytesEncoder(), 3)],
    ["gridCount", getU32Encoder()],
    ["rsiPeriod", getU32Encoder()],
    ["rsiOversold", getI32Encoder()],
    ["rsiOverbought", getI32Encoder()],
    ["emaFast", getU32Encoder()],
    ["emaSlow", getU32Encoder()],
    ["structureLookback", getU32Encoder()],
    ["orderBlockSensitivity", getI32Encoder()],
    ["toleranceBps", getU32Encoder()],
    ["reserved", fixEncoderSize(getBytesEncoder(), 32)],
  ]);
}

export function getStrategyParamsDecoder(): FixedSizeDecoder<StrategyParams> {
  return getStructDecoder([
    ["levels", getArrayDecoder(getI64Decoder(), { size: 8 })],
    ["lowerPrice", getI64Decoder()],
    ["upperPrice", getI64Decoder()],
    ["levelCount", getU8Decoder()],
    ["padding", fixDecoderSize(getBytesDecoder(), 3)],
    ["gridCount", getU32Decoder()],
    ["rsiPeriod", getU32Decoder()],
    ["rsiOversold", getI32Decoder()],
    ["rsiOverbought", getI32Decoder()],
    ["emaFast", getU32Decoder()],
    ["emaSlow", getU32Decoder()],
    ["structureLookback", getU32Decoder()],
    ["orderBlockSensitivity", getI32Decoder()],
    ["toleranceBps", getU32Decoder()],
    ["reserved", fixDecoderSize(getBytesDecoder(), 32)],
  ]);
}

export function getStrategyParamsCodec(): FixedSizeCodec<
  StrategyParamsArgs,
  StrategyParams
> {
  return combineCodec(getStrategyParamsEncoder(), getStrategyParamsDecoder());
}

export function emptyStrategyParamsArgs(): StrategyParamsArgs {
  return {
    levels: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    lowerPrice: 0n,
    upperPrice: 0n,
    levelCount: 0,
    padding: new Uint8Array(3),
    gridCount: 0,
    rsiPeriod: 0,
    rsiOversold: 0,
    rsiOverbought: 0,
    emaFast: 0,
    emaSlow: 0,
    structureLookback: 0,
    orderBlockSensitivity: 0,
    toleranceBps: 0,
    reserved: new Uint8Array(32),
  };
}
