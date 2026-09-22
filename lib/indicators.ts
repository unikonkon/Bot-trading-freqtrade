import { PriceSearch } from "./price-search";
import type { KlineData } from "@/lib/types/kline";
import {
  resolveV2Strategy,
  type V2StrategyId,
  type SmaV2Result, type EmaV2Result, type RsiV2Result, type MacdV2Result,
  type BollingerV2Result, type AtrV2Result, type StochasticV2Result, type StochRsiV2Result,
  type AdxV2Result, type IchimokuV2Result, type SupertrendV2Result, type VwapV2Result,
  type VolumeV2Result, type ObvV2Result, type VolumeProfileV2Result, type SmcV2Result,
  type SqueezeV2Result, type WaveTrendV2Result, type UtBotV2Result, type LorentzianV2Result,
} from "@/lib/indicators-v2";
import {
  computeV3,
  isV3StrategyId,
  type V3Result,
  type V3StrategyId,
} from "@/lib/indicators-v3";

// ─── Helper ────────────────────────────────────────────────────
function closes(k: KlineData[]): number[] { return k.map(x => +x.close); }
function highs(k: KlineData[]): number[]  { return k.map(x => +x.high); }
function lows(k: KlineData[]): number[]   { return k.map(x => +x.low); }
function volumes(k: KlineData[]): number[] { return k.map(x => +x.volume); }

// ─── SMA ───────────────────────────────────────────────────────
export function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

// ─── EMA ───────────────────────────────────────────────────────
export function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (prev === null) {
      // seed with SMA
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      prev = sum / period;
    } else {
      prev = data[i] * k + prev * (1 - k);
    }
    result.push(prev);
  }
  return result;
}

// ─── RSI ───────────────────────────────────────────────────────
export function rsi(data: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (data.length < period + 1) return data.map(() => null);

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = 0; i < period; i++) result.push(null);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

// ─── ATR ───────────────────────────────────────────────────────
export function atr(klines: KlineData[], period = 14): (number | null)[] {
  const h = highs(klines), l = lows(klines), c = closes(klines);
  const tr: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) { tr.push(h[i] - l[i]); continue; }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const result: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (prev === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += tr[j];
      prev = sum / period;
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
    }
    result.push(prev);
  }
  return result;
}

// ─── OBV ───────────────────────────────────────────────────────
export function obv(klines: KlineData[]): number[] {
  const c = closes(klines), v = volumes(klines);
  const result: number[] = [0];
  for (let i = 1; i < klines.length; i++) {
    if (c[i] > c[i - 1]) result.push(result[i - 1] + v[i]);
    else if (c[i] < c[i - 1]) result.push(result[i - 1] - v[i]);
    else result.push(result[i - 1]);
  }
  return result;
}

// ─── VWAP ──────────────────────────────────────────────────────
export function vwap(klines: KlineData[]): number[] {
  const result: number[] = [];
  let cumTPV = 0, cumVol = 0;
  for (let i = 0; i < klines.length; i++) {
    const tp = (+klines[i].high + +klines[i].low + +klines[i].close) / 3;
    const vol = +klines[i].volume;
    cumTPV += tp * vol;
    cumVol += vol;
    result.push(cumVol === 0 ? tp : cumTPV / cumVol);
  }
  return result;
}

// ─── CDC ActionZone V3 2020 ──────────────────────────────────────
// Based on piriya33's PineScript indicator — EMA crossover zones
export type CDCZone = "green" | "blue" | "lightblue" | "red" | "orange" | "yellow" | null;

export interface CDCActionZoneResult {
  fastMA: (number | null)[];
  slowMA: (number | null)[];
  zone: CDCZone[];
  bull: (boolean | null)[];    // FastMA > SlowMA
  signal: ("BUY" | "SELL" | null)[];  // first green / first red
  trend: ("bullish" | "bearish" | null)[];
}

export function cdcActionZone(
  data: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  smoothPeriod = 1,
): CDCActionZoneResult {
  // xPrice = EMA(close, smooth) — smooth=1 means just close
  const xPrice = smoothPeriod <= 1 ? data : ema(data, smoothPeriod).map((v, i) => v ?? data[i]);

  const fastMA = ema(xPrice as number[], fastPeriod);
  const slowMA = ema(xPrice as number[], slowPeriod);

  const len = data.length;
  const zone: CDCZone[] = [];
  const bullArr: (boolean | null)[] = [];
  const signalArr: ("BUY" | "SELL" | null)[] = [];
  const trendArr: ("bullish" | "bearish" | null)[] = [];

  // Track last buy/sell for trend determination
  let lastBuyBar = -Infinity;
  let lastSellBar = -Infinity;

  for (let i = 0; i < len; i++) {
    const f = fastMA[i];
    const s = slowMA[i];
    const p = xPrice[i];

    if (f === null || s === null || p === undefined) {
      zone.push(null);
      bullArr.push(null);
      signalArr.push(null);
      trendArr.push(null);
      continue;
    }

    const isBull = f > s;
    const isBear = f < s;
    bullArr.push(isBull);

    // Define zones
    let z: CDCZone;
    if (isBull && p > f) z = "green";          // Buy zone
    else if (isBear && p > f && p > s) z = "blue";    // Pre Buy 2
    else if (isBear && p > f && p < s) z = "lightblue"; // Pre Buy 1
    else if (isBear && p < f) z = "red";              // Sell zone
    else if (isBull && p < f && p < s) z = "orange";  // Pre Sell 2
    else if (isBull && p < f && p > s) z = "yellow";  // Pre Sell 1
    else z = null; // edge case (equal)
    zone.push(z);

    // Buy/Sell signals: first green after non-green, first red after non-red
    const prevZone = i > 0 ? zone[i - 1] : null;
    const isGreen = z === "green";
    const wasGreen = prevZone === "green";
    const isRed = z === "red";
    const wasRed = prevZone === "red";

    const buyCond = isGreen && !wasGreen;
    const sellCond = isRed && !wasRed;

    // Use prevTrend BEFORE updating lastBuyBar/lastSellBar (matches Pine: bearish[1])
    const prevTrend = trendArr[i - 1] ?? null;

    // Actual buy = bearish[1] and buyCond, sell = bullish[1] and sellCond
    // Pine Script requires strict bearish/bullish — no null fallback
    if (buyCond && prevTrend === "bearish") {
      signalArr.push("BUY");
    } else if (sellCond && prevTrend === "bullish") {
      signalArr.push("SELL");
    } else {
      signalArr.push(null);
    }

    // Update trend tracking AFTER signal check
    if (buyCond) lastBuyBar = i;
    if (sellCond) lastSellBar = i;

    const isBullish = lastBuyBar > lastSellBar;
    const isBearish = lastSellBar > lastBuyBar;
    trendArr.push(isBullish ? "bullish" : isBearish ? "bearish" : null);
  }

  return { fastMA, slowMA, zone, bull: bullArr, signal: signalArr, trend: trendArr };
}

// ─── CM MacD Ultimate MTF ────────────────────────────────────────
// Based on ChrisMoody's PineScript — Enhanced MACD with 4-color histogram
// showing momentum direction above/below zero line.

export type CMHistColor = "aqua" | "blue" | "red" | "maroon";

export interface CMMAcDResult {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
  histColor: (CMHistColor | null)[];     // 4-color histogram
  macdAboveSignal: (boolean | null)[];   // MACD >= Signal
  crossUp: boolean[];                    // MACD crosses above Signal
  crossDown: boolean[];                  // MACD crosses below Signal
  signal: ("BUY" | "SELL" | null)[];     // trading signals
}

export function cmMacdUltMTF(
  data: number[],
  fastLength = 12,
  slowLength = 26,
  signalLength = 9,
): CMMAcDResult {
  const len = data.length;
  const fastMA = ema(data, fastLength);
  const slowMA = ema(data, slowLength);

  const macdLine: (number | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (fastMA[i] !== null && slowMA[i] !== null) {
      macdLine.push(fastMA[i]! - slowMA[i]!);
    } else {
      macdLine.push(null);
    }
  }

  // Signal line = SMA of MACD (like in the PineScript: sma(macd, signalLength))
  const nonNullMacd = macdLine.filter(v => v !== null) as number[];
  const sigSMA = sma(nonNullMacd, signalLength);

  const signalLine: (number | null)[] = [];
  const histogram: (number | null)[] = [];
  let idx = 0;
  for (let i = 0; i < len; i++) {
    if (macdLine[i] === null) {
      signalLine.push(null);
      histogram.push(null);
    } else {
      const s = sigSMA[idx] ?? null;
      signalLine.push(s);
      histogram.push(s !== null ? macdLine[i]! - s : null);
      idx++;
    }
  }

  // 4-color histogram logic
  // histA_IsUp   = hist > hist[1] and hist > 0   → aqua  (เพิ่มขึ้น เหนือศูนย์)
  // histA_IsDown = hist < hist[1] and hist > 0   → blue  (ลดลง แต่ยังเหนือศูนย์)
  // histB_IsDown = hist < hist[1] and hist <= 0  → red   (ลดลง ใต้ศูนย์)
  // histB_IsUp   = hist > hist[1] and hist <= 0  → maroon (เพิ่มขึ้น แต่ยังใต้ศูนย์)
  const histColor: (CMHistColor | null)[] = [];
  const macdAboveSignal: (boolean | null)[] = [];
  const crossUp: boolean[] = [];
  const crossDown: boolean[] = [];
  const signal: ("BUY" | "SELL" | null)[] = [];

  for (let i = 0; i < len; i++) {
    const h = histogram[i];
    const hPrev = i > 0 ? histogram[i - 1] : null;
    const m = macdLine[i];
    const s = signalLine[i];

    if (h === null || hPrev === null) {
      histColor.push(null);
      macdAboveSignal.push(null);
      crossUp.push(false);
      crossDown.push(false);
      signal.push(null);
      continue;
    }

    // 4-color
    if (h > hPrev && h > 0) histColor.push("aqua");
    else if (h < hPrev && h > 0) histColor.push("blue");
    else if (h < hPrev && h <= 0) histColor.push("red");
    else if (h > hPrev && h <= 0) histColor.push("maroon");
    else histColor.push("blue"); // equal case

    // MACD vs Signal
    const isAbove = m !== null && s !== null ? m >= s : null;
    macdAboveSignal.push(isAbove);

    // Cross detection
    const prevM = i > 0 ? macdLine[i - 1] : null;
    const prevS = i > 0 ? signalLine[i - 1] : null;
    const prevAbove = prevM !== null && prevS !== null ? prevM >= prevS : null;
    const currAbove = m !== null && s !== null ? m >= s : null;

    const isCrossUp = prevAbove === false && currAbove === true;
    const isCrossDown = prevAbove === true && currAbove === false;
    crossUp.push(isCrossUp);
    crossDown.push(isCrossDown);

    // Trading signals
    if (isCrossUp) signal.push("BUY");
    else if (isCrossDown) signal.push("SELL");
    else signal.push(null);
  }

  return { macdLine, signalLine, histogram, histColor, macdAboveSignal, crossUp, crossDown, signal };
}

