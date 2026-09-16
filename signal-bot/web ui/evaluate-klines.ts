/** Reusable adapter for a Binance /api/v3/klines or api/klines/route.ts response. */
import { parseKline, type BinanceKlineRaw } from "../../lib/types/kline";
import {
  computeSignals,
  STRATEGIES,
  type StrategyId,
} from "../../lib/backtest";
export function evaluateKlines(
  raw: BinanceKlineRaw[],
  strategy: StrategyId,
  params: Record<string, number> = {},
  now = Date.now(),
) {
  if (!STRATEGIES.some((s) => s.id === strategy))
    throw new Error("Unknown strategy");
  const klines = raw.map(parseKline).filter((k) => k.closeTime < now);
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    if (
      !Number.isFinite(k.openTime) ||
      !Number.isFinite(k.closeTime) ||
      ![k.open, k.high, k.low, k.close].every(
        (v) => Number.isFinite(+v) && +v > 0,
      ) ||
      (i > 0 && k.openTime <= klines[i - 1].openTime)
    )
      throw new Error("Invalid or unordered klines");
  }
  const signals = computeSignals(klines, strategy, params, {
    confirmedPivots: true,
  });
  return klines.map((k, i) => ({
    openTime: k.openTime,
    signalTime: k.closeTime,
    price: k.close,
    signal: signals[i],
  }));
}
