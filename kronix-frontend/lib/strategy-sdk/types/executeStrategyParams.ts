// Hand-written. Mirrors strategy_program/src/instructions/execute_strategy.rs `ExecuteStrategyParams`.

import {
  combineCodec,
  fixDecoderSize,
  fixEncoderSize,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  getU8Decoder,
  getU8Encoder,
  type FixedSizeCodec,
  type FixedSizeDecoder,
  type FixedSizeEncoder,
  type ReadonlyUint8Array,
} from "@solana/kit";

export type ExecuteStrategyParams = {
  signal: number;
  bumpOoAccount: number;
  bumpFillsLog: number;
  bumpTriggerTp: number;
  bumpTriggerSl: number;
  bumpAuthority: number;
  padding: ReadonlyUint8Array;
};

export type ExecuteStrategyParamsArgs = ExecuteStrategyParams;

export function getExecuteStrategyParamsEncoder(): FixedSizeEncoder<ExecuteStrategyParamsArgs> {
  return getStructEncoder([
    ["signal", getU8Encoder()],
    ["bumpOoAccount", getU8Encoder()],
    ["bumpFillsLog", getU8Encoder()],
    ["bumpTriggerTp", getU8Encoder()],
    ["bumpTriggerSl", getU8Encoder()],
    ["bumpAuthority", getU8Encoder()],
    ["padding", fixEncoderSize(getBytesEncoder(), 1)],
  ]);
}

export function getExecuteStrategyParamsDecoder(): FixedSizeDecoder<ExecuteStrategyParams> {
  return getStructDecoder([
    ["signal", getU8Decoder()],
    ["bumpOoAccount", getU8Decoder()],
    ["bumpFillsLog", getU8Decoder()],
    ["bumpTriggerTp", getU8Decoder()],
    ["bumpTriggerSl", getU8Decoder()],
    ["bumpAuthority", getU8Decoder()],
    ["padding", fixDecoderSize(getBytesDecoder(), 1)],
  ]);
}

export function getExecuteStrategyParamsCodec(): FixedSizeCodec<
  ExecuteStrategyParamsArgs,
  ExecuteStrategyParams
> {
  return combineCodec(
    getExecuteStrategyParamsEncoder(),
    getExecuteStrategyParamsDecoder(),
  );
}