// ─── Smart Money Concepts (SMC) ─────────────────────────────────
// Converted from LuxAlgo PineScript — detects market structure,
// order blocks, fair value gaps, and premium/discount zones.

export type SMCStructureType = "BOS" | "CHoCH";
export type SMCBias = "bullish" | "bearish";

export interface SMCStructureBreak {
  index: number;        // bar where break happened
  type: SMCStructureType;
  bias: SMCBias;
  level: number;        // price level that was broken
  pivotIndex: number;   // bar index of the pivot that was broken
}

export interface SMCOrderBlock {
  startIndex: number;
  high: number;
  low: number;
  bias: SMCBias;
  mitigated: boolean;
  mitigatedIndex: number | null;
}

export interface SMCFairValueGap {
  index: number;        // middle candle index
  top: number;
  bottom: number;
  bias: SMCBias;
  filled: boolean;
  filledIndex: number | null;
}

export interface SMCSwingPoint {
  index: number;
  price: number;
  type: "HH" | "HL" | "LH" | "LL" | "H" | "L";
}

export interface SMCResult {
  swingTrend: (SMCBias | null)[];
  internalTrend: (SMCBias | null)[];
  swingStructures: SMCStructureBreak[];
  internalStructures: SMCStructureBreak[];
  swingOrderBlocks: SMCOrderBlock[];
  internalOrderBlocks: SMCOrderBlock[];
  fairValueGaps: SMCFairValueGap[];
  swingPoints: SMCSwingPoint[];
  premiumDiscount: ("premium" | "discount" | "equilibrium" | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

// ─── Pivot events (shared by S/R, Trendlines, SMC) ──────────────
// pivot ที่แท่ง i ต้องเห็นอีก `right` แท่งข้างหน้าจึงจะรู้ว่าเป็น pivot จริง
//   confirmed=false → บันทึกที่แท่ง i        (พฤติกรรม TS เดิม มี lookahead — ใช้เฉพาะ harness)
//   confirmed=true  → บันทึกที่แท่ง i + right (สิ่งที่เห็นจริงในเวลาจริง ตรงกับ ta_port/indicators.py)
// คืนค่าเป็น array ยาวเท่าข้อมูล: price[k] = ราคา pivot ที่ "รู้" ณ แท่ง k, index[k] = แท่งที่เกิด pivot จริง
export interface PivotEvents {
  highPrice: (number | null)[];
  highIndex: (number | null)[];
  lowPrice: (number | null)[];
  lowIndex: (number | null)[];
}

export function pivotEvents(
  h: number[], l: number[], left: number, right: number, confirmed: boolean,
): PivotEvents {
  const len = h.length;
  const highPrice: (number | null)[] = new Array(len).fill(null);
  const highIndex: (number | null)[] = new Array(len).fill(null);
  const lowPrice: (number | null)[] = new Array(len).fill(null);
  const lowIndex: (number | null)[] = new Array(len).fill(null);

  for (let i = left; i < len - right; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= left; j++) {
      if (h[i] <= h[i - j]) isHigh = false;
      if (l[i] >= l[i - j]) isLow = false;
    }
    for (let j = 1; j <= right; j++) {
      if (h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i + j]) isLow = false;
    }
    const key = confirmed ? i + right : i;
    if (isHigh) { highPrice[key] = h[i]; highIndex[key] = i; }
    if (isLow) { lowPrice[key] = l[i]; lowIndex[key] = i; }
  }
  return { highPrice, highIndex, lowPrice, lowIndex };
}

/**
 * Detect swing legs — a pivot high occurs when high[size] > highest(size bars after)
 * and pivot low when low[size] < lowest(size bars after).
 * confirmed=true → ค่าถูกบันทึกที่แท่ง i + size (ไม่มี lookahead)
 */
function detectPivots(
  h: number[], l: number[], size: number, confirmed: boolean,
): PivotEvents {
  return pivotEvents(h, l, size, size, confirmed);
}

/**
 * Detect market structure (BOS/CHoCH) from pivot points.
 * - BOS: price breaks above a pivot high in an uptrend (or below pivot low in downtrend)
 * - CHoCH: price breaks above a pivot high in a downtrend (trend reversal) or vice versa
 */
function detectStructure(
  c: number[], _h: number[], _l: number[],
  pv: PivotEvents,
): { structures: SMCStructureBreak[]; trend: (SMCBias | null)[] } {
  const len = c.length;
  const structures: SMCStructureBreak[] = [];
  const trend: (SMCBias | null)[] = new Array(len).fill(null);

  let currentTrend: SMCBias | null = null;
  let lastPivotHigh: { price: number; index: number; crossed: boolean } | null = null;
  let lastPivotLow: { price: number; index: number; crossed: boolean } | null = null;

  for (let i = 0; i < len; i++) {
    // Update pivots (ณ แท่งที่ "รู้" ว่ามี pivot; index = แท่งที่เกิด pivot จริง)
    if (pv.highPrice[i] !== null) {
      lastPivotHigh = { price: pv.highPrice[i]!, index: pv.highIndex[i]!, crossed: false };
    }
    if (pv.lowPrice[i] !== null) {
      lastPivotLow = { price: pv.lowPrice[i]!, index: pv.lowIndex[i]!, crossed: false };
    }

    // Check bullish break (close crosses above pivot high)
    if (lastPivotHigh && !lastPivotHigh.crossed && c[i] > lastPivotHigh.price) {
      const type: SMCStructureType = currentTrend === "bearish" ? "CHoCH" : "BOS";
      structures.push({
        index: i,
        type,
        bias: "bullish",
        level: lastPivotHigh.price,
        pivotIndex: lastPivotHigh.index,
      });
      lastPivotHigh.crossed = true;
      currentTrend = "bullish";
    }

    // Check bearish break (close crosses below pivot low)
    if (lastPivotLow && !lastPivotLow.crossed && c[i] < lastPivotLow.price) {
      const type: SMCStructureType = currentTrend === "bullish" ? "CHoCH" : "BOS";
      structures.push({
        index: i,
        type,
        bias: "bearish",
        level: lastPivotLow.price,
        pivotIndex: lastPivotLow.index,
      });
      lastPivotLow.crossed = true;
      currentTrend = "bearish";
    }

    trend[i] = currentTrend;
  }

  return { structures, trend };
}

/**
 * Detect Order Blocks — the last opposite candle before a structure break.
 * Bullish OB: last bearish candle before a bullish break
 * Bearish OB: last bullish candle before a bearish break
 */
function detectOrderBlocks(
  c: number[], o: number[], h: number[], l: number[],
  structures: SMCStructureBreak[],
): SMCOrderBlock[] {
  const orderBlocks: SMCOrderBlock[] = [];
  const len = c.length;

  for (const s of structures) {
    // Search backward from the pivot for the last opposite candle
    const searchEnd = s.pivotIndex;
    const searchStart = Math.max(0, searchEnd - 20);

    if (s.bias === "bullish") {
      // Find last bearish candle before the bullish break
      for (let j = searchEnd; j >= searchStart; j--) {
        if (c[j] < o[j]) {
          orderBlocks.push({
            startIndex: j,
            high: h[j],
            low: l[j],
            bias: "bullish",
            mitigated: false,
            mitigatedIndex: null,
          });
          break;
        }
      }
    } else {
      // Find last bullish candle before the bearish break
      for (let j = searchEnd; j >= searchStart; j--) {
        if (c[j] > o[j]) {
          orderBlocks.push({
            startIndex: j,
            high: h[j],
            low: l[j],
            bias: "bearish",
            mitigated: false,
            mitigatedIndex: null,
          });
          break;
        }
      }
    }
  }

  const lowSearch = new PriceSearch(l, "min"), highSearch = new PriceSearch(h, "max");
  for (const ob of orderBlocks) {
    const index = ob.bias === "bullish" ? lowSearch.first(ob.startIndex + 1, ob.low) : highSearch.first(ob.startIndex + 1, ob.high);
    ob.mitigated = index >= 0;
    ob.mitigatedIndex = index >= 0 ? index : null;
  }

  return orderBlocks;
}

/**
 * Detect Fair Value Gaps — a 3-candle pattern where there's a gap
 * between candle 1 and candle 3 (candle 2 doesn't fill the gap).
 */
function detectFairValueGaps(
  h: number[], l: number[], _c: number[], _o: number[],
  atrValues: (number | null)[],
): SMCFairValueGap[] {
  const fvgs: SMCFairValueGap[] = [];
  const len = h.length;
  const lowSearch = new PriceSearch(l, "min"), highSearch = new PriceSearch(h, "max");

  for (let i = 2; i < len; i++) {
    const atrVal = atrValues[i];
    // Bullish FVG: candle3 low > candle1 high (gap up)
    if (l[i] > h[i - 2]) {
      const gapSize = l[i] - h[i - 2];
      // Filter by ATR threshold (gap must be meaningful)
      if (atrVal === null || gapSize > atrVal * 0.1) {
        const fvg: SMCFairValueGap = {
          index: i - 1,
          top: l[i],
          bottom: h[i - 2],
          bias: "bullish",
          filled: false,
          filledIndex: null,
        };
        // Check if FVG is filled later
        const filled = lowSearch.first(i + 1, fvg.bottom);
        fvg.filled = filled >= 0;
        fvg.filledIndex = filled >= 0 ? filled : null;
        fvgs.push(fvg);
      }
    }

    // Bearish FVG: candle3 high < candle1 low (gap down)
    if (h[i] < l[i - 2]) {
      const gapSize = l[i - 2] - h[i];
      if (atrVal === null || gapSize > atrVal * 0.1) {
        const fvg: SMCFairValueGap = {
          index: i - 1,
          top: l[i - 2],
          bottom: h[i],
          bias: "bearish",
          filled: false,
          filledIndex: null,
        };
        const filled = highSearch.first(i + 1, fvg.top);
        fvg.filled = filled >= 0;
        fvg.filledIndex = filled >= 0 ? filled : null;
        fvgs.push(fvg);
      }
    }
  }

  return fvgs;
}

/**
 * Detect swing point labels (HH, HL, LH, LL)
 */
function detectSwingPoints(pv: PivotEvents): SMCSwingPoint[] {
  const points: SMCSwingPoint[] = [];
  let lastHigh: number | null = null;
  let lastLow: number | null = null;

  for (let i = 0; i < pv.highPrice.length; i++) {
    if (pv.highPrice[i] !== null) {
      const price = pv.highPrice[i]!;
      let type: SMCSwingPoint["type"];
      if (lastHigh === null) type = "H";
      else type = price > lastHigh ? "HH" : "LH";
      points.push({ index: pv.highIndex[i]!, price, type });
      lastHigh = price;
    }
    if (pv.lowPrice[i] !== null) {
      const price = pv.lowPrice[i]!;
      let type: SMCSwingPoint["type"];
      if (lastLow === null) type = "L";
      else type = price > lastLow ? "HL" : "LL";
      points.push({ index: pv.lowIndex[i]!, price, type });
      lastLow = price;
    }
  }

  return points;
}

