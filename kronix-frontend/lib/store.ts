/**
 * store.ts — Global zustand store for wallet, positions, margin, triggers, strategies
 */
import { create } from 'zustand';

export interface MarginData {
  mark_price: string;
  collateral: string;
  equity: string;
  initial_margin: string;
  maintenance_margin: string;
  unrealised_pnl: string;
  margin_ratio: string;
  position_size: string;
  liquidation_price: string;
  entry_price: string;
  is_healthy: boolean;
}

export interface TriggerRecord {
  id: string;
  account_id: string;
  trigger_price: string;
  trigger_type: 'STOP_LOSS' | 'TAKE_PROFIT';
  side: 'BUY' | 'SELL';
  size: string;
  created_at: string;
}

export interface StrategyRecord {
  id: string;
  name: string;
  kind: string;
  status: string;
  symbol: string;
  resolution: string;
  created_at: string;
  last_execution?: string;
}

interface AppStore {
  // Wallet
  wallet: string | null;
  setWallet: (w: string | null) => void;

  // Live price
  livePrice: number | null;
  prevPrice: number | null;
  setLivePrice: (p: number) => void;

  // Margin / position
  margin: MarginData | null;
  setMargin: (m: MarginData | null) => void;

  // Triggers
  triggers: TriggerRecord[];
  setTriggers: (t: TriggerRecord[]) => void;

  // Strategies
  strategies: StrategyRecord[];
  setStrategies: (s: StrategyRecord[]) => void;

  // Active bottom tab
  bottomTab: string;
  setBottomTab: (tab: string) => void;

  // Selected price from chart interaction
  selectedPrice: number | null;
  setSelectedPrice: (p: number | null) => void;

  // Track which input was last focused for price picking
  lastFocusedInputId: string | null;
  setLastFocusedInputId: (id: string | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  wallet: null,
  setWallet: (wallet) => set({ wallet }),

  livePrice: null,
  prevPrice: null,
  setLivePrice: (p) => set((s) => ({ livePrice: p, prevPrice: s.livePrice })),

  margin: null,
  setMargin: (margin) => set({ margin }),

  triggers: [],
  setTriggers: (triggers) => set({ triggers }),

  strategies: [],
  setStrategies: (strategies) => set({ strategies }),

  bottomTab: 'positions',
  setBottomTab: (bottomTab) => set({ bottomTab }),

  selectedPrice: null,
  setSelectedPrice: (selectedPrice) => set({ selectedPrice }),

  lastFocusedInputId: null,
  setLastFocusedInputId: (lastFocusedInputId) => set({ lastFocusedInputId }),
}));
