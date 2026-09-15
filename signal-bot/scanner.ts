/**
 * ประเมินสัญญาณของบอทแต่ละตัวจากแท่งที่ปิดแล้ว
 * ย้ายตรรกะมาจาก NextJS_UseBot_Crypto/lib/scanner.ts:
 *   - จัดกลุ่ม symbol+interval ดึง klines ครั้งเดียวต่อกลุ่ม
 *   - สัญญาณของแท่งปิดล่าสุด (ขา alert) + สถานะจากสัญญาณพลิกล่าสุด (ขา heartbeat)
 * ต่างจากเดิม: เรียก computeSignals ตรง (ไม่จำลอง trade) และ pivot เป็นโหมด confirmed เสมอ
 */
import type { KlineData } from "@/lib/types/kline";
import { computeSignals, type SignalAction } from "@/lib/backtest";
import { fetchClosedKlines } from "./binance";
import type { BotSpec } from "./env";

export type PositionState = "LONG" | "FLAT" | "NONE";

export interface BotAnalysis {
  bot: BotSpec;
  lastSignal: SignalAction;        // สัญญาณของแท่งปิดล่าสุด (มักเป็น HOLD)
  price: number;                   // ราคาปิดของแท่งล่าสุด
  closeTime: number;               // closeTime ของแท่งปิดล่าสุด (ใช้กันยิงซ้ำ)
  state: PositionState;            // ทิศปัจจุบันจากสัญญาณพลิกล่าสุด
  lastFlipSignal: SignalAction | null;
  lastFlipTime: number | null;     // closeTime ของแท่งที่พลิกล่าสุด
  bars: number;                    // จำนวนแท่งที่ใช้คำนวณ
}

export function groupKey(bot: Pick<BotSpec, "symbol" | "interval">): string {
  return `${bot.symbol.toUpperCase()}|${bot.interval}`;
}

export function analyzeBot(klines: KlineData[], bot: BotSpec): BotAnalysis | null {
  if (klines.length < 2) return null;
  const signals = computeSignals(klines, bot.strategyId, bot.params, { confirmedPivots: true });
  const idx = signals.length - 1;
  const last = klines[idx];
  if (!last) return null;

  let lastFlipSignal: SignalAction | null = null;
  let lastFlipTime: number | null = null;
  for (let i = idx; i >= 0; i--) {
    if (signals[i] === "BUY" || signals[i] === "SELL") {
      lastFlipSignal = signals[i];
      lastFlipTime = klines[i].closeTime;
      break;
    }
  }
  const state: PositionState =
    lastFlipSignal === "BUY" ? "LONG" : lastFlipSignal === "SELL" ? "FLAT" : "NONE";

  return {
    bot,
    lastSignal: signals[idx],
    price: Number(last.close),
    closeTime: last.closeTime,
    state,
    lastFlipSignal,
    lastFlipTime,
    bars: klines.length,
  };
}

export interface EvaluateResult {
  results: BotAnalysis[];
  errors: string[];
  groupsFetched: number;
}

export async function evaluateBots(bots: BotSpec[], limit: number): Promise<EvaluateResult> {
  const results: BotAnalysis[] = [];
  const errors: string[] = [];
  if (!bots.length) return { results, errors, groupsFetched: 0 };

  const groups = new Map<string, BotSpec>();
  for (const b of bots) groups.set(groupKey(b), b);

  const klinesByGroup = new Map<string, KlineData[]>();
  await Promise.all(
    [...groups.entries()].map(async ([key, sample]) => {
      try {
        klinesByGroup.set(key, await fetchClosedKlines(sample.symbol, sample.interval, limit));
      } catch (err) {
        errors.push(String(err instanceof Error ? err.message : err));
      }
    }),
  );

  for (const bot of bots) {
    const klines = klinesByGroup.get(groupKey(bot));
    if (!klines) continue;
    try {
      const r = analyzeBot(klines, bot);
      if (r) results.push(r);
    } catch (err) {
      errors.push(`${bot.id}: ${String(err instanceof Error ? err.message : err)}`);
    }
  }
  return { results, errors, groupsFetched: klinesByGroup.size };
}