/**
 * Determine premium/discount zones based on trailing swing high/low
 */
function detectPremiumDiscount(
  c: number[], h: number[], l: number[],
  pv: PivotEvents,
): ("premium" | "discount" | "equilibrium" | null)[] {
  const len = c.length;
  const result: ("premium" | "discount" | "equilibrium" | null)[] = new Array(len).fill(null);

  let trailingHigh = -Infinity;
  let trailingLow = Infinity;

  for (let i = 0; i < len; i++) {
    if (pv.highPrice[i] !== null) trailingHigh = pv.highPrice[i]!;
    if (pv.lowPrice[i] !== null) trailingLow = pv.lowPrice[i]!;

    // Also update with price action
    if (h[i] > trailingHigh) trailingHigh = h[i];
    if (l[i] < trailingLow) trailingLow = l[i];

    if (trailingHigh === -Infinity || trailingLow === Infinity) continue;

    const range = trailingHigh - trailingLow;
    if (range <= 0) continue;

    const equilibrium = (trailingHigh + trailingLow) / 2;
    const premiumThreshold = equilibrium + range * 0.25;
    const discountThreshold = equilibrium - range * 0.25;

    if (c[i] >= premiumThreshold) result[i] = "premium";
    else if (c[i] <= discountThreshold) result[i] = "discount";
    else result[i] = "equilibrium";
  }

  return result;
}

/**
 * Generate SMC trading signals
 * BUY: Bullish CHoCH or BOS in discount zone, or bullish OB retest
 * SELL: Bearish CHoCH or BOS in premium zone, or bearish OB retest
 */
function generateSMCSignals(
  len: number,
  structures: SMCStructureBreak[],
  premiumDiscount: ("premium" | "discount" | "equilibrium" | null)[],
  _trend: (SMCBias | null)[],
): ("BUY" | "SELL" | null)[] {
  const signals: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  // Structure-based signals
  for (const s of structures) {
    if (s.type === "CHoCH") {
      // CHoCH is a stronger signal (trend reversal)
      if (s.bias === "bullish") {
        signals[s.index] = "BUY";
      } else {
        signals[s.index] = "SELL";
      }
    } else if (s.type === "BOS") {
      // BOS in favorable zone
      const zone = premiumDiscount[s.index];
      if (s.bias === "bullish" && (zone === "discount" || zone === "equilibrium")) {
        signals[s.index] = "BUY";
      } else if (s.bias === "bearish" && (zone === "premium" || zone === "equilibrium")) {
        signals[s.index] = "SELL";
      }
    }
  }

  return signals;
}

export function smartMoneyConcepts(
  klines: KlineData[],
  swingSize = 50,
  internalSize = 5,
  confirmed = true,
): SMCResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(x => +x.open);
  const len = klines.length;

  // ATR for filtering
  const atrValues = atr(klines, 200);

  // Detect pivots at both swing and internal levels
  // confirmed=true → pivot ถูก "รู้" ที่แท่ง i + size (ตรงกับ Python และเวลาจริง)
  const swingPivots = detectPivots(h, l, swingSize, confirmed);
  const internalPivots = detectPivots(h, l, internalSize, confirmed);

  // Detect structure
  const swingResult = detectStructure(c, h, l, swingPivots);
  const internalResult = detectStructure(c, h, l, internalPivots);

  // Order Blocks (ไม่ได้ใช้ในสัญญาณ เก็บไว้ให้กราฟ)
  const swingOBs = detectOrderBlocks(c, o, h, l, swingResult.structures);
  const internalOBs = detectOrderBlocks(c, o, h, l, internalResult.structures);

  // Fair Value Gaps (ไม่ได้ใช้ในสัญญาณ)
  const fvgs = detectFairValueGaps(h, l, c, o, atrValues);

  // Swing Points
  const swingPoints = detectSwingPoints(swingPivots);

  // Premium/Discount
  const premiumDiscount = detectPremiumDiscount(c, h, l, swingPivots);

  // Signals
  const signal = generateSMCSignals(len, internalResult.structures, premiumDiscount, internalResult.trend);

  return {
    swingTrend: swingResult.trend,
    internalTrend: internalResult.trend,
    swingStructures: swingResult.structures,
    internalStructures: internalResult.structures,
    swingOrderBlocks: swingOBs,
    internalOrderBlocks: internalOBs,
    fairValueGaps: fvgs,
    swingPoints,
    premiumDiscount,
    signal,
  };
}

// ─── SMC Adaptive: confirmed structure + liquidity reclaim ────────
export const SMC_ADAPTIVE_DEFAULTS = {
  swingSize: 30, internalSize: 20, atrPeriod: 14, trendPeriod: 200,
  stopAtr: 3, trailAtr: 4, rewardRisk: 3,
  maxHoldBars: 120, cooldownBars: 6, rsiThreshold: 25,
  trendThreshold: 0.25, maxVolatilityRatio: 2.5,
};
export type SMCAdaptiveParams = typeof SMC_ADAPTIVE_DEFAULTS;
export interface SMCAdaptiveResult {
  signal: ("BUY" | "SELL" | null)[];
  reason: string[];
  regime: ("warmup" | "range" | "uptrend" | "downtrend" | "shock")[];
  atr: (number | null)[];
  trendEMA: (number | null)[];
  rsi: (number | null)[];
  efficiency: (number | null)[];
  volatilityRatio: (number | null)[];
  support: (number | null)[];
  resistance: (number | null)[];
  stop: (number | null)[];
  target: (number | null)[];
  position: boolean[];
  structures: SMCStructureBreak[];
}

/**
 * Closed bars only. Pivots become available at pivotIndex + size.
 * Trade state starts flat at startIndex; earlier bars only warm up market features.
 * Stop/target are CLOSE-triggered signal levels, never assumed intrabar fills.
 * Risk levels anchor to the BUY signal close; next-open gaps/slippage are borne
 * by the simulator. No order-block final mitigation/future FVG state is consumed.
 */
export function smcAdaptive(
  klines: KlineData[], overrides: Partial<SMCAdaptiveParams> = {}, startIndex = 0,
): SMCAdaptiveResult {
  const p = { ...SMC_ADAPTIVE_DEFAULTS, ...overrides };
  for (const [key, value] of Object.entries(p)) {
    const period = /Size|Period|Bars/.test(key);
    if (!Number.isFinite(value) || value <= 0 ||
      (period && (!Number.isInteger(value) || value < 2 || value > 200)))
      throw new Error(`Invalid SMC Adaptive parameter: ${key}`);
  }
  if (p.internalSize >= p.swingSize || p.trendThreshold > 1 || p.rsiThreshold >= 70)
    throw new Error("SMC Adaptive: internalSize < swingSize, trendThreshold <= 1, rsiThreshold < 70 required");
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > klines.length)
    throw new Error("Invalid SMC Adaptive startIndex");
  const c = closes(klines), h = highs(klines), l = lows(klines);
  const n = c.length;
  const av = atr(klines, p.atrPeriod), slowAtr = atr(klines, Math.max(50, p.atrPeriod));
  const trendEMA = ema(c, p.trendPeriod), rv = rsi(c, 14);
  const pv = detectPivots(h, l, p.internalSize, true);
  const swing = detectPivots(h, l, p.swingSize, true);
  const structure = detectStructure(c, h, l, pv);
  const events = new Map(structure.structures.map(s => [s.index, s]));
  const result: SMCAdaptiveResult = {
    signal: new Array(n).fill(null), reason: new Array(n).fill("warmup"),
    regime: new Array(n).fill("warmup"), atr: av, trendEMA, rsi: rv,
    efficiency: new Array(n).fill(null), volatilityRatio: new Array(n).fill(null),
    support: new Array(n).fill(null), resistance: new Array(n).fill(null),
    stop: new Array(n).fill(null), target: new Array(n).fill(null),
    position: new Array(n).fill(false), structures: structure.structures,
  };
  let support: number | null = null, resistance: number | null = null;
  let swingHigh: number | null = null, swingLow: number | null = null;
  let reclaim = -Infinity, reclaimLow = 0;
  let entry = -1, entryPrice = 0, risk = 0, stop = 0, target = 0, peakClose = 0;
  let lastExit = -Infinity, entryKind = "";
  for (let i = 0; i < n; i++) {
    if (pv.lowPrice[i] !== null) support = pv.lowPrice[i];
    if (pv.highPrice[i] !== null) resistance = pv.highPrice[i];
    if (swing.highPrice[i] !== null) swingHigh = swing.highPrice[i];
    if (swing.lowPrice[i] !== null) swingLow = swing.lowPrice[i];
    result.support[i] = support; result.resistance[i] = resistance;
    const a = av[i], slow = slowAtr[i], trend = trendEMA[i], r = rv[i];
    if (i < 20 || a === null || a <= 0 || slow === null || slow <= 0 || trend === null || r === null) continue;
    let travel = 0;
    for (let j = i - 19; j <= i; j++) travel += Math.abs(c[j] - c[j - 1]);
    const efficiency = travel ? Math.abs(c[i] - c[i - 20]) / travel : 0;
    const ratio = a / slow;
    const shock = ratio > p.maxVolatilityRatio || h[i] - l[i] > 4 * a;
    const trending = efficiency >= p.trendThreshold;
    const rising = c[i] > trend && trend >= (trendEMA[i - 5] ?? trend);
    const falling = c[i] < trend && trend < (trendEMA[i - 5] ?? trend);
    result.efficiency[i] = efficiency; result.volatilityRatio[i] = ratio;
    result.regime[i] = shock ? "shock" : trending && rising ? "uptrend" : trending && falling ? "downtrend" : "range";
    const event = events.get(i);
    // Remember sell-side liquidity taken and reclaimed, using levels known now.
    if (support !== null && l[i] < support && c[i] > support && r < p.rsiThreshold + 10) {
      reclaim = i; reclaimLow = l[i];
    }
    if (i < startIndex) { result.reason[i] = "warmup (no position)"; continue; }
    result.reason[i] = "wait for SMC setup";
    if (entry >= 0) {
      // Test the previous stop before ratcheting; an expanding ATR never widens it.
      result.stop[i] = stop; result.target[i] = target;
      const exitReason = c[i] <= stop ? "ATR close stop" : c[i] >= target ? "risk target (close)" :
        event?.bias === "bearish" ? "bearish BOS/CHoCH" :
        entryKind === "liquidity reclaim" && r >= 70 ? "reclaim RSI exit" :
        i - entry >= p.maxHoldBars ? "time exit" : "";
      if (exitReason) {
        result.signal[i] = "SELL"; result.reason[i] = exitReason;
        entry = -1; lastExit = i; reclaim = -Infinity;
      } else {
        peakClose = Math.max(peakClose, c[i]);
        if (peakClose - entryPrice >= risk)
          stop = Math.max(stop, peakClose - p.trailAtr * a);
        result.stop[i] = stop; result.position[i] = true;
        result.reason[i] = "hold; close-based risk monitoring";
      }
      continue;
    }
    if (shock || i - lastExit <= p.cooldownBars) {
      result.reason[i] = shock ? "volatility shock: no entry" : "cooldown"; continue;
    }
    const discount = swingHigh !== null && swingLow !== null && swingHigh > swingLow
      ? c[i] <= (swingHigh + swingLow) / 2 : c[i] <= trend;
    const recentOversold = rv.slice(Math.max(0, i - 8), i + 1).some(v => v !== null && v < p.rsiThreshold);
    const sweepEntry = i - reclaim <= 6 && discount && recentOversold &&
      c[i] > +klines[i].open && c[i] > c[i - 1] && result.regime[i] !== "downtrend";
    const breakoutEntry = event?.bias === "bullish" && rising &&
      c[i] > event.level + 0.1 * a && c[i] > +klines[i].open && r < 75;
    if (!sweepEntry && !breakoutEntry) continue;
    const adaptiveAtr = a * Math.max(1, Math.min(1.5, ratio));
    risk = p.stopAtr * adaptiveAtr;
    // A swept low can strengthen the initial stop, but never increase risk.
    stop = sweepEntry ? Math.max(c[i] - risk, reclaimLow - 0.25 * a) : c[i] - risk;
    risk = c[i] - stop;
    if (risk < 0.5 * a) continue;
    entry = i; entryPrice = peakClose = c[i]; target = c[i] + risk * p.rewardRisk;
    entryKind = sweepEntry ? "liquidity reclaim" : "bullish BOS/CHoCH breakout";
    result.signal[i] = "BUY"; result.reason[i] = entryKind;
    result.stop[i] = stop; result.target[i] = target; result.position[i] = true;
    reclaim = -Infinity;
  }
  return result;
}

