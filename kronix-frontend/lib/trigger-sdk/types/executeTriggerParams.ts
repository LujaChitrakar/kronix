// Hand-written companion to the codama-generated trigger_program SDK.
// Layout mirrors `trigger_program/src/instructions/execute_trigger.rs`.

import {
  combineCodec,
  fixDecoderSize,
  fixEncoderSize,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  getU16Decoder,
  getU16Encoder,
  getU8Decoder,
  getU8Encoder,
  type FixedSizeCodec,
  type FixedSizeDecoder,
  type FixedSizeEncoder,
  type ReadonlyUint8Array,
} from "@solana/kit";

export type ExecuteTriggerParams = {
  marketIndex: number;
  bumpFillsLog: number;
  bumpAuthority: number;
  padding: ReadonlyUint8Array;
};

export type ExecuteTriggerParamsArgs = {
  marketIndex: number;
  bumpFillsLog: number;
  bumpAuthority: number;
  padding: ReadonlyUint8Array;
};

export function getExecuteTriggerParamsEncoder(): FixedSizeEncoder<ExecuteTriggerParamsArgs> {
  return getStructEncoder([
    ["marketIndex", getU16Encoder()],
    ["bumpFillsLog", getU8Encoder()],
    ["bumpAuthority", getU8Encoder()],
    ["padding", fixEncoderSize(getBytesEncoder(), 4)],
  ]);
}

export function getExecuteTriggerParamsDecoder(): FixedSizeDecoder<ExecuteTriggerParams> {
  return getStructDecoder([
    ["marketIndex", getU16Decoder()],
    ["bumpFillsLog", getU8Decoder()],
    ["bumpAuthority", getU8Decoder()],
    ["padding", fixDecoderSize(getBytesDecoder(), 4)],
  ]);
}

export function getExecuteTriggerParamsCodec(): FixedSizeCodec<
  ExecuteTriggerParamsArgs,
  ExecuteTriggerParams
> {
  return combineCodec(
    getExecuteTriggerParamsEncoder(),
    getExecuteTriggerParamsDecoder(),
  );
}
