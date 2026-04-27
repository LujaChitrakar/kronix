// Hand-written companion to the codama-generated trigger_program SDK.
// Layout mirrors `trigger_program/src/instructions/edit_trigger.rs`.

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
  type FixedSizeCodec,
  type FixedSizeDecoder,
  type FixedSizeEncoder,
  type ReadonlyUint8Array,
} from "@solana/kit";

export type EditTriggerParams = {
  newTriggerPrice: bigint;
  newSizeLots: bigint;
  newExpiry: bigint;
  padding: ReadonlyUint8Array;
};

export type EditTriggerParamsArgs = {
  newTriggerPrice: number | bigint;
  newSizeLots: number | bigint;
  newExpiry: number | bigint;
  padding: ReadonlyUint8Array;
};

export function getEditTriggerParamsEncoder(): FixedSizeEncoder<EditTriggerParamsArgs> {
  return getStructEncoder([
    ["newTriggerPrice", getI64Encoder()],
    ["newSizeLots", getI64Encoder()],
    ["newExpiry", getI64Encoder()],
    ["padding", fixEncoderSize(getBytesEncoder(), 8)],
  ]);
}

export function getEditTriggerParamsDecoder(): FixedSizeDecoder<EditTriggerParams> {
  return getStructDecoder([
    ["newTriggerPrice", getI64Decoder()],
    ["newSizeLots", getI64Decoder()],
    ["newExpiry", getI64Decoder()],
    ["padding", fixDecoderSize(getBytesDecoder(), 8)],
  ]);
}

export function getEditTriggerParamsCodec(): FixedSizeCodec<
  EditTriggerParamsArgs,
  EditTriggerParams
> {
  return combineCodec(
    getEditTriggerParamsEncoder(),
    getEditTriggerParamsDecoder(),
  );
}