// ─── SMC Adaptive V2: SMC / Trendlines confluence ─────────────────
export interface DirectionalMovementResult {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
}

/** Wilder DM/TR smoothing; first DI at period, first ADX at 2*period-1. */
export function directionalMovement(k: KlineData[], period = 14): DirectionalMovementResult {
  if (!Number.isInteger(period) || period < 2 || period > 200) throw new Error("Invalid ADX period");
  const n = k.length;
  const result: DirectionalMovementResult = {
    adx: new Array(n).fill(null), plusDI: new Array(n).fill(null), minusDI: new Array(n).fill(null),
  };
  let trSum = 0, upSum = 0, downSum = 0, dxSum = 0, previousADX: number | null = null;
  for (let i = 1; i < n; i++) {
    const up = +k[i].high - +k[i - 1].high, down = +k[i - 1].low - +k[i].low;
    const plus = up > down && up > 0 ? up : 0;
    const minus = down > up && down > 0 ? down : 0;
    const tr = Math.max(+k[i].high - +k[i].low, Math.abs(+k[i].high - +k[i - 1].close), Math.abs(+k[i].low - +k[i - 1].close));
    if (i <= period) { trSum += tr; upSum += plus; downSum += minus; }
    else { trSum += tr - trSum / period; upSum += plus - upSum / period; downSum += minus - downSum / period; }
    if (i < period) continue;
    const positive = trSum ? 100 * upSum / trSum : 0, negative = trSum ? 100 * downSum / trSum : 0;
    result.plusDI[i] = positive; result.minusDI[i] = negative;
    const dx = positive + negative ? 100 * Math.abs(positive - negative) / (positive + negative) : 0;
    if (i < 2 * period) dxSum += dx;
    if (i === 2 * period - 1) previousADX = dxSum / period;
    else if (previousADX !== null) previousADX = (previousADX * (period - 1) + dx) / period;
    result.adx[i] = previousADX;
  }
  return result;
}

export const SMC_ADAPTIVE_V2_DEFAULTS = {
  internalSize: 7, trendLength: 10, trendMult: 1,
  fastPeriod: 21, trendPeriod: 100, trendSlopeBars: 6, atrPeriod: 14, adxPeriod: 14,
  adxThreshold: 25, confluenceBars: 12, stopAtr: 3, trailAtr: 6,
  breakEvenAtr: 2, breakEvenBufferPct: 0.35, minStopPct: 0.6,
  maxHoldBars: 200, cooldownBars: 2, maxVolatilityRatio: 2.5, maxExtensionAtr: 3,
};
export type SMCAdaptiveV2Params = typeof SMC_ADAPTIVE_V2_DEFAULTS;
export interface SMCAdaptiveV2Result extends DirectionalMovementResult {
  signal: ("BUY" | "SELL" | null)[];
  reason: string[];
  regime: ("warmup" | "range" | "uptrend" | "downtrend" | "shock")[];
  atr: (number | null)[];
  fastEMA: (number | null)[];
  trendEMA: (number | null)[];
  volatilityRatio: (number | null)[];
  trendlineUpper: (number | null)[];
  trendlineLower: (number | null)[];
  structureTrend: (SMCBias | null)[];
  stop: (number | null)[];
  initialRisk: (number | null)[];
  position: boolean[];
  structures: SMCStructureBreak[];
}

/**
 * Long-only, confirmed-bar signals. The V1 structure/ATR model is combined with
 * confirmed Trendlines, Wilder ADX/DI and trend/extension filters. Fresh SMC
 * breaks and EMA pullback reclaims allow another entry in an established trend.
 * Stops use CLOSED prices and trigger a SELL signal, filled by the caller's
 * next-open engine. Neither a high/low touch nor a plotted stop implies a fill.
 * No fixed profit cap: ratchet the stop with peak CLOSE, never widen it.
 * startIndex resets trade state while keeping causal market feature warmup.
 */
export function smcAdaptiveV2(
  k: KlineData[], overrides: Partial<SMCAdaptiveV2Params> = {}, startIndex = 0,
): SMCAdaptiveV2Result {
  const p = { ...SMC_ADAPTIVE_V2_DEFAULTS, ...overrides };
  for (const [key, value] of Object.entries(p)) {
    const period = /Size|Length|Period|Bars/.test(key);
    if (!Number.isFinite(value) || value <= 0 ||
      (period && (!Number.isInteger(value) || value < 2 || value > 200)))
      throw new Error(`Invalid SMC Adaptive V2 parameter: ${key}`);
  }
  if (p.fastPeriod >= p.trendPeriod || p.adxThreshold > 100)
    throw new Error("SMC Adaptive V2 requires fastPeriod < trendPeriod and ADX <= 100");
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > k.length)
    throw new Error("Invalid SMC Adaptive V2 startIndex");
  const c = closes(k), h = highs(k), l = lows(k), n = k.length;
  const av = atr(k, p.atrPeriod), slow = atr(k, Math.max(50, p.atrPeriod));
  const fast = ema(c, p.fastPeriod), trend = ema(c, p.trendPeriod);
  const dm = directionalMovement(k, p.adxPeriod);
  const pv = detectPivots(h, l, p.internalSize, true);
  const structure = detectStructure(c, h, l, pv);
  const events = new Map(structure.structures.map(e => [e.index, e]));
  const tl = trendlinesWithBreaks(k, p.trendLength, p.trendMult, "Atr", true);
  const tlPivots = detectPivots(h, l, p.trendLength, true);
  const r: SMCAdaptiveV2Result = {
    ...dm, signal: new Array(n).fill(null), reason: new Array(n).fill("warmup"),
    regime: new Array(n).fill("warmup"), atr: av, fastEMA: fast, trendEMA: trend,
    volatilityRatio: new Array(n).fill(null), trendlineUpper: new Array(n).fill(null),
    trendlineLower: new Array(n).fill(null), structureTrend: structure.trend,
    stop: new Array(n).fill(null), initialRisk: new Array(n).fill(null),
    position: new Array(n).fill(false), structures: structure.structures,
  };
  let upperKnown = false, lowerKnown = false;
  let lastTLBuy = -Infinity, lastExit = -Infinity;
  let entry = -1, entryPrice = 0, initialATR = 0, risk = 0, stop = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    if (tlPivots.highPrice[i] !== null) { upperKnown = true; lastTLBuy = -Infinity; }
    if (tlPivots.lowPrice[i] !== null) lowerKnown = true;
    // Ignore Trendlines' bootstrap upper=0; a real confirmed pivot is required.
    r.trendlineUpper[i] = upperKnown ? tl.upper[i] : null;
    r.trendlineLower[i] = lowerKnown ? tl.lower[i] : null;
    const e = events.get(i);
    if (e?.bias === "bearish") lastTLBuy = -Infinity;
    if (upperKnown && tl.breakUp[i]) lastTLBuy = i;
    if (lowerKnown && tl.breakDown[i]) lastTLBuy = -Infinity;
    const a = av[i], slowATR = slow[i], f = fast[i], t = trend[i], adx = dm.adx[i];
    if (a === null || a <= 0 || slowATR === null || slowATR <= 0 || f === null || t === null || adx === null) continue;
    const ratio = a / slowATR;
    const shock = ratio > p.maxVolatilityRatio || h[i] - l[i] > 4 * a;
    const up = c[i] > t && f > t && t > (trend[i - p.trendSlopeBars] ?? t) &&
      f >= (fast[i - 2] ?? f) && dm.plusDI[i]! > dm.minusDI[i]!;
    r.volatilityRatio[i] = ratio;
    r.regime[i] = shock ? "shock" : adx < p.adxThreshold ? "range" : up ? "uptrend" :
      c[i] < t && dm.minusDI[i]! > dm.plusDI[i]! ? "downtrend" : "range";
    if (i < startIndex) { r.reason[i] = "warmup (no position)"; continue; }
    if (entry >= 0) {
      r.stop[i] = stop; r.initialRisk[i] = risk;
      const reason = c[i] <= stop ? "ATR/profit-protection close stop" :
        e?.bias === "bearish" && c[i] < f ? "bearish SMC + weak momentum" :
        lowerKnown && tl.breakDown[i] && c[i] < f ? "trendline breakdown + weak momentum" :
        i - entry >= p.maxHoldBars ? "time exit" : "";
      if (reason) {
        r.signal[i] = "SELL"; r.reason[i] = reason; entry = -1;
        lastExit = i; lastTLBuy = -Infinity;
      } else {
        peak = Math.max(peak, c[i]);
        // A percentage floor prevents tiny low-timeframe ATR from forcing churn.
        // This is a configured price distance, not an assumed execution fee.
        stop = Math.max(stop, peak - Math.max(p.trailAtr * a, peak * p.minStopPct / 100));
        // Never "protect" +0.35% after price has advanced only +0.05%.
        const buffer = entryPrice * p.breakEvenBufferPct / 100;
        if (peak - entryPrice >= Math.max(p.breakEvenAtr * initialATR, buffer + initialATR))
          stop = Math.max(stop, entryPrice * (1 + p.breakEvenBufferPct / 100));
        // A newly tightened close-stop can trigger on this same CLOSED candle.
        if (c[i] <= stop) {
          r.signal[i] = "SELL"; r.reason[i] = "tightened profit-protection close stop";
          entry = -1; lastExit = i; lastTLBuy = -Infinity;
        } else { r.position[i] = true; r.reason[i] = "hold; trailing close stop"; }
        r.stop[i] = stop;
      }
      continue;
    }
    r.reason[i] = "wait for SMC + Trendlines confluence";
    if (shock) { r.reason[i] = "volatility shock: no entry"; continue; }
    if (i - lastExit <= p.cooldownBars) { r.reason[i] = "cooldown"; continue; }
    const freshLineBreak = i - lastTLBuy <= p.confluenceBars;
    const freshStructureBreak = e?.bias === "bullish";
    const pullbackReclaim = i > 0 && fast[i - 1] !== null &&
      c[i - 1] <= fast[i - 1]! && c[i] > f;
    const setup = freshStructureBreak ? "SMC structure breakout" :
      pullbackReclaim ? "EMA pullback reclaim" : freshLineBreak ? "Trendlines breakout" : "";
    if (!setup || structure.trend[i] !== "bullish" || !up || adx < p.adxThreshold || c[i] <= +k[i].open ||
      c[i] <= (r.trendlineUpper[i] ?? Infinity) || (c[i] - f) / a > p.maxExtensionAtr) continue;
    entry = i; entryPrice = peak = c[i]; initialATR = a;
    risk = Math.max(p.stopAtr * a * Math.max(1, Math.min(1.5, ratio)), c[i] * p.minStopPct / 100);
    stop = c[i] - risk;
    r.signal[i] = "BUY"; r.reason[i] = `${setup} + bullish SMC/Trendlines + ADX/DI`;
    r.stop[i] = stop; r.initialRisk[i] = risk; r.position[i] = true;
    lastTLBuy = -Infinity;
  }
  return r;
}

