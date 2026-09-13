import type { KlineData } from "@/lib/types/kline";

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

/**
 * Detect swing legs — a pivot high occurs when high[size] > highest(size bars after)
 * and pivot low when low[size] < lowest(size bars after).
 */
function detectPivots(
  h: number[], l: number[], size: number
): { pivotHighs: (number | null)[]; pivotLows: (number | null)[] } {
  const len = h.length;
  const pivotHighs: (number | null)[] = new Array(len).fill(null);
  const pivotLows: (number | null)[] = new Array(len).fill(null);

  for (let i = size; i < len - size; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= size; j++) {
      if (h[i] <= h[i - j] || h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i - j] || l[i] >= l[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs[i] = h[i];
    if (isLow) pivotLows[i] = l[i];
  }
  return { pivotHighs, pivotLows };
}

/**
 * Detect market structure (BOS/CHoCH) from pivot points.
 * - BOS: price breaks above a pivot high in an uptrend (or below pivot low in downtrend)
 * - CHoCH: price breaks above a pivot high in a downtrend (trend reversal) or vice versa
 */
function detectStructure(
  c: number[], _h: number[], _l: number[],
  pivotHighs: (number | null)[], pivotLows: (number | null)[],
): { structures: SMCStructureBreak[]; trend: (SMCBias | null)[] } {
  const len = c.length;
  const structures: SMCStructureBreak[] = [];
  const trend: (SMCBias | null)[] = new Array(len).fill(null);

  let currentTrend: SMCBias | null = null;
  let lastPivotHigh: { price: number; index: number; crossed: boolean } | null = null;
  let lastPivotLow: { price: number; index: number; crossed: boolean } | null = null;

  for (let i = 0; i < len; i++) {
    // Update pivots
    if (pivotHighs[i] !== null) {
      lastPivotHigh = { price: pivotHighs[i]!, index: i, crossed: false };
    }
    if (pivotLows[i] !== null) {
      lastPivotLow = { price: pivotLows[i]!, index: i, crossed: false };
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

  // Check mitigation (price returns into the OB)
  for (const ob of orderBlocks) {
    for (let i = ob.startIndex + 1; i < len; i++) {
      if (ob.bias === "bullish" && l[i] <= ob.low) {
        ob.mitigated = true;
        ob.mitigatedIndex = i;
        break;
      }
      if (ob.bias === "bearish" && h[i] >= ob.high) {
        ob.mitigated = true;
        ob.mitigatedIndex = i;
        break;
      }
    }
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
        for (let j = i + 1; j < len; j++) {
          if (l[j] <= fvg.bottom) {
            fvg.filled = true;
            fvg.filledIndex = j;
            break;
          }
        }
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
        for (let j = i + 1; j < len; j++) {
          if (h[j] >= fvg.top) {
            fvg.filled = true;
            fvg.filledIndex = j;
            break;
          }
        }
        fvgs.push(fvg);
      }
    }
  }

  return fvgs;
}

/**
 * Detect swing point labels (HH, HL, LH, LL)
 */
function detectSwingPoints(
  pivotHighs: (number | null)[], pivotLows: (number | null)[],
): SMCSwingPoint[] {
  const points: SMCSwingPoint[] = [];
  let lastHigh: number | null = null;
  let lastLow: number | null = null;

  for (let i = 0; i < pivotHighs.length; i++) {
    if (pivotHighs[i] !== null) {
      const price = pivotHighs[i]!;
      let type: SMCSwingPoint["type"];
      if (lastHigh === null) type = "H";
      else type = price > lastHigh ? "HH" : "LH";
      points.push({ index: i, price, type });
      lastHigh = price;
    }
    if (pivotLows[i] !== null) {
      const price = pivotLows[i]!;
      let type: SMCSwingPoint["type"];
      if (lastLow === null) type = "L";
      else type = price > lastLow ? "HL" : "LL";
      points.push({ index: i, price, type });
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
  pivotHighs: (number | null)[], pivotLows: (number | null)[],
): ("premium" | "discount" | "equilibrium" | null)[] {
  const len = c.length;
  const result: ("premium" | "discount" | "equilibrium" | null)[] = new Array(len).fill(null);

  let trailingHigh = -Infinity;
  let trailingLow = Infinity;

  for (let i = 0; i < len; i++) {
    if (pivotHighs[i] !== null) trailingHigh = pivotHighs[i]!;
    if (pivotLows[i] !== null) trailingLow = pivotLows[i]!;

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
): SMCResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(x => +x.open);
  const len = klines.length;

  // ATR for filtering
  const atrValues = atr(klines, 200);

  // Detect pivots at both swing and internal levels
  const swingPivots = detectPivots(h, l, swingSize);
  const internalPivots = detectPivots(h, l, internalSize);

  // Detect structure
  const swingResult = detectStructure(c, h, l, swingPivots.pivotHighs, swingPivots.pivotLows);
  const internalResult = detectStructure(c, h, l, internalPivots.pivotHighs, internalPivots.pivotLows);

  // Order Blocks
  const swingOBs = detectOrderBlocks(c, o, h, l, swingResult.structures);
  const internalOBs = detectOrderBlocks(c, o, h, l, internalResult.structures);

  // Fair Value Gaps
  const fvgs = detectFairValueGaps(h, l, c, o, atrValues);

  // Swing Points
  const swingPoints = detectSwingPoints(swingPivots.pivotHighs, swingPivots.pivotLows);

  // Premium/Discount
  const premiumDiscount = detectPremiumDiscount(c, h, l, swingPivots.pivotHighs, swingPivots.pivotLows);

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

  // Check OB mitigation
  for (const ob of orderBlocks) {
    for (let i = ob.startIndex + 1; i < len; i++) {
      if (ob.type.startsWith("Bu") && c[i] < ob.low) { ob.broken = true; break; }
      if (ob.type.startsWith("Be") && c[i] > ob.high) { ob.broken = true; break; }
    }
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
): SupportResistanceResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const o = klines.map(k => +k.open);
  const v = volumes(klines);
  const len = klines.length;

  // Pivot detection
  const pivotHighs: (number | null)[] = new Array(len).fill(null);
  const pivotLows: (number | null)[] = new Array(len).fill(null);

  for (let i = leftBars; i < len - rightBars; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= leftBars; j++) {
      if (h[i] <= h[i - j]) isHigh = false;
      if (l[i] >= l[i - j]) isLow = false;
    }
    for (let j = 1; j <= rightBars; j++) {
      if (h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs[i] = h[i];
    if (isLow) pivotLows[i] = l[i];
  }

  // fixnan — carry forward last non-null pivot, shifted by 1
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
): TrendlinesResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const len = klines.length;

  // Pivot detection
  const pivotHighs: (number | null)[] = new Array(len).fill(null);
  const pivotLows: (number | null)[] = new Array(len).fill(null);

  for (let i = length; i < len - length; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= length; j++) {
      if (h[i] <= h[i - j] || h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i - j] || l[i] >= l[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs[i] = h[i];
    if (isLow) pivotLows[i] = l[i];
  }

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
  cmMacd: CMMAcDResult;
  supertrend: SupertrendResult;
  squeezeMomentum: SqueezeMomentumResult;
  msbOb: MSBResult;
  supportResistance: SupportResistanceResult;
  trendlines: TrendlinesResult;
  utBot: UTBotResult;
}

export function computeAll(klines: KlineData[], overrides?: {
  rsiPeriod?: number;
  smcSwingSize?: number;
  smcInternalSize?: number;
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
}): AllIndicators {
  const c = closes(klines);
  return {
    rsi: rsi(c, overrides?.rsiPeriod ?? 14),
    atr: atr(klines, 14),
    obv: obv(klines),
    vwap: vwap(klines),
    cdcActionZone: cdcActionZone(c, 12, 26, 1),
    smc: smartMoneyConcepts(klines, overrides?.smcSwingSize ?? 50, overrides?.smcInternalSize ?? 5),
    cmMacd: cmMacdUltMTF(c, overrides?.cmMacdFast ?? 12, overrides?.cmMacdSlow ?? 26, overrides?.cmMacdSignal ?? 9),
    supertrend: supertrend(klines, overrides?.supertrendPeriod ?? 10, overrides?.supertrendMultiplier ?? 3.0),
    squeezeMomentum: squeezeMomentum(klines, overrides?.sqzMomBBLength ?? 20, overrides?.sqzMomBBMult ?? 2.0, overrides?.sqzMomKCLength ?? 20, overrides?.sqzMomKCMult ?? 1.5),
    msbOb: msbOrderBlock(klines, overrides?.msbZigzagLen ?? 9, overrides?.msbFibFactor ?? 0.33),
    supportResistance: supportResistance(klines, overrides?.srLeftBars ?? 15, overrides?.srRightBars ?? 15, overrides?.srVolumeThresh ?? 20),
    trendlines: trendlinesWithBreaks(klines, overrides?.trendLength ?? 14, overrides?.trendMult ?? 1.0, overrides?.trendCalcMethod ?? "Atr"),
    utBot: utBot(klines, overrides?.utBotKey ?? 1, overrides?.utBotAtrPeriod ?? 10),
  };
}
