import { formatPriceLots, formatSizeLots, type LotConfig } from "./lot-math";

export type NetSide = "long" | "short";

export interface NetPosition {
  side: NetSide;
  sizeLots: bigint;
  entryPriceLots: bigint;
}

export interface NetOrderPreview {
  side: NetSide;
  sizeLots: bigint;
  priceLots: bigint;
}

export type SimulatedNetPosition =
  | { status: "open"; side: NetSide; sizeLots: bigint; entryPriceLots: bigint }
  | { status: "closed" };

export function simulateNetPosition(
  current: NetPosition | null,
  order: NetOrderPreview,
): SimulatedNetPosition {
  if (order.sizeLots <= 0n || order.priceLots <= 0n) {
    return current
      ? {
          status: "open",
          side: current.side,
          sizeLots: current.sizeLots,
          entryPriceLots: current.entryPriceLots,
        }
      : { status: "closed" };
  }

  if (!current || current.sizeLots <= 0n) {
    return {
      status: "open",
      side: order.side,
      sizeLots: order.sizeLots,
      entryPriceLots: order.priceLots,
    };
  }

  if (current.side === order.side) {
    const newSize = current.sizeLots + order.sizeLots;
    if (newSize === 0n) return { status: "closed" };
    const newEntry =
      (current.sizeLots * current.entryPriceLots +
        order.sizeLots * order.priceLots) /
      newSize;
    return {
      status: "open",
      side: current.side,
      sizeLots: newSize,
      entryPriceLots: newEntry,
    };
  }

  if (order.sizeLots < current.sizeLots) {
    return {
      status: "open",
      side: current.side,
      sizeLots: current.sizeLots - order.sizeLots,
      entryPriceLots: current.entryPriceLots,
    };
  }

  if (order.sizeLots === current.sizeLots) return { status: "closed" };

  return {
    status: "open",
    side: order.side,
    sizeLots: order.sizeLots - current.sizeLots,
    entryPriceLots: order.priceLots,
  };
}

export function formatNetPositionPreview(
  pos: SimulatedNetPosition,
  cfg?: LotConfig | null,
): string {
  if (pos.status === "closed") return "CLOSED";
  const size = cfg ? formatSizeLots(pos.sizeLots, cfg) : pos.sizeLots.toString();
  const price = cfg
    ? formatPriceLots(pos.entryPriceLots, cfg)
    : pos.entryPriceLots.toString();
  return `${pos.side.toUpperCase()} ${size} @ ${price}`;
}