// ─── SMC Adaptive Short trade: short-duration SPOT, not short selling ───
export const SMC_ADAPTIVE_SHORT_DEFAULTS = {
  internalSize: 5, swingSize: 20, fastPeriod: 21, trendPeriod: 55,
  atrPeriod: 14, adxPeriod: 14, volumePeriod: 20,
  adxThreshold: 25, rsiThreshold: 65, minVolumeRatio: 0.8,
  setupBars: 5, cooldownBars: 3, shockBars: 3,
  stopAtr: 1.2, targetAtr: 14, trailAtr: 2, minRiskPct: 0.08,
  costPct: 0.31, minNetProfitPct: 0.08, minNetRewardRisk: 0.75,
  maxHoldBars: 48, maxExtensionAtr: 1.5, maxVolatilityRatio: 2.2, shockAtr: 3.5,
};
export type SMCAdaptiveShortParams = typeof SMC_ADAPTIVE_SHORT_DEFAULTS;
export interface SMCAdaptiveShortResult extends DirectionalMovementResult {
  signal: ("BUY" | "SELL" | null)[];
  reason: string[];
  regime: ("warmup" | "range" | "uptrend" | "downtrend" | "shock")[];
  atr: (number | null)[];
  fastEMA: (number | null)[];
  trendEMA: (number | null)[];
  rsi: (number | null)[];
  volumeRatio: (number | null)[];
  support: (number | null)[];
  resistance: (number | null)[];
  stop: (number | null)[];
  target: (number | null)[];
  initialRisk: (number | null)[];
  netRewardRisk: (number | null)[];
  position: boolean[];
  structures: SMCStructureBreak[];
}

/** Short holding periods, long-only. All pivots are confirmed before use.
 * Targets/stops are checked at CLOSE; the execution engine fills next OPEN.
 * costPct is a user-configured round-trip estimate, independent of engine fees.
 * The entry gate tests a volatility/structure-derived target against costs;
 * it never moves a target farther away merely to pass that gate.
 */
export function smcAdaptiveShort(
  k: KlineData[], overrides: Partial<SMCAdaptiveShortParams> = {}, startIndex = 0,
): SMCAdaptiveShortResult {
  const p = { ...SMC_ADAPTIVE_SHORT_DEFAULTS, ...overrides };
  for (const [key, v] of Object.entries(p)) {
    if (!Number.isFinite(v) || v <= 0 ||
      (/Size|Period|Bars/.test(key) && (!Number.isInteger(v) || v < 2 || v > 200)))
      throw new Error(`Invalid SMC Adaptive Short parameter: ${key}`);
  }
  if (p.fastPeriod >= p.trendPeriod || p.internalSize >= p.swingSize || p.adxThreshold > 100 || p.rsiThreshold >= 100)
    throw new Error("SMC Adaptive Short requires fast < trend, internal < swing, valid ADX/RSI");
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > k.length)
    throw new Error("Invalid SMC Adaptive Short startIndex");
  const n = k.length, c = closes(k), h = highs(k), l = lows(k);
  const av = atr(k, p.atrPeriod), slowATR = atr(k, Math.max(50, p.atrPeriod));
  const fast = ema(c, p.fastPeriod), trend = ema(c, p.trendPeriod), rv = rsi(c, 14);
  const volumes = k.map(b => +b.volume), volumeMean = sma(volumes, p.volumePeriod);
  const dm = directionalMovement(k, p.adxPeriod);
  const internal = detectPivots(h, l, p.internalSize, true), swing = detectPivots(h, l, p.swingSize, true);
  const structure = detectStructure(c, h, l, internal), events = new Map(structure.structures.map(e => [e.index, e]));
  const empty = () => new Array<number | null>(n).fill(null);
  const r: SMCAdaptiveShortResult = {
    ...dm, signal: new Array(n).fill(null), reason: new Array(n).fill("warmup"), regime: new Array(n).fill("warmup"),
    atr: av, fastEMA: fast, trendEMA: trend, rsi: rv, volumeRatio: empty(), support: empty(), resistance: empty(),
    stop: empty(), target: empty(), initialRisk: empty(), netRewardRisk: empty(), position: new Array(n).fill(false), structures: structure.structures,
  };
  let support: number | null = null, resistance: number | null = null;
  let sweep = -Infinity, sweepLow = 0, sweptLevel = 0, breakout = -Infinity, breakLevel = 0;
  let lastExit = -Infinity, lastShock = -Infinity, entry = -1;
  let entryPrice = 0, entryATR = 0, risk = 0, stop = 0, target = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    if (internal.lowPrice[i] !== null) { support = internal.lowPrice[i]; sweep = -Infinity; }
    if (swing.highPrice[i] !== null) resistance = swing.highPrice[i];
    r.support[i] = support; r.resistance[i] = resistance;
    const e = events.get(i);
    if (e?.bias === "bullish") { breakout = i; breakLevel = e.level; }
    if (e?.bias === "bearish") { breakout = -Infinity; sweep = -Infinity; }
    const a = av[i], slow = slowATR[i], f = fast[i], t = trend[i], adx = dm.adx[i], rs = rv[i];
    const mean = volumeMean[i - 1]; // Compare with completed PRIOR volumes, excluding the current bar.
    if (a === null || a <= 0 || slow === null || slow <= 0 || f === null || t === null || adx === null || rs === null || mean == null) continue;
    r.volumeRatio[i] = mean > 0 ? volumes[i] / mean : 0;
    const trueRange = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    const shock = a / slow > p.maxVolatilityRatio || trueRange > p.shockAtr * (av[i - 1] ?? a);
    if (shock) { lastShock = i; sweep = breakout = -Infinity; }
    const up = c[i] > t && f > t && t > (trend[i - 5] ?? t) && dm.plusDI[i]! > dm.minusDI[i]!;
    const down = c[i] < t && f < t && t < (trend[i - 5] ?? t) && dm.minusDI[i]! > dm.plusDI[i]! && adx >= p.adxThreshold;
    r.regime[i] = i - lastShock <= p.shockBars ? "shock" : down ? "downtrend" : up ? "uptrend" : "range";
    if (sweep > -Infinity && (i - sweep > p.setupBars || c[i] < sweptLevel - .25 * a)) sweep = -Infinity;
    if (!shock && support !== null && l[i] < support && c[i] > support && c[i] > +k[i].open) {
      sweep = i; sweepLow = l[i]; sweptLevel = support;
    }
    if (i < startIndex) { r.reason[i] = "warmup (no position)"; continue; }
    if (entry >= 0) {
      r.initialRisk[i] = risk; r.stop[i] = stop; r.target[i] = target;
      let reason = c[i] <= stop ? "risk stop (close)" : c[i] >= target ? "scalp target (close)" :
        e?.bias === "bearish" && c[i] < f ? "bearish SMC invalidation" : i - entry >= p.maxHoldBars ? "short-duration time exit" : "";
      if (!reason) {
        peak = Math.max(peak, c[i]);
        // Activate only after the assumed cost plus one entry ATR is earned.
        if (peak - entryPrice >= entryPrice * p.costPct / 100 + entryATR)
          stop = Math.max(stop, entryPrice * (1 + p.costPct / 100), peak - p.trailAtr * a);
        if (c[i] <= stop) reason = "profit protection (close)";
      }
      r.stop[i] = stop;
      if (reason) {
        r.signal[i] = "SELL"; r.reason[i] = reason; entry = -1; lastExit = i; sweep = breakout = -Infinity;
      } else { r.position[i] = true; r.reason[i] = "hold; short-duration risk monitoring"; }
      continue;
    }
    if (r.regime[i] === "shock") { r.reason[i] = "shock cooldown"; continue; }
    if (down) { r.reason[i] = "strong downtrend: no long entry"; continue; }
    if (i - lastExit <= p.cooldownBars) { r.reason[i] = "trade cooldown"; continue; }
    if (r.volumeRatio[i]! < p.minVolumeRatio) { r.reason[i] = "insufficient relative volume"; continue; }
    const green = c[i] > +k[i].open && c[i] > c[i - 1] && c[i] - l[i] >= .6 * (h[i] - l[i]);
    const reclaim = i - sweep <= p.setupBars && c[i] > h[i - 1] && c[i] > sweptLevel && rs > (rv[i - 1] ?? rs);
    const retest = i > breakout && i - breakout <= p.setupBars && structure.trend[i] === "bullish" &&
      l[i] <= breakLevel + .25 * a && c[i] > breakLevel && up;
    r.reason[i] = "wait for confirmed SMC sweep/retest";
    if ((!reclaim && !retest) || !green || rs >= p.rsiThreshold || c[i] - f > p.maxExtensionAtr * a) continue;
    const structureLow = reclaim ? sweepLow : Math.min(l[i], breakLevel);
    const candidateRisk = Math.max(p.stopAtr * a, c[i] - structureLow + .15 * a, c[i] * p.minRiskPct / 100);
    const overhead = resistance !== null && resistance > c[i] ? resistance - c[i] - .1 * a : Infinity;
    const reward = Math.min(p.targetAtr * a, overhead), cost = c[i] * p.costPct / 100;
    const netRR = (reward - cost) / (candidateRisk + cost);
    r.netRewardRisk[i] = netRR;
    if (reward <= 0 || (reward - cost) / c[i] * 100 < p.minNetProfitPct || netRR < p.minNetRewardRisk) {
      r.reason[i] = "target room insufficient after estimated costs"; continue;
    }
    entry = i; entryPrice = peak = c[i]; entryATR = a; risk = candidateRisk;
    stop = c[i] - risk; target = c[i] + reward;
    r.signal[i] = "BUY"; r.reason[i] = reclaim ? "SMC liquidity sweep + micro reversal" : "SMC bullish break + retest";
    r.stop[i] = stop; r.target[i] = target; r.initialRisk[i] = risk; r.position[i] = true;
    sweep = breakout = -Infinity;
  }
  return r;
}

