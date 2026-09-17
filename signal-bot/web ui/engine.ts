import {
  computeStrategyIndicators,
  STRATEGY_FNS,
  runBacktest,
  STRATEGIES,
  type SignalAction,
  type StrategyId,
} from "../../lib/backtest";
import type { AllIndicators } from "../../lib/indicators";
import type { KlineData } from "../../lib/types/kline";

export interface Fill {
  entryIdx: number;
  exitIdx: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  bars: number;
  reason: string;
}
export interface Simulation {
  mode: "next_open" | "legacy";
  trades: Fill[];
  equity: number[];
  returnPct: number;
  maxDrawdownPct: number;
  winRate: number;
  profitFactor: number | null;
  totalTrades: number;
  buyAndHoldPct: number;
}

/** All-in spot, one long position, fees in quote currency, no leverage. */
export function simulateNextOpen(
  k: KlineData[],
  signals: SignalAction[],
  start: number,
  feePct: number,
  slipPct: number,
): Simulation {
  const fee = feePct / 100,
    slip = slipPct / 100;
  let cash = 100,
    qty = 0,
    entryIdx = 0,
    entryPrice = 0,
    invested = 0;
  let peak = 100,
    maxDrawdownPct = 0;
  const trades: Fill[] = [],
    equity: number[] = [];
  function close(i: number, rawPrice: number, force: boolean) {
    const price = rawPrice * (1 - slip);
    cash = qty * price * (1 - fee);
    trades.push({
      entryIdx,
      exitIdx: i,
      entryTime: k[entryIdx].openTime,
      exitTime: force ? k[i].closeTime : k[i].openTime,
      entryPrice,
      exitPrice: price,
      pnlPct: (cash / invested - 1) * 100,
      bars: i - entryIdx,
      reason: force ? "ปิดเมื่อจบข้อมูล" : "SELL → เปิดแท่งถัดไป",
    });
    qty = 0;
  }
  for (let i = start; i < k.length; i++) {
    // No position or pending order is carried over from warm-up.
    const action = i > start ? signals[i - 1] : "HOLD";
    if (!qty && action === "BUY") {
      invested = cash;
      entryIdx = i;
      entryPrice = +k[i].open * (1 + slip);
      qty = cash / (entryPrice * (1 + fee));
      cash = 0;
    } else if (qty && action === "SELL") close(i, +k[i].open, false);
    if (i === k.length - 1 && qty) close(i, +k[i].close, true);
    const value = cash + qty * +k[i].close;
    peak = Math.max(peak, value);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - value) / peak) * 100);
    equity.push(value - 100);
  }
  const wins = trades.filter((t) => t.pnlPct > 0);
  const gains = wins.reduce((a, t) => a + t.pnlPct, 0);
  const losses = -trades
    .filter((t) => t.pnlPct <= 0)
    .reduce((a, t) => a + t.pnlPct, 0);
  return {
    mode: "next_open",
    trades,
    equity,
    returnPct: cash - 100,
    maxDrawdownPct,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: losses ? gains / losses : gains ? null : 0,
    totalTrades: trades.length,
    buyAndHoldPct:
      k.length > start + 1 ? (+k.at(-1)!.close / +k[start].close - 1) * 100 : 0,
  };
}

function indicatorColumns(ind: Partial<AllIndicators>, n: number) {
  const columns: Record<string, (number | string | boolean | null)[]> = {};
  function visit(value: unknown, name: string) {
    if (Array.isArray(value)) {
      if (
        value.length === n &&
        value.every(
          (x) =>
            x === null || ["number", "string", "boolean"].includes(typeof x),
        )
      ) {
        columns[name] = value.map((x) =>
          typeof x === "number" && !Number.isFinite(x) ? null : x,
        );
      }
    } else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value))
        visit(v, name ? `${name}.${key}` : key);
    }
  }
  visit(ind, "");
  return columns;
}

export const INDICATOR_KEYS: Record<StrategyId, keyof AllIndicators> = {
  rsi: "rsi", cdc_actionzone: "cdcActionZone", smc: "smc", smc_adaptive: "smcAdaptive",
  smc_adaptive_v2: "smcAdaptiveV2", smc_adaptive_short: "smcAdaptiveShort", cm_macd: "cmMacd",
  supertrend: "supertrend", squeeze_momentum: "squeezeMomentum", msb_ob: "msbOb",
  support_resistance: "supportResistance", trendlines: "trendlines", ut_bot: "utBot",
};
export function analyze(
  k: KlineData[],
  start: number,
  id: StrategyId,
  params: Record<string, number>,
  fee: number,
  slip: number,
  mode: string,
  detail: boolean,
  selectedOnly = false,
) {
  const ind = computeStrategyIndicators(k, id, params, {
    confirmedPivots: true,
    lazyIndicators: true,
    startIndex: start,
  });
  const signals = STRATEGY_FNS[id](k, ind, params);
  const simulations: Simulation[] = [];
  if (mode !== "legacy")
    simulations.push(simulateNextOpen(k, signals, start, fee, slip));
  if (mode !== "next_open") {
    const r = runBacktest(k, id, params, fee, {
      confirmedPivots: true,
      lazyIndicators: true,
      precomputedSignals: signals,
      startIndex: start,
    });
    simulations.push({
      mode: "legacy",
      trades: r.trades,
      equity: r.equityCurve.slice(start),
      returnPct: r.totalPnlPct,
      maxDrawdownPct: r.maxDrawdownPct,
      winRate: r.winRate,
      profitFactor: Number.isFinite(r.profitFactor) ? r.profitFactor : null,
      totalTrades: r.totalTrades,
      buyAndHoldPct: r.buyAndHoldPct,
    });
  }
  return {
    id,
    name: STRATEGIES.find((s) => s.id === id)!.name,
    params,
    simulations: simulations.map((s) =>
      detail ? s : { ...s, trades: [], equity: [] },
    ),
    signals: detail ? signals.slice(start) : [],
    indicators: detail
      ? Object.fromEntries(
          Object.entries(indicatorColumns(selectedOnly ? { [INDICATOR_KEYS[id]]: ind[INDICATOR_KEYS[id]] } : ind, k.length)).map(([key, a]) => [
            key,
            a.slice(start),
          ]),
        )
      : {},
  };
}
