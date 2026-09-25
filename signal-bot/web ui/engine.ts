import {
  computeStrategyIndicators,
  STRATEGY_FNS,
  runBacktest,
  STRATEGIES,
  type SignalAction,
  type StrategyId,
} from "../../lib/backtest";
import {
  V2_STRATEGY_IDS,
  resolveV2Strategy,
  type V2StrategyId,
} from "../../lib/indicators-v2";
import {
  V3_STRATEGY_IDS,
  isV3StrategyId,
  type V3StrategyId,
} from "../../lib/indicators-v3";
import type { AllIndicators } from "../../lib/indicators";
import type { KlineData } from "../../lib/types/kline";

export interface Fill {
  entryIdx: number;
  exitIdx: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  /** ผลต่อพอร์ตเป็น % หลังหักค่าธรรมเนียม slippage และ funding ของดีลนั้น */
  pnlPct: number;
  bars: number;
  reason: string;
  /** มีเฉพาะกลยุทธ์สองทาง (v3): ทิศของดีล */
  direction?: "long" | "short";
  /** มีเฉพาะกลยุทธ์สองทาง (v3): สัดส่วนพอร์ตที่ใช้ในดีลนั้น 0–1 */
  size?: number;
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

/**
 * ตัวจำลองสำหรับกลยุทธ์สองทางที่กำหนดขนาดไม้เอง (ใช้กับ v3)
 *
 * ต่างจาก simulateNextOpen ตรงที่
 *   • เปิดสถานะขายได้ ไม่ใช่แค่ถือเงินสดเมื่อไม่ได้ซื้อ
 *   • ขนาดไม้มาจากอินดิเคเตอร์ ไม่ใช่ลงเต็มพอร์ตทุกครั้ง
 *   • มีต้นทุน funding ของ perpetual futures ซึ่งเป็นต้นทุนของ "การถือ" ไม่ใช่ของการซื้อขาย
 *
 * อ่านจากคอลัมน์ exposure (สัดส่วนพอร์ตเป้าหมาย + ซื้อ / − ขาย / 0 ว่าง)
 * ไม่ได้อ่านจาก signal เพราะ signal บอกได้แค่ทิศ ไม่ได้บอกขนาด
 *
 * ข้อสมมติที่ต้องรู้
 *   • ถือได้ครั้งละหนึ่งสถานะ ไม่มีการเติมไม้ระหว่างถือ ถ้า exposure เปลี่ยนขนาด
 *     ระหว่างถือทิศเดิม จะถือขนาดเดิมไว้จนกว่าจะปิด
 *   • funding คิดเป็นต้นทุนของผู้ถือทุกครั้งที่ข้ามเวลา 00:00 / 08:00 / 16:00 UTC
 *     ทั้งฝั่งซื้อและฝั่งขาย ซึ่งเป็นสมมติฐานแบบระมัดระวัง เพราะ funding จริงสลับ
 *     เครื่องหมายได้และเราไม่มีข้อมูล funding ย้อนหลังในชุดนี้ ตั้งเป็น 0 เพื่อปิด
 *   • size ≤ 1 เสมอ จึงไม่มี leverage และไม่มีการจำลอง margin call
 *   • `levelExit` (ทางเลือก): กลยุทธ์ที่ใช้ SL/TP ตายตัวประกาศราคาที่ไม้ถูกปิดระหว่างแท่ง
 *     ตัวจำลองจะปิดที่ราคานั้น (หัก slippage เหมือนการปิดทั่วไป) แทนการรอราคาเปิดแท่งถัดไป
 *     โหมด next_open ตรวจหลังคำสั่งที่ราคาเปิด (ไม้ที่เพิ่งเปิดชน SL ในแท่งเดียวกันได้)
 *     โหมด legacy ตรวจก่อนคำสั่งที่ราคาปิด เพราะการแตะระดับเกิดก่อนแท่งจะปิด
 *     ไม่ส่งค่านี้ = พฤติกรรมเดิมทุกประการ
 */
export function simulateExposure(
  k: KlineData[],
  exposure: number[],
  start: number,
  feePct: number,
  slipPct: number,
  fundingPct8h: number,
  fillMode: "next_open" | "legacy",
  levelExit?: { price: (number | null)[]; reason: string[] },
): Simulation {
  const fee = feePct / 100,
    slip = slipPct / 100,
    funding = fundingPct8h / 100;
  const EIGHT_HOURS = 8 * 3600 * 1000;
  let equity = 100;
  let dir = 0,
    qty = 0,
    notional = 0,
    entryIdx = 0,
    entryTime = 0,
    entryPrice = 0,
    entrySize = 0,
    equityAtEntry = 100;
  let peak = 100,
    maxDrawdownPct = 0;
  const trades: Fill[] = [],
    curve: number[] = [];
  const fillPrice = (raw: number, side: "buy" | "sell") =>
    side === "buy" ? raw * (1 + slip) : raw * (1 - slip);

  function open(i: number, raw: number, time: number, side: 1 | -1, sizeFrac: number) {
    const price = fillPrice(raw, side === 1 ? "buy" : "sell");
    equityAtEntry = equity;
    notional = equity * sizeFrac;
    qty = notional / price;
    equity -= notional * fee;
    dir = side;
    entryIdx = i;
    entryTime = time;
    entryPrice = price;
    entrySize = sizeFrac;
  }
  function close(i: number, raw: number, time: number, reason: string) {
    const price = fillPrice(raw, dir === 1 ? "sell" : "buy");
    const exitNotional = qty * price;
    equity += dir * (exitNotional - notional) - exitNotional * fee;
    trades.push({
      entryIdx,
      exitIdx: i,
      entryTime,
      exitTime: time,
      entryPrice,
      exitPrice: price,
      pnlPct: (equity / equityAtEntry - 1) * 100,
      bars: i - entryIdx,
      reason,
      direction: dir === 1 ? "long" : "short",
      size: entrySize,
    });
    dir = 0;
    qty = 0;
    notional = 0;
  }

  for (let i = start; i < k.length; i++) {
    // funding คิดกับสถานะที่ถือข้ามรอบ 8 ชั่วโมง ก่อนตัดสินใจของแท่งนี้
    if (dir !== 0 && i > start && funding > 0 &&
      Math.floor(k[i].openTime / EIGHT_HOURS) > Math.floor(k[i - 1].openTime / EIGHT_HOURS))
      equity -= Math.abs(qty * +k[i].open) * funding;

    const last = i === k.length - 1;
    // next_open: ตัดสินใจที่ปิดแท่งก่อน แล้วลงมือที่เปิดแท่งนี้
    // legacy: ลงมือที่ราคาปิดของแท่งที่ให้สัญญาณเอง
    const target = fillMode === "next_open" ? (i > start ? exposure[i - 1] ?? 0 : 0) : exposure[i] ?? 0;
    const raw = fillMode === "next_open" ? +k[i].open : +k[i].close;
    const time = fillMode === "next_open" ? k[i].openTime : k[i].closeTime;
    const wanted = Number.isFinite(target) ? target : 0;
    const wantedDir = wanted > 0 ? 1 : wanted < 0 ? -1 : 0;
    const wantedSize = Math.min(1, Math.abs(wanted));

    const hitLevel = () => {
      const px = levelExit?.price[i];
      if (dir !== 0 && px != null && Number.isFinite(px))
        close(i, px, k[i].openTime, levelExit!.reason[i] || "ปิดที่ราคา SL/TP");
    };
    if (fillMode === "legacy") hitLevel();
    if (dir !== 0 && wantedDir !== dir)
      close(i, raw, time, wantedDir === 0 ? "สัญญาณปิดสถานะ" : "กลับข้างสถานะ");
    if (dir === 0 && wantedDir !== 0 && wantedSize > 0 && !last)
      open(i, raw, time, wantedDir as 1 | -1, wantedSize);
    if (fillMode === "next_open") hitLevel();
    if (last && dir !== 0) close(i, +k[i].close, k[i].closeTime, "ปิดเมื่อจบข้อมูล");

    const value = dir === 0 ? equity : equity + dir * (qty * +k[i].close - notional);
    peak = Math.max(peak, value);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - value) / peak) * 100);
    curve.push(value - 100);
  }

  const wins = trades.filter((t) => t.pnlPct > 0);
  const gains = wins.reduce((a, t) => a + t.pnlPct, 0);
  const losses = -trades.filter((t) => t.pnlPct <= 0).reduce((a, t) => a + t.pnlPct, 0);
  return {
    mode: fillMode,
    trades,
    equity: curve,
    returnPct: equity - 100,
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

/** กลยุทธ์ v2 ทุกตัวชี้ไปที่คีย์ผลลัพธ์ของอินดิเคเตอร์ต้นทางของมัน */
const V2_INDICATOR_KEYS = Object.fromEntries(
  V2_STRATEGY_IDS.map((id) => [id, resolveV2Strategy(id).def.key]),
) as Record<V2StrategyId, keyof AllIndicators>;

const V3_INDICATOR_KEYS = Object.fromEntries(
  V3_STRATEGY_IDS.map((id) => [id, "v3"]),
) as Record<V3StrategyId, keyof AllIndicators>;

export const INDICATOR_KEYS: Record<StrategyId, keyof AllIndicators> = {
  ...V2_INDICATOR_KEYS,
  ...V3_INDICATOR_KEYS,
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
  /** ต้นทุน funding ต่อรอบ 8 ชั่วโมง ใช้เฉพาะกลยุทธ์สองทาง (v3) */
  funding = 0,
) {
  const ind = computeStrategyIndicators(k, id, params, {
    confirmedPivots: true,
    lazyIndicators: true,
    startIndex: start,
  });
  const signals = STRATEGY_FNS[id](k, ind, params);
  const simulations: Simulation[] = [];
  // กลยุทธ์สองทางใช้คอลัมน์ exposure เพราะ BUY/SELL บอกขนาดไม้และฝั่งขายไม่ได้
  if (isV3StrategyId(id)) {
    const exposure = ind.v3?.exposure;
    if (!exposure) throw new Error(`ยังไม่ได้คำนวณ exposure สำหรับกลยุทธ์ ${id}`);
    // กลยุทธ์ที่ใช้ SL/TP ตายตัว (v4) ประกาศราคาปิดระหว่างแท่งไว้ ตัวอื่นไม่มีช่องนี้
    const levelExit = ind.v3?.exitFill ? { price: ind.v3.exitFill, reason: ind.v3.reason } : undefined;
    if (mode !== "legacy")
      simulations.push(simulateExposure(k, exposure, start, fee, slip, funding, "next_open", levelExit));
    if (mode !== "next_open")
      simulations.push(simulateExposure(k, exposure, start, fee, slip, funding, "legacy", levelExit));
    return {
      id,
      name: STRATEGIES.find((s) => s.id === id)!.name,
      params,
      simulations: simulations.map((s) => (detail ? s : { ...s, trades: [], equity: [] })),
      signals: detail ? signals.slice(start) : [],
      indicators: detail
        ? Object.fromEntries(
            Object.entries(
              indicatorColumns(selectedOnly ? { v3: ind.v3 } : ind, k.length),
            ).map(([key, a]) => [key, a.slice(start)]),
          )
        : {},
    };
  }
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