// ─── Supertrend ──────────────────────────────────────────────────
// Based on PineScript v4 Supertrend indicator — trend-following
// overlay using ATR bands that flip on trend change.

export interface SupertrendResult {
  supertrend: (number | null)[];  // supertrend line value
  trend: (1 | -1 | null)[];      // 1 = uptrend, -1 = downtrend
  upperBand: (number | null)[];   // upper ATR band (dn line)
  lowerBand: (number | null)[];   // lower ATR band (up line)
  signal: ("BUY" | "SELL" | null)[];
}

export function supertrend(
  klines: KlineData[],
  atrPeriod = 10,
  multiplier = 3.0,
): SupertrendResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const len = klines.length;

  // ATR calculation (true ATR with EMA-style smoothing)
  const tr: number[] = [];
  for (let i = 0; i < len; i++) {
    if (i === 0) { tr.push(h[i] - l[i]); continue; }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }

  const atrArr: (number | null)[] = [];
  let atrPrev: number | null = null;
  for (let i = 0; i < len; i++) {
    if (i < atrPeriod - 1) { atrArr.push(null); continue; }
    if (atrPrev === null) {
      let sum = 0;
      for (let j = i - atrPeriod + 1; j <= i; j++) sum += tr[j];
      atrPrev = sum / atrPeriod;
    } else {
      atrPrev = (atrPrev * (atrPeriod - 1) + tr[i]) / atrPeriod;
    }
    atrArr.push(atrPrev);
  }

  // Supertrend calculation
  // src = hl2 = (high + low) / 2
  // up = src - (Multiplier * atr)    → lower band (support in uptrend)
  // dn = src + (Multiplier * atr)    → upper band (resistance in downtrend)
  const supertrendArr: (number | null)[] = new Array(len).fill(null);
  const trendArr: (1 | -1 | null)[] = new Array(len).fill(null);
  const upperBand: (number | null)[] = new Array(len).fill(null);
  const lowerBand: (number | null)[] = new Array(len).fill(null);
  const signalArr: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let prevUp = 0;
  let prevDn = Infinity;
  let prevTrend: 1 | -1 = 1;

  for (let i = 0; i < len; i++) {
    const a = atrArr[i];
    if (a === null) continue;

    const src = (h[i] + l[i]) / 2;
    let up = src - multiplier * a;
    let dn = src + multiplier * a;

    // Adjust bands: up can only go up, dn can only go down (like PineScript)
    // up := close[1] > up1 ? max(up, up1) : up
    if (i > 0 && c[i - 1] > prevUp) {
      up = Math.max(up, prevUp);
    }
    // dn := close[1] < dn1 ? min(dn, dn1) : dn
    if (i > 0 && c[i - 1] < prevDn) {
      dn = Math.min(dn, prevDn);
    }

    // Trend determination
    // trend := trend == -1 and close > dn1 ? 1 : trend == 1 and close < up1 ? -1 : trend
    let trend: 1 | -1 = prevTrend;
    if (prevTrend === -1 && c[i] > prevDn) {
      trend = 1;
    } else if (prevTrend === 1 && c[i] < prevUp) {
      trend = -1;
    }

    lowerBand[i] = up;
    upperBand[i] = dn;
    trendArr[i] = trend;
    supertrendArr[i] = trend === 1 ? up : dn;

    // Buy/Sell signals: trend change
    if (trend === 1 && prevTrend === -1) {
      signalArr[i] = "BUY";
    } else if (trend === -1 && prevTrend === 1) {
      signalArr[i] = "SELL";
    }

    prevUp = up;
    prevDn = dn;
    prevTrend = trend;
  }

  return {
    supertrend: supertrendArr,
    trend: trendArr,
    upperBand,
    lowerBand,
    signal: signalArr,
  };
}

// ─── Squeeze Momentum Indicator [LazyBear] ─────────────────────
// Bollinger Bands squeeze on Keltner Channels — momentum histogram
// with 4-color logic + squeeze on/off detection.

export type SqzMomColor = "lime" | "green" | "red" | "maroon";

export interface SqueezeMomentumResult {
  value: (number | null)[];               // momentum histogram value
  histColor: (SqzMomColor | null)[];      // lime/green/red/maroon
  sqzOn: boolean[];                       // squeeze is active (BB inside KC)
  sqzOff: boolean[];                      // squeeze released (BB outside KC)
  noSqz: boolean[];                       // no squeeze
  signal: ("BUY" | "SELL" | null)[];      // trading signals
}

/**
 * Standard deviation helper (population stdev matching PineScript stdev())
 */
function stdev(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (data[j] - mean) ** 2;
    result.push(Math.sqrt(sqSum / period));
  }
  return result;
}

/**
 * Highest high over lookback period
 */
function highest(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (data[j] > max) max = data[j];
    result.push(max);
  }
  return result;
}

/**
 * Lowest low over lookback period
 */
function lowest(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (data[j] < min) min = data[j];
    result.push(min);
  }
  return result;
}

/**
 * Linear regression value (like PineScript linreg(source, length, offset))
 */
function linreg(data: number[], period: number, offset: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    const end = i - offset;
    const start = end - period + 1;
    if (start < 0 || end < 0 || end >= data.length) { result.push(null); continue; }
    // Linear regression: y = a + b*x, return value at x = period-1
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      const x = j;
      const y = data[start + j];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const n = period;
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) { result.push(null); continue; }
    const b = (n * sumXY - sumX * sumY) / denom;
    const a = (sumY - b * sumX) / n;
    result.push(a + b * (period - 1 - offset));
  }
  return result;
}

export function squeezeMomentum(
  klines: KlineData[],
  bbLength = 20,
  bbMult = 2.0,
  kcLength = 20,
  kcMult = 1.5,
): SqueezeMomentumResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const len = klines.length;

  // True Range for KC
  const tr: number[] = [];
  for (let i = 0; i < len; i++) {
    if (i === 0) { tr.push(h[i] - l[i]); continue; }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }

  // BB: basis = SMA(close, length), dev = mult * stdev(close, length)
  const basis = sma(c, bbLength);
  const dev = stdev(c, bbLength);

  // KC: ma = SMA(close, kcLength), rangema = SMA(TR, kcLength)
  const kcMa = sma(c, kcLength);
  const rangema = sma(tr, kcLength);

  // Squeeze detection + momentum value
  const value: (number | null)[] = [];
  const histColor: (SqzMomColor | null)[] = [];
  const sqzOn: boolean[] = [];
  const sqzOff: boolean[] = [];
  const noSqz: boolean[] = [];
  const signal: ("BUY" | "SELL" | null)[] = [];

  // Precompute highest/lowest/SMA for momentum calculation
  const highestHigh = highest(h, kcLength);
  const lowestLow = lowest(l, kcLength);

  // Momentum source: close - avg(avg(highest(high,KC), lowest(low,KC)), sma(close,KC))
  const momSource: number[] = [];
  for (let i = 0; i < len; i++) {
    const hh = highestHigh[i];
    const ll = lowestLow[i];
    const ma = kcMa[i];
    if (hh === null || ll === null || ma === null) {
      momSource.push(c[i]); // fallback
    } else {
      momSource.push(c[i] - ((hh + ll) / 2 + ma) / 2);
    }
  }

  // linreg(momSource, kcLength, 0)
  const valArr = linreg(momSource, kcLength, 0);

  for (let i = 0; i < len; i++) {
    const b = basis[i];
    const d = dev[i];
    const km = kcMa[i];
    const rm = rangema[i];

    if (b === null || d === null || km === null || rm === null) {
      value.push(null);
      histColor.push(null);
      sqzOn.push(false);
      sqzOff.push(false);
      noSqz.push(true);
      signal.push(null);
      continue;
    }

    const upperBB = b + bbMult * d;
    const lowerBB = b - bbMult * d;
    const upperKC = km + kcMult * rm;
    const lowerKC = km - kcMult * rm;

    const isOn = lowerBB > lowerKC && upperBB < upperKC;
    const isOff = lowerBB < lowerKC && upperBB > upperKC;
    sqzOn.push(isOn);
    sqzOff.push(isOff);
    noSqz.push(!isOn && !isOff);

    const val = valArr[i];
    value.push(val);

    // 4-color: lime = up & positive, green = down & positive, red = down & negative, maroon = up & negative
    if (val !== null) {
      const prevVal = i > 0 ? valArr[i - 1] : null;
      if (prevVal !== null) {
        if (val > 0) {
          histColor.push(val > prevVal ? "lime" : "green");
        } else {
          histColor.push(val < prevVal ? "red" : "maroon");
        }
      } else {
        histColor.push(val > 0 ? "lime" : "red");
      }
    } else {
      histColor.push(null);
    }

    // Signal: momentum crosses zero + squeeze release
    // BUY: val crosses above 0 (or squeeze off + positive momentum increasing)
    // SELL: val crosses below 0 (or squeeze off + negative momentum increasing)
    if (val !== null && i > 0) {
      const prevVal2 = valArr[i - 1];
      if (prevVal2 !== null) {
        if (prevVal2 <= 0 && val > 0) signal.push("BUY");
        else if (prevVal2 >= 0 && val < 0) signal.push("SELL");
        else signal.push(null);
      } else {
        signal.push(null);
      }
    } else {
      signal.push(null);
    }
  }

  return { value, histColor, sqzOn, sqzOff, noSqz, signal };
}

// ─── Market Structure Break & Order Block (MSB-OB) ─────────────
// ZigZag-based market structure detection with Order Blocks and
// Breaker Blocks. Converted from EmreKb PineScript v5.

export interface MSBOrderBlock {
  startIndex: number;
  high: number;
  low: number;
  type: "Bu-OB" | "Be-OB" | "Bu-BB" | "Be-BB" | "Bu-MB" | "Be-MB";
  broken: boolean;
}

export interface MSBSwingPoint {
  index: number;
  price: number;
  type: "high" | "low";
}

export interface MSBResult {
  trend: (1 | -1 | null)[];          // zigzag trend
  market: (1 | -1 | null)[];         // market structure (1=bull, -1=bear)
  msbSignals: { index: number; bias: "bullish" | "bearish"; level: number }[];
  orderBlocks: MSBOrderBlock[];
  swingPoints: MSBSwingPoint[];       // zigzag swing points for drawing
  signal: ("BUY" | "SELL" | null)[];
}

