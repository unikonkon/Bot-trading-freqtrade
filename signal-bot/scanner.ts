/**
 * ประเมินสัญญาณของบอทแต่ละตัวจากแท่งที่ปิดแล้ว
 * ย้ายตรรกะมาจาก NextJS_UseBot_Crypto/lib/scanner.ts:
 *   - จัดกลุ่ม symbol+interval ดึง klines ครั้งเดียวต่อกลุ่ม
 *   - สัญญาณของแท่งปิดล่าสุด (ขา alert) + สถานะจากสัญญาณพลิกล่าสุด (ขา heartbeat)
 * ต่างจากเดิม: เรียก computeSignals ตรง (ไม่จำลอง trade) และ pivot เป็นโหมด confirmed เสมอ
 */
import type { KlineData } from "@/lib/types/kline";
import { STRATEGY_FNS, computeStrategyIndicators, type SignalAction } from "@/lib/backtest";
import { intervalMinutes } from "@/lib/types/kline";
import { isV3StrategyId, v3BarInsight, v3WarmupBars, type V3BarInsight } from "@/lib/indicators-v3";
import { isV4StrategyId } from "@/lib/indicators-v4-inYutube";
import { isV5StrategyId } from "@/lib/indicators-v5-tradingView";
import { fetchClosedKlines, MAX_KLINES } from "./binance";
import type { BotSpec } from "./env";

/** SHORT ใช้ได้กับกลยุทธ์สองทาง (v3) เท่านั้น กลยุทธ์ Spot จะมีแค่ LONG/FLAT/NONE */
export type PositionState = "LONG" | "SHORT" | "FLAT" | "NONE";

export interface BotAnalysis {
  bot: BotSpec;
  lastSignal: SignalAction;        // สัญญาณของแท่งปิดล่าสุด (มักเป็น HOLD)
  price: number;                   // ราคาปิดของแท่งล่าสุด
  closeTime: number;               // closeTime ของแท่งปิดล่าสุด (ใช้กันยิงซ้ำ)
  state: PositionState;            // ทิศปัจจุบันจากสัญญาณพลิกล่าสุด
  lastFlipSignal: SignalAction | null;
  lastFlipTime: number | null;     // closeTime ของแท่งที่พลิกล่าสุด
  bars: number;                    // จำนวนแท่งที่ใช้คำนวณ
  /** บทวิเคราะห์ของแท่งล่าสุด มีเฉพาะกลยุทธ์ v3 (ค่าสัญญาณ เกณฑ์เข้า ระดับที่จะออก) */
  insight?: V3BarInsight;
}

export function groupKey(bot: Pick<BotSpec, "symbol" | "interval">): string {
  return `${bot.symbol.toUpperCase()}|${bot.interval}`;
}

export function analyzeBot(klines: KlineData[], bot: BotSpec): BotAnalysis | null {
  if (klines.length < 2) return null;
  // คำนวณ indicator ครั้งเดียวแล้วใช้ทั้งทำสัญญาณและบทวิเคราะห์ (เท่ากับ computeSignals ทุกประการ)
  const ind = computeStrategyIndicators(klines, bot.strategyId, bot.params, { confirmedPivots: true });
  const signals = STRATEGY_FNS[bot.strategyId](klines, ind, bot.params);
  const idx = signals.length - 1;
  const last = klines[idx];
  if (!last) return null;

  let lastFlipSignal: SignalAction | null = null;
  let lastFlipTime: number | null = null;
  for (let i = idx; i >= 0; i--) {
    if (signals[i] !== "HOLD") {
      lastFlipSignal = signals[i];
      lastFlipTime = klines[i].closeTime;
      break;
    }
  }
  const state: PositionState =
    lastFlipSignal === "BUY" ? "LONG"
      : lastFlipSignal === "SHORT" ? "SHORT"
        : lastFlipSignal ? "FLAT" : "NONE";

  return {
    bot,
    lastSignal: signals[idx],
    price: Number(last.close),
    closeTime: last.closeTime,
    state,
    lastFlipSignal,
    lastFlipTime,
    bars: klines.length,
    // insight อธิบายด้วยแรงซื้อขายสุทธิ ซึ่งไม่มีความหมายกับ Horizon Flow (v4) ที่ออกด้วย SL/TP ตามราคา
    // และกับ SMC LuxAlgo (v5) ที่ออกด้วยโครงสร้างราคา
    insight: isV3StrategyId(bot.strategyId) && !isV4StrategyId(bot.strategyId) && !isV5StrategyId(bot.strategyId) && ind.v3
      ? v3BarInsight(bot.strategyId, klines, ind.v3, idx, bot.params)
      : undefined,
  };
}

export interface EvaluateResult {
  results: BotAnalysis[];
  errors: string[];
  groupsFetched: number;
}

/**
 * จำนวนแท่งที่บอทตัวนี้ต้องใช้จริง
 *
 * กลยุทธ์ v3 กำหนดหน้าต่างเป็น "วัน" จำนวนแท่งจึงขึ้นกับ timeframe และมากกว่า
 * `KLINE_LIMIT` (300–1,000) เสมอ เช่น 30m ต้องการ 6,002 แท่ง ก่อนแก้จุดนี้บอทดึงมา
 * 500 แท่งแล้ว v3 ก็ไม่เคยสะสมครบ จึงไม่มีสัญญาณออกมาเลยแม้แต่ครั้งเดียว
 */
export function barsNeeded(bot: BotSpec, limit: number): number {
  if (!isV3StrategyId(bot.strategyId)) return limit;
  const tf = intervalMinutes(bot.interval);
  // +limit เพื่อให้ยังมีแท่งเหลือให้ประเมินผลหลังสะสมครบ ไม่ใช่มีพอดีแท่งเดียว
  return Math.min(MAX_KLINES, v3WarmupBars(bot.strategyId, bot.params, tf) + limit);
}

export async function evaluateBots(bots: BotSpec[], limit: number): Promise<EvaluateResult> {
  const results: BotAnalysis[] = [];
  const errors: string[] = [];
  if (!bots.length) return { results, errors, groupsFetched: 0 };

  // กลุ่มเดียวกันอาจมีหลายกลยุทธ์ ต้องดึงให้พอสำหรับตัวที่ต้องการมากที่สุด
  const groups = new Map<string, { sample: BotSpec; bars: number }>();
  for (const b of bots) {
    const key = groupKey(b);
    const prev = groups.get(key);
    const bars = Math.max(prev?.bars ?? 0, barsNeeded(b, limit));
    groups.set(key, { sample: prev?.sample ?? b, bars });
  }

  const klinesByGroup = new Map<string, KlineData[]>();
  await Promise.all(
    [...groups.entries()].map(async ([key, { sample, bars }]) => {
      try {
        klinesByGroup.set(key, await fetchClosedKlines(sample.symbol, sample.interval, bars));
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
