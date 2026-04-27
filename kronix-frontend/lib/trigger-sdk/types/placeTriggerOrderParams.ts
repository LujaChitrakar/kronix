// Hand-written companion to the codama-generated trigger_program SDK.
// codama did not emit param structs for instructions that take a single
// `Pod` arg. Layout mirrors `trigger_program/src/instructions/place_trigger_order.rs`.

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

export type PlaceTriggerOrderParams = {
  clientOrderId: bigint;
  triggerPrice: bigint;
  sizeLots: bigint;
  expiry: bigint;
  marketIndex: number;
  triggerType: number;
  side: number;
  bump: number;
  bumpAuthority: number;
  bumpFillsLog: number;
  padding: ReadonlyUint8Array;
};

export type PlaceTriggerOrderParamsArgs = {
  clientOrderId: number | bigint;
  triggerPrice: number | bigint;
  sizeLots: number | bigint;
  expiry: number | bigint;
  marketIndex: number;
  triggerType: number;
  side: number;
  bump: number;
  bumpAuthority: number;
  bumpFillsLog: number;
  padding: ReadonlyUint8Array;
};

export function getPlaceTriggerOrderParamsEncoder(): FixedSizeEncoder<PlaceTriggerOrderParamsArgs> {
  return getStructEncoder([
    ["clientOrderId", getU64Encoder()],
    ["triggerPrice", getI64Encoder()],
    ["sizeLots", getI64Encoder()],
    ["expiry", getI64Encoder()],
    ["marketIndex", getU16Encoder()],
    ["triggerType", getU8Encoder()],
    ["side", getU8Encoder()],
    ["bump", getU8Encoder()],
    ["bumpAuthority", getU8Encoder()],
    ["bumpFillsLog", getU8Encoder()],
    ["padding", fixEncoderSize(getBytesEncoder(), 1)],
  ]);
}

export function getPlaceTriggerOrderParamsDecoder(): FixedSizeDecoder<PlaceTriggerOrderParams> {
  return getStructDecoder([
    ["clientOrderId", getU64Decoder()],
    ["triggerPrice", getI64Decoder()],
    ["sizeLots", getI64Decoder()],
    ["expiry", getI64Decoder()],
    ["marketIndex", getU16Decoder()],
    ["triggerType", getU8Decoder()],
    ["side", getU8Decoder()],
    ["bump", getU8Decoder()],
    ["bumpAuthority", getU8Decoder()],
    ["bumpFillsLog", getU8Decoder()],
    ["padding", fixDecoderSize(getBytesDecoder(), 1)],
  ]);
}

export function getPlaceTriggerOrderParamsCodec(): FixedSizeCodec<
  PlaceTriggerOrderParamsArgs,
  PlaceTriggerOrderParams
> {
  return combineCodec(
    getPlaceTriggerOrderParamsEncoder(),
    getPlaceTriggerOrderParamsDecoder(),
  );
}