export function msbOrderBlock(
  klines: KlineData[],
  zigzagLen = 9,
  fibFactor = 0.33,
): MSBResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const o = klines.map(k => +k.open);
  const len = klines.length;

  // ZigZag trend detection
  const highestArr = highest(h, zigzagLen);
  const lowestArr = lowest(l, zigzagLen);

  const trend: (1 | -1 | null)[] = new Array(len).fill(null);
  const market: (1 | -1 | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);
  const msbSignals: MSBResult["msbSignals"] = [];
  const orderBlocks: MSBOrderBlock[] = [];
  const swingPoints: MSBSwingPoint[] = [];

  // Track swing points
  const highPoints: { price: number; index: number }[] = [];
  const lowPoints: { price: number; index: number }[] = [];

  let curTrend: 1 | -1 = 1;
  let curMarket: 1 | -1 = 1;

  for (let i = zigzagLen; i < len; i++) {
    const toUp = h[i] >= (highestArr[i] ?? 0);
    const toDown = l[i] <= (lowestArr[i] ?? Infinity);

    const prevTrend: 1 | -1 = curTrend;
    if (curTrend === 1 && toDown) curTrend = -1;
    else if (curTrend === -1 && toUp) curTrend = 1;
    trend[i] = curTrend;

    // Record swing points on trend change
    if (curTrend !== prevTrend) {
      if (curTrend === 1) {
        // Find lowest low since last trend change
        let minVal = Infinity, minIdx = i;
        for (let j = Math.max(0, i - zigzagLen * 2); j <= i; j++) {
          if (l[j] < minVal) { minVal = l[j]; minIdx = j; }
        }
        lowPoints.push({ price: minVal, index: minIdx });
        swingPoints.push({ index: minIdx, price: minVal, type: "low" });
      } else {
        let maxVal = -Infinity, maxIdx = i;
        for (let j = Math.max(0, i - zigzagLen * 2); j <= i; j++) {
          if (h[j] > maxVal) { maxVal = h[j]; maxIdx = j; }
        }
        highPoints.push({ price: maxVal, index: maxIdx });
        swingPoints.push({ index: maxIdx, price: maxVal, type: "high" });
      }

      // Check for MSB (market structure break)
      if (highPoints.length >= 2 && lowPoints.length >= 1) {
        const h0 = highPoints[highPoints.length - 1];
        const h1 = highPoints.length >= 2 ? highPoints[highPoints.length - 2] : null;
        const l0 = lowPoints[lowPoints.length - 1];
        const l1 = lowPoints.length >= 2 ? lowPoints[lowPoints.length - 2] : null;

        const prevMarket: 1 | -1 = curMarket;

        // Bullish MSB: new high breaks previous high with fib confirmation
        if (h1 && l0 && curMarket === -1 && h0.price > h1.price &&
            h0.price > h1.price + Math.abs(h1.price - l0.price) * fibFactor) {
          curMarket = 1;
        }
        // Bearish MSB: new low breaks previous low
        if (l1 && h0 && curMarket === 1 && l0.price < l1.price &&
            l0.price < l1.price - Math.abs(h0.price - l1.price) * fibFactor) {
          curMarket = -1;
        }

        if (curMarket !== prevMarket) {
          msbSignals.push({
            index: i,
            bias: curMarket === 1 ? "bullish" : "bearish",
            level: curMarket === 1 ? (h1?.price ?? h0.price) : (l1?.price ?? l0.price),
          });

          // Generate order block
          if (curMarket === 1 && h1) {
            // Bullish OB: last bearish candle between h1 and l0
            for (let j = h1.index; j <= l0.index; j++) {
              if (o[j] > c[j]) {
                orderBlocks.push({ startIndex: j, high: h[j], low: l[j], type: "Bu-OB", broken: false });
                break;
              }
            }
          } else if (curMarket === -1 && l1) {
            // Bearish OB: last bullish candle between l1 and h0
            for (let j = l1.index; j <= h0.index; j++) {
              if (o[j] < c[j]) {
                orderBlocks.push({ startIndex: j, high: h[j], low: l[j], type: "Be-OB", broken: false });
                break;
              }
            }
          }

          signal[i] = curMarket === 1 ? "BUY" : "SELL";
        }
      }
    }

    market[i] = curMarket;
  }

  const minClose = new PriceSearch(c, "min"), maxClose = new PriceSearch(c, "max");
  for (const ob of orderBlocks) {
    ob.broken = ob.type.startsWith("Bu") ? minClose.first(ob.startIndex + 1, ob.low, true) >= 0 : maxClose.first(ob.startIndex + 1, ob.high, true) >= 0;
  }

  return { trend, market, msbSignals, orderBlocks, swingPoints, signal };
}

// ─── Support and Resistance Levels with Breaks [LuxAlgo] ───────
// Pivot-based S/R detection with volume-confirmed breakouts.

export interface SupportResistanceResult {
  resistance: (number | null)[];    // resistance level at each bar
  support: (number | null)[];       // support level at each bar
  breakUp: boolean[];               // resistance break with volume
  breakDown: boolean[];             // support break with volume
  bullWick: boolean[];              // bull wick break
  bearWick: boolean[];              // bear wick break
  signal: ("BUY" | "SELL" | null)[];
}

export function supportResistance(
  klines: KlineData[],
  leftBars = 15,
  rightBars = 15,
  volumeThresh = 20,
  confirmed = true,
): SupportResistanceResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const o = klines.map(k => +k.open);
  const v = volumes(klines);
  const len = klines.length;

  // Pivot detection — confirmed=true: level โผล่ที่แท่ง i + rightBars (ตรง Pine fixnan(pivothigh()))
  const pv = pivotEvents(h, l, leftBars, rightBars, confirmed);
  const pivotHighs = pv.highPrice;
  const pivotLows = pv.lowPrice;

  // fixnan — carry forward last non-null pivot
  const resistance: (number | null)[] = new Array(len).fill(null);
  const support: (number | null)[] = new Array(len).fill(null);
  let lastPivotHigh: number | null = null;
  let lastPivotLow: number | null = null;

  for (let i = 0; i < len; i++) {
    if (pivotHighs[i] !== null) lastPivotHigh = pivotHighs[i];
    if (pivotLows[i] !== null) lastPivotLow = pivotLows[i];
    resistance[i] = lastPivotHigh;
    support[i] = lastPivotLow;
  }

  // Volume oscillator: 100 * (EMA5 - EMA10) / EMA10
  const volShort = ema(v, 5);
  const volLong = ema(v, 10);
  const volOsc: (number | null)[] = volShort.map((s, i) => {
    const lg = volLong[i];
    return s !== null && lg !== null && lg !== 0 ? 100 * (s - lg) / lg : null;
  });

  const breakUp: boolean[] = new Array(len).fill(false);
  const breakDown: boolean[] = new Array(len).fill(false);
  const bullWick: boolean[] = new Array(len).fill(false);
  const bearWick: boolean[] = new Array(len).fill(false);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  for (let i = 1; i < len; i++) {
    const res = resistance[i];
    const sup = support[i];
    const osc = volOsc[i] ?? 0;

    // Break down (support break)
    if (sup !== null && c[i - 1] >= sup && c[i] < sup) {
      const isBearWick = (o[i] - c[i]) < (h[i] - o[i]);
      if (isBearWick) {
        bearWick[i] = true;
      }
      if (!isBearWick && osc > volumeThresh) {
        breakDown[i] = true;
        signal[i] = "SELL";
      }
    }

    // Break up (resistance break)
    if (res !== null && c[i - 1] <= res && c[i] > res) {
      const isBullWick = (o[i] - l[i]) > (c[i] - o[i]);
      if (isBullWick) {
        bullWick[i] = true;
      }
      if (!isBullWick && osc > volumeThresh) {
        breakUp[i] = true;
        signal[i] = "BUY";
      }
    }
  }

  return { resistance, support, breakUp, breakDown, bullWick, bearWick, signal };
}

// ─── Trendlines with Breaks [LuxAlgo] ──────────────────────────
// Pivot-based dynamic trendlines with slope from ATR/Stdev.

export interface TrendlinesResult {
  upper: (number | null)[];       // down-trendline (resistance)
  lower: (number | null)[];       // up-trendline (support)
  breakUp: boolean[];             // price breaks above upper trendline
  breakDown: boolean[];           // price breaks below lower trendline
  signal: ("BUY" | "SELL" | null)[];
}

export function trendlinesWithBreaks(
  klines: KlineData[],
  length = 14,
  mult = 1.0,
  calcMethod: "Atr" | "Stdev" = "Atr",
  confirmed = true,
): TrendlinesResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const len = klines.length;

  // Pivot detection — confirmed=true: เส้นเริ่มที่แท่งยืนยัน i + length ด้วยค่า pivot และ slope ณ แท่งนั้น
  // (ตรง Pine `upper := ph ? ph : upper - slope_ph`; โหมดเดิมเส้นเริ่มที่แท่ง pivot = lookahead)
  const pv = pivotEvents(h, l, length, length, confirmed);
  const pivotHighs = pv.highPrice;
  const pivotLows = pv.lowPrice;

  // Slope calculation
  const atrArr = atr(klines, length);
  const stdevArr = stdev(c, length);

  function getSlope(i: number): number {
    if (calcMethod === "Stdev") {
      return ((stdevArr[i] ?? 0) / length) * mult;
    }
    return ((atrArr[i] ?? 0) / length) * mult;
  }

  // Calculate trendlines
  const upper: (number | null)[] = new Array(len).fill(null);
  const lower: (number | null)[] = new Array(len).fill(null);
  const breakUpArr: boolean[] = new Array(len).fill(false);
  const breakDownArr: boolean[] = new Array(len).fill(false);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let curUpper = 0;
  let curLower = 0;
  let slopePh = 0;
  let slopePl = 0;
  let upos = 0;
  let dnos = 0;

  for (let i = 0; i < len; i++) {
    const slope = getSlope(i);

    if (pivotHighs[i] !== null) {
      curUpper = pivotHighs[i]!;
      slopePh = slope;
      upos = 0;
    } else {
      curUpper = curUpper - slopePh;
    }

    if (pivotLows[i] !== null) {
      curLower = pivotLows[i]!;
      slopePl = slope;
      dnos = 0;
    } else {
      curLower = curLower + slopePl;
    }

    upper[i] = curUpper;
    lower[i] = curLower;

    // Break detection
    const prevUpos = upos;
    const prevDnos = dnos;

    if (pivotHighs[i] !== null) {
      upos = 0;
    } else if (c[i] > curUpper) {
      upos = 1;
    }

    if (pivotLows[i] !== null) {
      dnos = 0;
    } else if (c[i] < curLower) {
      dnos = 1;
    }

    if (upos > prevUpos) {
      breakUpArr[i] = true;
      signal[i] = "BUY";
    }
    if (dnos > prevDnos) {
      breakDownArr[i] = true;
      signal[i] = "SELL";
    }
  }

  return { upper, lower, breakUp: breakUpArr, breakDown: breakDownArr, signal };
}

// ─── UT Bot Alerts ─────────────────────────────────────────────
// ATR trailing stop based trend detection.
// Buy when price crosses above trailing stop, Sell when below.

export interface UTBotResult {
  trailingStop: (number | null)[];
  pos: (1 | -1 | 0)[];             // 1=long, -1=short, 0=neutral
  signal: ("BUY" | "SELL" | null)[];
}

export function utBot(
  klines: KlineData[],
  keyValue = 1,
  atrPeriod = 10,
): UTBotResult {
  const c = closes(klines);
  const len = klines.length;

  const atrArr = atr(klines, atrPeriod);

  const trailingStop: (number | null)[] = new Array(len).fill(null);
  const pos: (1 | -1 | 0)[] = new Array(len).fill(0);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let prevStop = 0;
  let prevPos = 0;

  for (let i = 0; i < len; i++) {
    const xATR = atrArr[i];
    if (xATR === null) continue;

    const nLoss = keyValue * xATR;
    const src = c[i];
    const prevSrc = i > 0 ? c[i - 1] : src;

    // ATR Trailing Stop
    let stop: number;
    if (src > prevStop && prevSrc > prevStop) {
      stop = Math.max(prevStop, src - nLoss);
    } else if (src < prevStop && prevSrc < prevStop) {
      stop = Math.min(prevStop, src + nLoss);
    } else if (src > prevStop) {
      stop = src - nLoss;
    } else {
      stop = src + nLoss;
    }

    trailingStop[i] = stop;

    // Position
    let curPos: 1 | -1 | 0 = 0;
    if (prevSrc < prevStop && src > prevStop) curPos = 1;
    else if (prevSrc > prevStop && src < prevStop) curPos = -1;
    else curPos = prevPos as (1 | -1 | 0);

    pos[i] = curPos;

    // Signal: crossover/crossunder with EMA(src,1) ≈ src
    const above = src > stop && prevSrc <= prevStop;
    const below = src < stop && prevSrc >= prevStop;
    const buy = src > stop && above;
    const sell = src < stop && below;

    if (buy) signal[i] = "BUY";
    else if (sell) signal[i] = "SELL";

    prevStop = stop;
    prevPos = curPos;
  }

  return { trailingStop, pos, signal };
}

// ─── Compute all indicators for klines ─────────────────────────
export interface AllIndicators {
  rsi: (number | null)[];
  atr: (number | null)[];
  obv: number[];
  vwap: number[];
  cdcActionZone: CDCActionZoneResult;
  smc: SMCResult;
  smcAdaptive: SMCAdaptiveResult;
  smcAdaptiveV2: SMCAdaptiveV2Result;
  smcAdaptiveShort: SMCAdaptiveShortResult;
  cmMacd: CMMAcDResult;
  supertrend: SupertrendResult;
  squeezeMomentum: SqueezeMomentumResult;
  msbOb: MSBResult;
  supportResistance: SupportResistanceResult;
  trendlines: TrendlinesResult;
  utBot: UTBotResult;
  /**
   * อินดิเคเตอร์เวอร์ชัน 2 (lib/indicators-v2.ts)
   * คำนวณเฉพาะตัวที่กลยุทธ์ v2 ที่เลือกใช้เท่านั้น ตัวอื่นเป็น undefined
   * จึงไม่กระทบผลลัพธ์ของ v1 และไม่เพิ่มคอลัมน์ให้ freqtrade/scripts/dump-indicators.ts
   */
  smaV2?: SmaV2Result;
  emaV2?: EmaV2Result;
  rsiV2?: RsiV2Result;
  macdV2?: MacdV2Result;
  bollingerV2?: BollingerV2Result;
  atrV2?: AtrV2Result;
  stochasticV2?: StochasticV2Result;
  stochRsiV2?: StochRsiV2Result;
  adxV2?: AdxV2Result;
  ichimokuV2?: IchimokuV2Result;
  supertrendV2?: SupertrendV2Result;
  vwapV2?: VwapV2Result;
  volumeV2?: VolumeV2Result;
  obvV2?: ObvV2Result;
  volumeProfileV2?: VolumeProfileV2Result;
  smcV2?: SmcV2Result;
  squeezeV2?: SqueezeV2Result;
  waveTrendV2?: WaveTrendV2Result;
  utBotV2?: UtBotV2Result;
  lorentzianV2?: LorentzianV2Result;
  /**
   * ผลลัพธ์ของกลยุทธ์ v3 ตัวที่ผู้ใช้เลือก ไม่ว่าจะเป็นตระกูลใด
   * (รูปแบบผลลัพธ์ร่วมกันนิยามไว้ที่ lib/indicators-v3-core.ts)
   * คำนวณเฉพาะเมื่อผู้ใช้เลือกกลยุทธ์ v3 เท่านั้น เช่นเดียวกับ v2
   */
  v3?: V3Result;
}

export function computeAll(klines: KlineData[], overrides?: {
  lazy?: boolean;
  cdcFastPeriod?: number;
  cdcSlowPeriod?: number;
  rsiPeriod?: number;
  smcSwingSize?: number;
  smcInternalSize?: number;
  smcAdaptiveParams?: Partial<SMCAdaptiveParams>;
  smcAdaptiveStartIndex?: number;
  smcAdaptiveV2Params?: Partial<SMCAdaptiveV2Params>;
  smcAdaptiveShortParams?: Partial<SMCAdaptiveShortParams>;
  cmMacdFast?: number;
  cmMacdSlow?: number;
  cmMacdSignal?: number;
  supertrendPeriod?: number;
  supertrendMultiplier?: number;
  sqzMomBBLength?: number;
  sqzMomBBMult?: number;
  sqzMomKCLength?: number;
  sqzMomKCMult?: number;
  msbZigzagLen?: number;
  msbFibFactor?: number;
  srLeftBars?: number;
  srRightBars?: number;
  srVolumeThresh?: number;
  trendLength?: number;
  trendMult?: number;
  trendCalcMethod?: "Atr" | "Stdev";
  utBotKey?: number;
  utBotAtrPeriod?: number;
  /**
   * ยืนยัน pivot ที่แท่ง i + rightBars สำหรับ S/R, Trendlines, SMC (default true = ไม่มี lookahead)
   * false = พฤติกรรม TS เดิม ใช้เฉพาะ harness `--mode ts` ห้ามใช้เทรดหรือ backtest จริง
   */
  confirmedPivots?: boolean;
  /** กลยุทธ์ v2 ที่เลือก — กำหนดว่าจะคำนวณอินดิเคเตอร์ v2 ตัวไหน */
  v2Strategy?: V2StrategyId;
  /** พารามิเตอร์ของกลยุทธ์ v2 ตัวนั้น */
  v2Params?: Record<string, number>;
  /** กลยุทธ์ v3 ที่เลือก (ShortTrade สองทาง) */
  v3Strategy?: V3StrategyId;
  /** พารามิเตอร์ของกลยุทธ์ v3 ตัวนั้น */
  v3Params?: Record<string, number>;
}): AllIndicators {
  const c = closes(klines);
  const confirmed = overrides?.confirmedPivots ?? true;
  const calculations: Record<string, () => unknown> = {
    rsi: () => rsi(c, overrides?.rsiPeriod ?? 14),
    atr: () => atr(klines, 14),
    obv: () => obv(klines),
    vwap: () => vwap(klines),
    cdcActionZone: () => cdcActionZone(c, overrides?.cdcFastPeriod ?? 12, overrides?.cdcSlowPeriod ?? 26, 1),
    smc: () => smartMoneyConcepts(klines, overrides?.smcSwingSize ?? 50, overrides?.smcInternalSize ?? 5, confirmed),
    smcAdaptive: () => smcAdaptive(klines, overrides?.smcAdaptiveParams, overrides?.smcAdaptiveStartIndex),
    smcAdaptiveV2: () => smcAdaptiveV2(klines, overrides?.smcAdaptiveV2Params, overrides?.smcAdaptiveStartIndex),
    smcAdaptiveShort: () => smcAdaptiveShort(klines, overrides?.smcAdaptiveShortParams, overrides?.smcAdaptiveStartIndex),
    cmMacd: () => cmMacdUltMTF(c, overrides?.cmMacdFast ?? 12, overrides?.cmMacdSlow ?? 26, overrides?.cmMacdSignal ?? 9),
    supertrend: () => supertrend(klines, overrides?.supertrendPeriod ?? 10, overrides?.supertrendMultiplier ?? 3.0),
    squeezeMomentum: () => squeezeMomentum(klines, overrides?.sqzMomBBLength ?? 20, overrides?.sqzMomBBMult ?? 2.0, overrides?.sqzMomKCLength ?? 20, overrides?.sqzMomKCMult ?? 1.5),
    msbOb: () => msbOrderBlock(klines, overrides?.msbZigzagLen ?? 9, overrides?.msbFibFactor ?? 0.33),
    supportResistance: () => supportResistance(klines, overrides?.srLeftBars ?? 15, overrides?.srRightBars ?? 15, overrides?.srVolumeThresh ?? 20, confirmed),
    trendlines: () => trendlinesWithBreaks(klines, overrides?.trendLength ?? 14, overrides?.trendMult ?? 1.0, overrides?.trendCalcMethod ?? "Atr", confirmed),
    utBot: () => utBot(klines, overrides?.utBotKey ?? 1, overrides?.utBotAtrPeriod ?? 10),
  };
  // อินดิเคเตอร์ v2 เพิ่มเข้ามาเฉพาะตัวที่กลยุทธ์ที่เลือกต้องใช้
  if (overrides?.v2Strategy) {
    const { def } = resolveV2Strategy(overrides.v2Strategy);
    const v2Params = overrides.v2Params ?? {};
    const v2Start = overrides.smcAdaptiveStartIndex ?? 0;
    calculations[def.key] = () => def.compute(klines, v2Params, v2Start);
  }
  if (overrides?.v3Strategy && isV3StrategyId(overrides.v3Strategy)) {
    const id = overrides.v3Strategy;
    const v3Params = overrides.v3Params ?? {};
    const v3Start = overrides.smcAdaptiveStartIndex ?? 0;
    calculations.v3 = () => computeV3(id, klines, v3Params, v3Start);
  }
  const result = {} as AllIndicators;
  for (const key of Object.keys(calculations)) {
    const calculate = calculations[key];
    if (overrides?.lazy) {
      Object.defineProperty(result, key, { enumerable: true, configurable: true, get() {
        const value = calculate();
        Object.defineProperty(result, key, { enumerable: true, configurable: true, writable: true, value });
        return value;
      }});
    } else Object.defineProperty(result, key, { enumerable: true, configurable: true, writable: true, value: calculate() });
  }
  return result;
}
