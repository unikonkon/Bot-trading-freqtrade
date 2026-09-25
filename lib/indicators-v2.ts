/**
 * indicators-v2.ts — อินดิเคเตอร์ยอดนิยมบน TradingView 20 รายการ เขียนใหม่เป็นเวอร์ชัน 2
 * ต้นแบบโครงสร้าง: lib/indicators.ts (v1)
 * ที่มาของสูตรและการอ่านค่า: tradingview-popular-indicators-th.md
 *
 * หลักการที่ยึดทั้งไฟล์
 * ──────────────────────────────────────────────────────────────────────────
 * 1) ทุกค่าอิงข้อมูล "ณ ปิดแท่ง" เท่านั้น ห้ามอ่านข้อมูลแท่งอนาคต (no lookahead)
 *    อินดิเคเตอร์ที่ต้องใช้ pivot จะยืนยันที่แท่ง i+rightBars เสมอ
 *    ส่วน Ichimoku ใช้ค่า Senkou ที่คำนวณจากแท่ง t-displacement ซึ่งรู้ค่าแล้วจริง
 * 2) ช่วงอุ่นเครื่อง (warm-up) คืน null ไม่ใช่ 0 เพื่อไม่ให้สัญญาณหลอกตอนต้นชุดข้อมูล
 * 3) ทุกอินดิเคเตอร์คืนสัญญาณ 2 ชุดเสมอ
 *      signal          = กฎพื้นฐานตรงตามตำรา/เอกสารต้นทาง ใช้วัดว่าอินดิเคเตอร์ตัวนั้นดีจริงไหม
 *      signalFiltered  = กฎเดิม + ชุดตัวกรองร่วม (เทรนด์/ADX/ความผันผวน) + ATR stop/trailing/เวลาถือ
 *    ทำให้เทียบได้ว่า "ตัวกรองช่วยหรือทำลายสัญญาณดิบ" บนข้อมูลชุดเดียวกัน
 * 4) เอนจิน backtest ของโปรเจกต์นี้เป็น Spot ทางเดียว (long-only)
 *    BUY = เข้าซื้อ, SELL = ปิดสถานะ ไม่ใช่การเปิด Short
 * 5) สัญญาณทุกตัวเป็น "สัญญาณ ณ ปิดแท่ง" เอนจินจะไปเปิด/ปิดที่ราคาเปิดแท่งถัดไป
 *    ค่า stop/target ในไฟล์นี้จึงเป็นเงื่อนไขเทียบ "ราคาปิด" ไม่ใช่คำสั่ง stop ระหว่างแท่ง
 */
import type { KlineData } from "@/lib/types/kline";

// ─── ชนิดข้อมูลร่วม ─────────────────────────────────────────────
export type V2Signal = "BUY" | "SELL" | null;
export type Series = (number | null)[];

/** เหตุผลของสัญญาณรายแท่ง ใช้ตรวจสอบย้อนหลังว่าทำไมเข้า/ไม่เข้า */
export type ReasonSeries = (string | null)[];

// ─── ตัวช่วยดึงคอลัมน์ราคา ──────────────────────────────────────
export function opens(k: KlineData[]): number[] { return k.map(x => +x.open); }
export function highs(k: KlineData[]): number[] { return k.map(x => +x.high); }
export function lows(k: KlineData[]): number[] { return k.map(x => +x.low); }
export function closes(k: KlineData[]): number[] { return k.map(x => +x.close); }
export function volumes(k: KlineData[]): number[] { return k.map(x => +x.volume); }
export function hl2(k: KlineData[]): number[] { return k.map(x => (+x.high + +x.low) / 2); }
export function hlc3(k: KlineData[]): number[] { return k.map(x => (+x.high + +x.low + +x.close) / 3); }
export function ohlc4(k: KlineData[]): number[] {
  return k.map(x => (+x.open + +x.high + +x.low + +x.close) / 4);
}

// ─── ค่าเฉลี่ยพื้นฐาน ────────────────────────────────────────────

/** SMA — ค่าเฉลี่ยธรรมดา ให้น้ำหนักทุกแท่งเท่ากัน */
export function sma(data: Series, period: number): Series {
  const out: Series = new Array(data.length).fill(null);
  let sum = 0, count = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v !== null) { sum += v; count++; }
    const drop = i - period;
    if (drop >= 0) {
      const d = data[drop];
      if (d !== null) { sum -= d; count--; }
    }
    if (i >= period - 1 && count === period) out[i] = sum / period;
  }
  return out;
}

/**
 * EMA — alpha = 2/(n+1) ตั้งต้นด้วย SMA ของ n แท่งแรกที่มีค่า
 * ตรงกับ ta.ema ของ Pine Script หลังพ้นช่วง warm-up
 */
export function ema(data: Series, period: number): Series {
  const out: Series = new Array(data.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev: number | null = null, seed = 0, seen = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === null) continue;
    if (prev === null) {
      seed += v; seen++;
      if (seen === period) { prev = seed / period; out[i] = prev; }
      continue;
    }
    prev = v * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

/**
 * RMA — ค่าเฉลี่ยแบบ Wilder ให้น้ำหนักข้อมูลใหม่ 1/n ตั้งต้นด้วย SMA
 * ใช้ใน RSI, ATR และ ADX/DMI ตามค่าเริ่มต้นของ TradingView
 */
export function rma(data: Series, period: number): Series {
  const out: Series = new Array(data.length).fill(null);
  let prev: number | null = null, seed = 0, seen = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === null) continue;
    if (prev === null) {
      seed += v; seen++;
      if (seen === period) { prev = seed / period; out[i] = prev; }
      continue;
    }
    prev = (prev * (period - 1) + v) / period;
    out[i] = prev;
  }
  return out;
}

/** WMA — ถ่วงน้ำหนักเชิงเส้น ใช้ใน Volume Profile/ตัวช่วยบางตัว */
export function wma(data: Series, period: number): Series {
  const out: Series = new Array(data.length).fill(null);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0, ok = true;
    for (let j = 0; j < period; j++) {
      const v = data[i - period + 1 + j];
      if (v === null) { ok = false; break; }
      sum += v * (j + 1);
    }
    if (ok) out[i] = sum / denom;
  }
  return out;
}

/** ส่วนเบี่ยงเบนมาตรฐานแบบประชากร ตรงกับ ta.stdev ของ Pine */
export function stdev(data: Series, period: number): Series {
  const out: Series = new Array(data.length).fill(null);
  const mean = sma(data, period);
  for (let i = period - 1; i < data.length; i++) {
    const m = mean[i];
    if (m === null) continue;
    let sum = 0, ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      const v = data[j];
      if (v === null) { ok = false; break; }
      sum += (v - m) ** 2;
    }
    if (ok) out[i] = Math.sqrt(sum / period);
  }
  return out;
}

/** ค่าสูงสุดย้อนหลัง n แท่ง (รวมแท่งปัจจุบัน) */
export function highest(data: Series, period: number): Series {
  const out: Series = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let best = -Infinity, ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      const v = data[j];
      if (v === null) { ok = false; break; }
      if (v > best) best = v;
    }
    if (ok) out[i] = best;
  }
  return out;
}

/** ค่าต่ำสุดย้อนหลัง n แท่ง (รวมแท่งปัจจุบัน) */
export function lowest(data: Series, period: number): Series {
  const out: Series = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let best = Infinity, ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      const v = data[j];
      if (v === null) { ok = false; break; }
      if (v < best) best = v;
    }
    if (ok) out[i] = best;
  }
  return out;
}

/** Linear regression value ที่ offset จากปลายหน้าต่าง ตรงกับ ta.linreg */
export function linreg(data: Series, period: number, offset = 0): Series {
  const out: Series = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, ok = true;
    for (let j = 0; j < period; j++) {
      const v = data[i - period + 1 + j];
      if (v === null) { ok = false; break; }
      const x = j;
      sumX += x; sumY += v; sumXY += x * v; sumX2 += x * x;
    }
    if (!ok) continue;
    const denom = period * sumX2 - sumX * sumX;
    if (denom === 0) continue;
    const slope = (period * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / period;
    out[i] = intercept + slope * (period - 1 - offset);
  }
  return out;
}

/** True Range รายแท่ง แท่งแรกใช้ High-Low ตามธรรมเนียม TradingView */
export function trueRange(k: KlineData[]): number[] {
  const h = highs(k), l = lows(k), c = closes(k);
  return k.map((_, i) =>
    i === 0 ? h[i] - l[i]
      : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
}

/** ATR ตามค่าเริ่มต้นของ TradingView (RMA ของ True Range) */
export function atr(k: KlineData[], period = 14): Series {
  return rma(trueRange(k), period);
}

/** a ตัดขึ้นเหนือ b ที่แท่ง i (ต้องมีค่าครบทั้งสองแท่ง) */
export function crossOver(a: Series, b: Series, i: number): boolean {
  if (i < 1) return false;
  const a0 = a[i], a1 = a[i - 1], b0 = b[i], b1 = b[i - 1];
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
  return a1 <= b1 && a0 > b0;
}

/** a ตัดลงใต้ b ที่แท่ง i */
export function crossUnder(a: Series, b: Series, i: number): boolean {
  if (i < 1) return false;
  const a0 = a[i], a1 = a[i - 1], b0 = b[i], b1 = b[i - 1];
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
  return a1 >= b1 && a0 < b0;
}

/** สร้าง series คงที่เพื่อใช้กับ crossOver/crossUnder */
export function constant(length: number, value: number): Series {
  return new Array(length).fill(value);
}

/** แปลงสเกลจากช่วงเดิมไปช่วงใหม่ (ใช้กับ Lorentzian) */
export function rescale(v: number, oldMin: number, oldMax: number, newMin: number, newMax: number): number {
  return newMin + ((newMax - newMin) * (v - oldMin)) / Math.max(oldMax - oldMin, 1e-10);
}

/** ปรับสเกลด้วยค่าสูงสุด/ต่ำสุดสะสมตั้งแต่ต้นชุดข้อมูล (running min/max ไม่มี lookahead) */
export function normalizeRunning(data: Series, min = 0, max = 1): Series {
  const out: Series = new Array(data.length).fill(null);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === null) continue;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    out[i] = min + ((max - min) * (v - lo)) / Math.max(hi - lo, 1e-10);
  }
  return out;
}

// ─── Pivot ที่ยืนยันแล้ว ────────────────────────────────────────
export interface ConfirmedPivot {
  /** แท่งที่เป็นจุดกลับตัวจริง */
  index: number;
  /** แท่งที่เพิ่งรู้ว่ามันเป็น pivot = index + rightBars (แท่งที่ใช้ตัดสินใจได้) */
  confirmedAt: number;
  price: number;
}

/**
 * หา pivot high/low แบบยืนยันแล้ว
 * pivot ที่แท่ง i จะ "ใช้ได้" ตั้งแต่แท่ง i+right เป็นต้นไปเท่านั้น
 * จึงไม่มีการมองอนาคตเหมือนการวาดย้อนหลังบนกราฟ
 */
export function findPivots(k: KlineData[], left: number, right: number) {
  const h = highs(k), l = lows(k);
  const pivotHighs: ConfirmedPivot[] = [];
  const pivotLows: ConfirmedPivot[] = [];
  for (let i = left; i < k.length - right; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (h[j] >= h[i]) isHigh = false;
      if (l[j] <= l[i]) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivotHighs.push({ index: i, confirmedAt: i + right, price: h[i] });
    if (isLow) pivotLows.push({ index: i, confirmedAt: i + right, price: l[i] });
  }
  return { pivotHighs, pivotLows };
}

/**
 * กาง pivot ที่ยืนยันแล้วออกเป็น series รายแท่ง
 * ค่าที่แท่ง t = ราคาของ pivot ล่าสุดที่ "ยืนยันแล้ว ณ แท่ง t"
 */
export function carryPivot(length: number, pivots: ConfirmedPivot[]): Series {
  const out: Series = new Array(length).fill(null);
  let cursor = 0, current: number | null = null;
  for (let i = 0; i < length; i++) {
    while (cursor < pivots.length && pivots[cursor].confirmedAt <= i) {
      current = pivots[cursor].price;
      cursor++;
    }
    out[i] = current;
  }
  return out;
}

// ─── DMI/ADX ใช้ร่วมกันหลายที่ ───────────────────────────────────
export interface DmiResult {
  plusDI: Series;
  minusDI: Series;
  adx: Series;
}

/**
 * Directional Movement Index ตามสูตร Wilder
 *   UpMove = H(t) − H(t−1); DownMove = L(t−1) − L(t)
 *   +DM นับเมื่อ UpMove > DownMove และ UpMove > 0 (นอกนั้น 0) — กลับกันสำหรับ −DM
 *   +DI = 100 × RMA(+DM,n) / RMA(TR,n);  DX = 100 × |+DI − −DI| / (+DI + −DI)
 *   ADX = RMA(DX, adxPeriod)
 */
export function dmi(k: KlineData[], diPeriod = 14, adxPeriod = 14): DmiResult {
  const h = highs(k), l = lows(k);
  const plusDM: Series = new Array(k.length).fill(null);
  const minusDM: Series = new Array(k.length).fill(null);
  for (let i = 1; i < k.length; i++) {
    const up = h[i] - h[i - 1];
    const down = l[i - 1] - l[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  const tr: Series = trueRange(k).slice();
  tr[0] = null; // แท่งแรกไม่มี TR เทียบแท่งก่อน จึงไม่นำเข้าค่าเฉลี่ย
  const trR = rma(tr, diPeriod);
  const plusR = rma(plusDM, diPeriod);
  const minusR = rma(minusDM, diPeriod);
  const plusDI: Series = new Array(k.length).fill(null);
  const minusDI: Series = new Array(k.length).fill(null);
  const dx: Series = new Array(k.length).fill(null);
  for (let i = 0; i < k.length; i++) {
    const t = trR[i], p = plusR[i], m = minusR[i];
    if (t === null || p === null || m === null || t === 0) continue;
    const pdi = (100 * p) / t;
    const mdi = (100 * m) / t;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    const sum = pdi + mdi;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum;
  }
  return { plusDI, minusDI, adx: rma(dx, adxPeriod) };
}

// ─── กรอบตัวกรองร่วมของทุกกลยุทธ์ *_filtered ────────────────────
/**
 * ทำไมต้องมีชุดนี้
 * ──────────────────────────────────────────────────────────────
 * เอกสารต้นทางย้ำซ้ำ ๆ ว่าอินดิเคเตอร์เดี่ยวมีจุดอ่อนคนละแบบ
 *   • ออสซิลเลเตอร์ (RSI/Stoch/StochRSI/WaveTrend) ค้างในเขตสุดขั้วได้นานเมื่อเทรนด์แรง
 *   • ตัวตามเทรนด์ (MA/Supertrend/UT Bot) สลับทิศถี่ตอนราคาออกข้าง
 *   • ตัววัดความผันผวน (ATR/BB/Squeeze) ไม่บอกทิศทาง
 * ตัวกรองชุดนี้จึงเติมสิ่งที่อินดิเคเตอร์เดี่ยว "ไม่มี" ให้ครบสามด้านเสมอ คือ
 *   ทิศทาง (EMA เทรนด์) + ความมีเทรนด์จริง (ADX/DI) + สภาพความผันผวน (ATR ratio)
 * แล้วปิดท้ายด้วยการบริหารการออก (ATR stop / trailing / เวลาถือสูงสุด)
 * ซึ่งสัญญาณดิบส่วนใหญ่ไม่มีให้
 *
 * ข้อควรรู้: ตัวกรองลดจำนวนสัญญาณเสมอ ไม่รับประกันว่ากำไรดีขึ้น
 * จุดประสงค์คือให้เทียบ signal กับ signalFiltered บนข้อมูลเดียวกันได้ตรง ๆ
 */
export const TRADE_FILTER_DEFAULTS = {
  /** EMA กรองทิศทางหลัก ต้องปิดเหนือเส้นนี้จึงเข้าซื้อได้ */
  filterTrendLength: 100,
  /** EMA เทรนด์ต้องสูงกว่าเมื่อ n แท่งก่อน (ความชันเป็นบวก) */
  filterSlopeBars: 5,
  /** ช่วงคำนวณ ADX/DI */
  filterAdxLength: 14,
  /** ADX ขั้นต่ำที่ถือว่ามีเทรนด์จริง เอกสารใช้ราว 25 / ต่ำกว่า 20 ถือว่าอ่อน */
  filterAdxThreshold: 18,
  /** ช่วง ATR สำหรับ stop และวัดความผันผวน */
  filterAtrLength: 14,
  /** ATR เร็ว/ATR ช้า เกินค่านี้ถือว่าผันผวนผิดปกติ งดเข้า */
  filterMaxVolRatio: 2.5,
  /** ระยะ stop เริ่มต้น = stopAtr × ATR */
  filterStopAtr: 2.5,
  /** ระยะ trailing จากราคาปิดสูงสุดที่เคยทำได้ */
  filterTrailAtr: 3,
  /** ระยะ stop/trailing ขั้นต่ำเป็น % กันกรณี ATR เล็กผิดปกติ */
  filterMinStopPct: 0.5,
  /** ถือครบกี่แท่งแล้วบังคับออก */
  filterMaxHoldBars: 150,
  /** พักกี่แท่งหลังออก กัน re-entry ทันทีในตลาดที่เหวี่ยง */
  filterCooldownBars: 3,
};
export type TradeFilterParams = typeof TRADE_FILTER_DEFAULTS;

/**
 * รูปแบบการเข้าของอินดิเคเตอร์ มีผลต่อ "ตัวกรองทิศทาง" ที่ถูกต้องสำหรับมัน
 *   trend     = เข้าตามแรง (breakout / ตัดขึ้น / พลิกเทรนด์) — ราคาต้องยืนเหนือ EMA เทรนด์
 *   reversion = เข้าสวนย่อ (ออสซิลเลเตอร์เด้งจากเขต Oversold) — ห้ามบังคับราคาเหนือ EMA เทรนด์
 *
 * เหตุผล: สัญญาณของออสซิลเลเตอร์เกิดตอนราคา "อ่อนแรงชั่วคราว" ซึ่งโดยนิยามคือช่วงที่ราคา
 * มักอยู่ใต้ค่าเฉลี่ยของตัวเอง การบังคับ close > EMA เทรนด์จึงตัดสัญญาณทิ้งเกือบ 100%
 * (วัดจริงบน BTCUSDT 1h 4,000 แท่ง: RSI ถูกปฏิเสธ 58/58 ครั้ง, WaveTrend 25/26 ครั้ง)
 * ตัวกรองที่ถูกต้องสำหรับการซื้อย่อคือ "เทรนด์ใหญ่ต้องขึ้น" ไม่ใช่ "ราคาต้องอยู่เหนือเส้น"
 * โหมด reversion จึงคงเงื่อนไขความชัน EMA, ADX/DI และความผันผวนไว้ครบ ตัดเฉพาะข้อแรกออก
 */
export type V2EntryStyle = "trend" | "reversion";

export interface TradeFilterResult {
  signal: V2Signal[];
  /** ราคา stop ที่ใช้อยู่ (เทียบกับราคาปิด) */
  stop: Series;
  /** เหตุผลของสัญญาณ หรือเหตุผลที่ปฏิเสธการเข้า */
  reason: ReasonSeries;
  /** ผ่านตัวกรองครบทุกข้อหรือไม่ ณ แท่งนั้น */
  passed: (boolean | null)[];
}

/**
 * แปลง "เจตนาดิบ" (BUY/SELL จากอินดิเคเตอร์) เป็นสัญญาณที่ผ่านตัวกรองและมีการออกที่ชัดเจน
 *
 * ลำดับการตัดสินใจในแต่ละแท่ง (ทำตามลำดับนี้เสมอ)
 *   1. ถ้ามีสถานะอยู่ → ตรวจการออกก่อน: ราคาปิด ≤ stop, เจอ SELL ดิบ, หรือถือครบ maxHoldBars
 *   2. ถ้าว่าง → ตรวจ cooldown, แล้วตรวจตัวกรอง 4 ชั้น, แล้วจึงรับ BUY ดิบ
 *   3. ระหว่างถือ เลื่อน trailing stop ขึ้นเท่านั้น (ไม่ลดลง) จากราคาปิดสูงสุดที่เคยทำได้
 *
 * หมายเหตุสำคัญ: stop ทั้งหมดเทียบ "ราคาปิด" ไม่ใช่คำสั่ง stop ระหว่างแท่ง
 * ผลลัพธ์จริงจะถูกเอนจินนำไปเปิด/ปิดที่ราคาเปิดแท่งถัดไปพร้อม fee/slippage
 */
export function applyTradeFilter(
  k: KlineData[],
  intent: V2Signal[],
  params: TradeFilterParams,
  startIndex = 0,
  entryStyle: V2EntryStyle = "trend",
): TradeFilterResult {
  const len = k.length;
  const c = closes(k);
  const trendEma = ema(c, Math.max(2, Math.round(params.filterTrendLength)));
  const { plusDI, minusDI, adx } = dmi(k, Math.max(2, Math.round(params.filterAdxLength)), Math.max(2, Math.round(params.filterAdxLength)));
  const atrFast = atr(k, Math.max(2, Math.round(params.filterAtrLength)));
  const atrSlow = atr(k, Math.max(2, Math.round(params.filterAtrLength)) * 4);
  const slopeBars = Math.max(1, Math.round(params.filterSlopeBars));
  const reversion = entryStyle === "reversion";
  /**
   * โหมดซื้อย่อวัดเทรนด์จาก "ภาพใหญ่" แทนสภาพ ณ แท่งที่เข้า
   * เพราะแท่งที่ออสซิลเลเตอร์ให้สัญญาณคือแท่งที่ราคาเพิ่งอ่อนแรง ซึ่งทำให้เงื่อนไข
   * ระยะสั้นทุกข้อเป็นเท็จโดยอัตโนมัติ วัดจริงบน BTCUSDT 1h 4,000 แท่ง ที่แท่งสัญญาณ RSI 58 แท่ง
   *   ราคา > EMA100            ผ่าน  0/58
   *   EMA100 ชันขึ้นเทียบ 5 แท่ง ผ่าน  0/58
   *   +DI > −DI                ผ่าน  0/58
   *   EMA100 สูงกว่าเมื่อ 25 แท่งก่อน ผ่าน 14/58   ← ข้อนี้ยังแยกแยะได้จริง
   * โหมดนี้จึงใช้ความชัน EMA ระยะยาว (หนึ่งในสี่ของ filterTrendLength) เป็นตัวตัดสินทิศทาง
   * และตัดข้อที่เป็นเท็จโดยโครงสร้างออก คือ ราคาเหนือ EMA และ +DI > −DI
   * ส่วน ADX และตัวกรองความผันผวนยังคงใช้เหมือนกันทั้งสองโหมด
   */
  const slopeWindow = reversion
    ? Math.max(slopeBars, Math.round(Math.max(2, params.filterTrendLength) / 4))
    : slopeBars;

  const signal: V2Signal[] = new Array(len).fill(null);
  const stop: Series = new Array(len).fill(null);
  const reason: ReasonSeries = new Array(len).fill(null);
  const passed: (boolean | null)[] = new Array(len).fill(null);

  let inPosition = false;
  let entryIdx = 0;
  let peakClose = 0;
  let currentStop = 0;
  let cooldownUntil = -1;

  for (let i = Math.max(0, startIndex); i < len; i++) {
    const price = c[i];
    const a = atrFast[i];

    if (inPosition) {
      peakClose = Math.max(peakClose, price);
      if (a !== null) {
        const trail = Math.max(params.filterTrailAtr * a, (peakClose * params.filterMinStopPct) / 100);
        currentStop = Math.max(currentStop, peakClose - trail);
      }
      stop[i] = currentStop;
      const held = i - entryIdx;
      if (price <= currentStop) {
        signal[i] = "SELL";
        reason[i] = `ออก: ราคาปิด ${price.toFixed(2)} ≤ stop ${currentStop.toFixed(2)}`;
        inPosition = false;
        cooldownUntil = i + Math.round(params.filterCooldownBars);
      } else if (intent[i] === "SELL") {
        signal[i] = "SELL";
        reason[i] = "ออก: สัญญาณขายจากอินดิเคเตอร์";
        inPosition = false;
        cooldownUntil = i + Math.round(params.filterCooldownBars);
      } else if (held >= Math.round(params.filterMaxHoldBars)) {
        signal[i] = "SELL";
        reason[i] = `ออก: ถือครบ ${held} แท่ง`;
        inPosition = false;
        cooldownUntil = i + Math.round(params.filterCooldownBars);
      }
      continue;
    }

    if (intent[i] !== "BUY") continue;
    if (i < cooldownUntil) { reason[i] = "งดเข้า: อยู่ในช่วงพักหลังออก"; passed[i] = false; continue; }

    const te = trendEma[i];
    const tePrev = i >= slopeWindow ? trendEma[i - slopeWindow] : null;
    const ad = adx[i], pdi = plusDI[i], mdi = minusDI[i];
    const slow = atrSlow[i];

    if (te === null || tePrev === null || ad === null || pdi === null || mdi === null || a === null || slow === null) {
      reason[i] = "งดเข้า: ข้อมูลยังไม่พอสำหรับตัวกรอง"; passed[i] = false; continue;
    }
    if (!reversion && price <= te) {
      reason[i] = "งดเข้า: ราคาปิดต่ำกว่า EMA เทรนด์"; passed[i] = false; continue;
    }
    if (te <= tePrev) {
      reason[i] = `งดเข้า: EMA เทรนด์ไม่ได้สูงขึ้นเทียบ ${slopeWindow} แท่งก่อน`; passed[i] = false; continue;
    }
    if (ad < params.filterAdxThreshold) { reason[i] = `งดเข้า: ADX ${ad.toFixed(1)} ต่ำกว่าเกณฑ์`; passed[i] = false; continue; }
    if (!reversion && pdi <= mdi) { reason[i] = "งดเข้า: +DI ไม่เหนือ −DI"; passed[i] = false; continue; }
    if (slow > 0 && a / slow > params.filterMaxVolRatio) {
      reason[i] = "งดเข้า: ความผันผวนพุ่งผิดปกติ"; passed[i] = false; continue;
    }

    inPosition = true;
    entryIdx = i;
    peakClose = price;
    currentStop = price - Math.max(params.filterStopAtr * a, (price * params.filterMinStopPct) / 100);
    stop[i] = currentStop;
    signal[i] = "BUY";
    passed[i] = true;
    reason[i] = `เข้า: สัญญาณดิบผ่านตัวกรองครบ (ADX ${ad.toFixed(1)})`;
  }
  return { signal, stop, reason, passed };
}

// ─── โครงผลลัพธ์ร่วมของทุกอินดิเคเตอร์ v2 ───────────────────────
export interface V2Base {
  /** สัญญาณตามกฎพื้นฐานของอินดิเคเตอร์ตัวนั้นล้วน ๆ */
  signal: V2Signal[];
  /** สัญญาณเดียวกันหลังผ่านตัวกรองร่วม + ATR stop/trailing/เวลาถือ */
  signalFiltered: V2Signal[];
  /** ราคา stop ที่ชุดตัวกรองใช้อยู่ */
  filterStop: Series;
  /** เหตุผลรายแท่งของชุดตัวกรอง */
  filterReason: ReasonSeries;
}

/** ปัดค่า period ให้เป็นจำนวนเต็มและไม่ต่ำกว่าขั้นต่ำ */
const P = (v: number, min = 2) => Math.max(min, Math.round(v));
/** รวมค่าตั้งต้นกับค่าที่ผู้ใช้ปรับ */
function merge<T extends Record<string, number>>(defaults: T, params?: Record<string, number>): T {
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const v = params?.[key as string];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v as T[keyof T];
  }
  return out;
}
/** ต่อชุดตัวกรองเข้ากับเจตนาดิบ */
function withFilter(
  k: KlineData[], intent: V2Signal[], params: Record<string, number>,
  startIndex: number, entryStyle: V2EntryStyle = "trend",
) {
  const f = applyTradeFilter(k, intent, merge(TRADE_FILTER_DEFAULTS, params), startIndex, entryStyle);
  return { signalFiltered: f.signal, filterStop: f.stop, filterReason: f.reason };
}

// ══ 1) Simple Moving Average ═══════════════════════════════════
/**
 * หลักการ: เฉลี่ยราคาปิดย้อนหลัง n แท่ง ให้น้ำหนักทุกแท่งเท่ากัน
 *
 * การออกแบบสัญญาณ
 *   เอกสารระบุว่า SMA "เหมาะเป็นตัวกรองแนวโน้มมากกว่าทำนายจุดกลับตัวล่วงหน้า"
 *   และชี้ว่าการตัดกันของเส้นสั้น/ยาวใช้สังเกตการเปลี่ยนแนวโน้มได้
 *   กฎพื้นฐานจึงใช้ Golden/Death Cross ตรง ๆ ไม่เติมเงื่อนไขอื่น
 *     BUY  = SMA(fast) ตัดขึ้นเหนือ SMA(slow)
 *     SELL = SMA(fast) ตัดลงใต้ SMA(slow)
 *   เป็นจุดตัดจริง (ดูสองแท่ง) ไม่ใช่สภาวะ "fast > slow" ที่จะยิงซ้ำทุกแท่ง
 *
 * จุดอ่อนที่รู้ล่วงหน้า: ตลาดออกข้างจะตัดไปมาบ่อย และเส้นยาวตอบสนองช้ามาก
 * สัญญาณจึงมาช้าเสมอ — ใช้เทียบกับ sma_v2_filtered เพื่อดูว่าตัวกรองช่วยได้แค่ไหน
 */
export const SMA_V2_CORE = { smaFastLength: 50, smaSlowLength: 200 };
export interface SmaV2Result extends V2Base {
  fast: Series;
  slow: Series;
  /** fast อยู่เหนือ slow หรือไม่ */
  bullish: (boolean | null)[];
}
export function smaV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): SmaV2Result {
  const p = merge(SMA_V2_CORE, params);
  const c = closes(k);
  const fast = sma(c, P(p.smaFastLength));
  const slow = sma(c, P(p.smaSlowLength));
  const signal: V2Signal[] = new Array(k.length).fill(null);
  const bullish: (boolean | null)[] = new Array(k.length).fill(null);
  for (let i = 0; i < k.length; i++) {
    const f = fast[i], s = slow[i];
    bullish[i] = f === null || s === null ? null : f > s;
    if (crossOver(fast, slow, i)) signal[i] = "BUY";
    else if (crossUnder(fast, slow, i)) signal[i] = "SELL";
  }
  return { fast, slow, bullish, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 2) Exponential Moving Average ══════════════════════════════
/**
 * หลักการ: alpha = 2/(n+1) ให้น้ำหนักราคาล่าสุดมากกว่า จึงตอบสนองเร็วกว่า SMA ความยาวเดียวกัน
 *
 * การออกแบบสัญญาณ
 *   เอกสารยกตัวอย่างตรง ๆ ว่า "EMA 20 ตัดขึ้นเหนือ EMA 50 แสดงว่าค่าเฉลี่ยระยะสั้นแข็งแรงขึ้น"
 *   กฎพื้นฐานจึงเป็นการตัดกันของ EMA เร็ว/ช้า เหมือน SMA แต่ไวกว่า
 *   เพิ่มเงื่อนไขยืนยันหนึ่งข้อที่เอกสารระบุว่าเป็นวิธีอ่าน EMA: ราคาปิดต้องอยู่ฝั่งเดียวกับเส้นเร็ว
 *     BUY  = EMA(fast) ตัดขึ้นเหนือ EMA(slow) และราคาปิด > EMA(fast)
 *     SELL = EMA(fast) ตัดลงใต้ EMA(slow)
 *   ฝั่งขายไม่บังคับเงื่อนไขราคา เพราะการออกช้ากว่าการเข้าหนึ่งขั้นจะกินกำไรที่ได้มา
 *
 * จุดอ่อน: ความเร็วแลกมาด้วยความไวต่อการแกว่งสั้น สัญญาณจึงถี่กว่า SMA มาก
 */
export const EMA_V2_CORE = { emaFastLength: 20, emaSlowLength: 50 };
export interface EmaV2Result extends V2Base {
  fast: Series;
  slow: Series;
  bullish: (boolean | null)[];
}
export function emaV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): EmaV2Result {
  const p = merge(EMA_V2_CORE, params);
  const c = closes(k);
  const fast = ema(c, P(p.emaFastLength));
  const slow = ema(c, P(p.emaSlowLength));
  const signal: V2Signal[] = new Array(k.length).fill(null);
  const bullish: (boolean | null)[] = new Array(k.length).fill(null);
  for (let i = 0; i < k.length; i++) {
    const f = fast[i], s = slow[i];
    bullish[i] = f === null || s === null ? null : f > s;
    if (crossOver(fast, slow, i) && f !== null && c[i] > f) signal[i] = "BUY";
    else if (crossUnder(fast, slow, i)) signal[i] = "SELL";
  }
  return { fast, slow, bullish, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 3) Relative Strength Index ═════════════════════════════════
/**
 * หลักการ: RS = RMA(gain,n)/RMA(loss,n); RSI = 100 − 100/(1+RS)
 *
 * การออกแบบสัญญาณ — จุดที่ v2 ต่างจาก v1 อย่างมีนัยสำคัญ
 *   v1 ใช้สภาวะ: RSI < 30 → BUY ทุกแท่งที่ยังต่ำกว่า 30
 *   ปัญหาคือเอกสารเตือนตรง ๆ ว่า "Oversold ไม่ได้แปลว่าต้องเด้งทันที RSI อยู่ในโซนสุดขั้ว
 *   ได้นานเมื่อเทรนด์แรง" การซื้อทันทีที่หลุด 30 จึงเท่ากับซื้อสวนเทรนด์ขาลงซ้ำ ๆ
 *   v2 เปลี่ยนเป็น "จุดตัดขากลับ" ซึ่งบังคับให้ต้องมีหลักฐานการฟื้นตัวก่อน
 *     BUY  = RSI ตัดขึ้นเหนือ buyThreshold (ออกจากเขต Oversold แล้วจริง)
 *     SELL = RSI ตัดลงใต้ sellThreshold (หลุดออกจากเขต Overbought แล้วจริง)
 *   ผลคือสัญญาณน้อยลงมากแต่แต่ละครั้งมีการยืนยันการกลับทิศของโมเมนตัม
 *
 * ค่า midline 50 คืนไว้เป็นคอลัมน์ให้ดูสมดุลโมเมนตัมประกอบ ไม่ได้ใช้ตัดสินใจ
 */
export const RSI_V2_CORE = { rsiLength: 14, rsiBuyThreshold: 30, rsiSellThreshold: 70 };
export interface RsiV2Result extends V2Base {
  rsi: Series;
  /** ระดับ 50 สำหรับดูสมดุลโมเมนตัม */
  midline: Series;
}
export function rsiV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): RsiV2Result {
  const p = merge(RSI_V2_CORE, params);
  const c = closes(k);
  const gain: Series = new Array(k.length).fill(null);
  const loss: Series = new Array(k.length).fill(null);
  for (let i = 1; i < k.length; i++) {
    const diff = c[i] - c[i - 1];
    gain[i] = Math.max(diff, 0);
    loss[i] = Math.max(-diff, 0);
  }
  const n = P(p.rsiLength);
  const avgGain = rma(gain, n);
  const avgLoss = rma(loss, n);
  const rsiSeries: Series = new Array(k.length).fill(null);
  for (let i = 0; i < k.length; i++) {
    const g = avgGain[i], l = avgLoss[i];
    if (g === null || l === null) continue;
    rsiSeries[i] = l === 0 ? 100 : g === 0 ? 0 : 100 - 100 / (1 + g / l);
  }
  const buyLine = constant(k.length, p.rsiBuyThreshold);
  const sellLine = constant(k.length, p.rsiSellThreshold);
  const signal: V2Signal[] = new Array(k.length).fill(null);
  for (let i = 0; i < k.length; i++) {
    if (crossOver(rsiSeries, buyLine, i)) signal[i] = "BUY";
    else if (crossUnder(rsiSeries, sellLine, i)) signal[i] = "SELL";
  }
  return {
    rsi: rsiSeries,
    midline: constant(k.length, 50),
    signal,
    ...withFilter(k, signal, params, startIndex, "reversion"),
  };
}

// ══ 4) MACD ════════════════════════════════════════════════════
/**
 * หลักการ: MACD = EMA(C,12) − EMA(C,26); Signal = EMA(MACD,9); Histogram = MACD − Signal
 *
 * หมายเหตุความถูกต้อง: v1 (cmMacdUltMTF) ใช้ SMA เป็นเส้น Signal ซึ่งไม่ตรงกับสูตร
 * ในเอกสาร v2 ใช้ EMA ตามสูตรมาตรฐานของ TradingView
 *
 * การออกแบบสัญญาณ
 *   เอกสารแยกการอ่านไว้สองชั้น: (ก) MACD เหนือศูนย์ = EMA เร็วอยู่เหนือ EMA ช้า
 *   และ (ข) การตัดเส้น Signal = การเปลี่ยนโมเมนตัมเทียบกับเส้น Signal
 *   พร้อมเตือนว่า "การตัด Signal ในตลาดออกข้างอาจเกิดถี่"
 *   กฎพื้นฐานจึงใช้ทั้งสองชั้นประกอบกันเพื่อลดการตัดถี่ในโซนไร้ทิศทาง
 *     BUY  = MACD ตัดขึ้นเหนือ Signal โดยที่ MACD อยู่เหนือศูนย์ หรือ histogram กำลังเพิ่ม
 *     SELL = MACD ตัดลงใต้ Signal
 *   เงื่อนไข "histogram กำลังเพิ่ม" ทำให้ยังรับจังหวะกลับตัวใต้ศูนย์ที่มีแรงส่งจริงได้
 */
export const MACD_V2_CORE = { macdFastLength: 12, macdSlowLength: 26, macdSignalLength: 9 };
export interface MacdV2Result extends V2Base {
  macd: Series;
  signalLine: Series;
  histogram: Series;
  /** MACD อยู่เหนือเส้นศูนย์หรือไม่ */
  aboveZero: (boolean | null)[];
}
export function macdV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): MacdV2Result {
  const p = merge(MACD_V2_CORE, params);
  const c = closes(k);
  const fast = ema(c, P(p.macdFastLength));
  const slow = ema(c, P(p.macdSlowLength));
  const macd: Series = new Array(k.length).fill(null);
  for (let i = 0; i < k.length; i++) {
    const f = fast[i], s = slow[i];
    if (f !== null && s !== null) macd[i] = f - s;
  }
  const signalLine = ema(macd, P(p.macdSignalLength));
  const histogram: Series = new Array(k.length).fill(null);
  const aboveZero: (boolean | null)[] = new Array(k.length).fill(null);
  for (let i = 0; i < k.length; i++) {
    const m = macd[i], s = signalLine[i];
    if (m !== null) aboveZero[i] = m > 0;
    if (m !== null && s !== null) histogram[i] = m - s;
  }
  const signal: V2Signal[] = new Array(k.length).fill(null);
  for (let i = 1; i < k.length; i++) {
    const m = macd[i];
    const h = histogram[i], hPrev = histogram[i - 1];
    const rising = h !== null && hPrev !== null && h > hPrev;
    if (crossOver(macd, signalLine, i) && m !== null && (m > 0 || rising)) signal[i] = "BUY";
    else if (crossUnder(macd, signalLine, i)) signal[i] = "SELL";
  }
  return { macd, signalLine, histogram, aboveZero, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 5) Bollinger Bands ═════════════════════════════════════════
/**
 * หลักการ: Middle = SMA(C,20); Upper/Lower = Middle ± 2 × StdDev(C,20)
 *
 * การออกแบบสัญญาณ — ประเด็นที่ต้องตัดสินใจ
 *   เอกสารเตือนสองข้อที่ขัดกับวิธีใช้ BB แบบที่คนนิยมทำ
 *     "แตะขอบบนไม่ใช่คำสั่งขายอัตโนมัติ" → ห้ามใช้แตะขอบบน = SELL
 *     "การบีบตัวไม่บอกทิศทางที่จะทะลุ"  → ห้ามใช้ squeeze เดี่ยว ๆ เป็นสัญญาณ
 *   สิ่งที่เอกสารรับรองว่าอ่านได้จริงคือ "กรอบแคบ = ความผันผวนลดลง", "กรอบขยาย =
 *   ความผันผวนเพิ่ม" และ "ราคาเกาะขอบบนต่อเนื่องอาจสะท้อนขาขึ้นแรง"
 *   กฎพื้นฐานจึงใช้ squeeze เป็น "เงื่อนไขตั้งท่า" แล้วให้ "ราคา" เป็นคนบอกทิศทาง
 *     BUY  = อยู่ในภาวะบีบตัว (bandwidth < ค่าเฉลี่ย bandwidth × squeezeThreshold)
 *            ภายใน squeezeLookback แท่งที่ผ่านมา แล้วราคาปิดตัดขึ้นเหนือขอบบน
 *     SELL = ราคาปิดตัดลงใต้เส้นกลาง (เสียการเกาะขอบบนแล้ว)
 *   ใช้เส้นกลางเป็นทางออกแทนขอบล่าง เพราะรอถึงขอบล่างมักคืนกำไรเกือบหมด
 *
 * bandwidth = (Upper − Lower) / Middle เทียบข้ามช่วงเวลาได้ดีกว่าความกว้างดิบ
 * percentB  = (C − Lower) / (Upper − Lower) บอกตำแหน่งราคาในกรอบ (0 = ขอบล่าง, 1 = ขอบบน)
 */
export const BB_V2_CORE = {
  bbLength: 20,
  bbMult: 2,
  /** ช่วงอ้างอิงค่าเฉลี่ย bandwidth เพื่อบอกว่า "แคบ" เทียบกับอะไร */
  bbSqueezeLength: 100,
  /** bandwidth ต่ำกว่าค่าเฉลี่ยกี่เท่าจึงเรียกว่าบีบตัว */
  bbSqueezeThreshold: 0.85,
  /** ภาวะบีบตัวยังนับว่า "ตั้งท่าอยู่" ได้กี่แท่ง */
  bbSetupBars: 10,
};
export interface BollingerV2Result extends V2Base {
  middle: Series;
  upper: Series;
  lower: Series;
  bandwidth: Series;
  percentB: Series;
  /** อยู่ในภาวะบีบตัวหรือไม่ */
  squeeze: (boolean | null)[];
}
export function bollingerV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): BollingerV2Result {
  const p = merge(BB_V2_CORE, params);
  const c = closes(k);
  const n = P(p.bbLength);
  const middle = sma(c, n);
  const sd = stdev(c, n);
  const len = k.length;
  const upper: Series = new Array(len).fill(null);
  const lower: Series = new Array(len).fill(null);
  const bandwidth: Series = new Array(len).fill(null);
  const percentB: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const m = middle[i], s = sd[i];
    if (m === null || s === null) continue;
    const u = m + p.bbMult * s, l = m - p.bbMult * s;
    upper[i] = u; lower[i] = l;
    if (m !== 0) bandwidth[i] = (u - l) / m;
    if (u !== l) percentB[i] = (c[i] - l) / (u - l);
  }
  const avgBandwidth = sma(bandwidth, P(p.bbSqueezeLength));
  const squeeze: (boolean | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const bw = bandwidth[i], avg = avgBandwidth[i];
    squeeze[i] = bw === null || avg === null ? null : bw < avg * p.bbSqueezeThreshold;
  }
  const setup = P(p.bbSetupBars, 1);
  const signal: V2Signal[] = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    let recentSqueeze = false;
    for (let j = Math.max(0, i - setup); j <= i; j++) if (squeeze[j]) { recentSqueeze = true; break; }
    const u = upper[i], uPrev = upper[i - 1];
    if (recentSqueeze && u !== null && uPrev !== null && c[i - 1] <= uPrev && c[i] > u) signal[i] = "BUY";
    else {
      const m = middle[i], mPrev = middle[i - 1];
      if (m !== null && mPrev !== null && c[i - 1] >= mPrev && c[i] < m) signal[i] = "SELL";
    }
  }
  return { middle, upper, lower, bandwidth, percentB, squeeze, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 6) Average True Range ══════════════════════════════════════
/**
 * หลักการ: TR = max(H−L, |H−C(t−1)|, |L−C(t−1)|); ATR = RMA(TR,14)
 *
 * การออกแบบสัญญาณ — ข้อจำกัดที่ต้องยอมรับก่อน
 *   เอกสารระบุชัดว่า "ATR สูงขึ้นหมายถึงราคาแกว่งกว้างขึ้น ไม่ระบุว่าขึ้นหรือลง"
 *   แปลว่า ATR ให้สัญญาณซื้อขายด้วยตัวเองไม่ได้เลย ต้องมีตัวบอกทิศทางเสมอ
 *   ระบบที่ตรงกับธรรมชาติของ ATR มากที่สุดคือ Volatility Breakout + Chandelier Exit
 *   ซึ่งใช้ ATR ทำสองหน้าที่ที่มันทำได้จริง คือ "คัดกรองว่าตลาดกำลังตื่น" และ "วัดระยะ stop"
 *     BUY  = ATR > SMA(ATR, expansionLength) (ความผันผวนกำลังขยาย)
 *            และราคาปิดทำจุดสูงสุดใหม่ของ breakoutLength แท่ง (ทิศทางมาจากราคา)
 *     SELL = ราคาปิดหลุด Chandelier stop = (ราคาปิดสูงสุดนับจากเข้า) − chandelierMult × ATR
 *   ทางออกใช้สถานะภายใน เพราะ Chandelier ต้องรู้ว่าเข้าตั้งแต่เมื่อไร
 *
 * atrPercent = ATR/Close × 100 คืนไว้ด้วย เพราะเอกสารระบุว่า ATR เป็นหน่วยราคา
 * จึงห้ามเทียบตัวเลขดิบข้ามสินทรัพย์ ต้องแปลงเป็น % ก่อน
 */
export const ATR_V2_CORE = {
  atrLength: 14,
  /** ช่วงเทียบว่า ATR ตอนนี้ "ขยาย" เมื่อเทียบกับอะไร */
  atrExpansionLength: 50,
  /** ราคาปิดต้องทำจุดสูงสุดใหม่ของกี่แท่งจึงถือว่าทะลุ */
  atrBreakoutLength: 20,
  /** ระยะ Chandelier stop เป็นจำนวนเท่าของ ATR */
  atrChandelierMult: 3,
};
export interface AtrV2Result extends V2Base {
  atr: Series;
  /** ATR/Close × 100 สำหรับเทียบข้ามสินทรัพย์ */
  atrPercent: Series;
  /** ค่าเฉลี่ย ATR ที่ใช้ตัดสินว่าขยายตัว */
  atrAverage: Series;
  /** ระดับ breakout ที่ต้องทะลุ */
  breakoutLevel: Series;
  /** Chandelier stop ขณะถือสถานะ */
  chandelier: Series;
}
export function atrV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): AtrV2Result {
  const p = merge(ATR_V2_CORE, params);
  const c = closes(k);
  const len = k.length;
  const atrSeries = atr(k, P(p.atrLength));
  const atrAverage = sma(atrSeries, P(p.atrExpansionLength));
  const atrPercent: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const a = atrSeries[i];
    if (a !== null && c[i] !== 0) atrPercent[i] = (a / c[i]) * 100;
  }
  // ระดับ breakout ใช้ค่าสูงสุดของ "แท่งก่อนหน้า" เท่านั้น ไม่รวมแท่งปัจจุบัน
  const bo = P(p.atrBreakoutLength);
  const breakoutLevel: Series = new Array(len).fill(null);
  for (let i = bo; i < len; i++) {
    let best = -Infinity;
    for (let j = i - bo; j < i; j++) best = Math.max(best, c[j]);
    breakoutLevel[i] = best;
  }
  const signal: V2Signal[] = new Array(len).fill(null);
  const chandelier: Series = new Array(len).fill(null);
  let inPosition = false, peak = 0;
  for (let i = Math.max(0, startIndex); i < len; i++) {
    const a = atrSeries[i], avg = atrAverage[i], level = breakoutLevel[i];
    if (inPosition) {
      peak = Math.max(peak, c[i]);
      if (a !== null) {
        const stopLevel = peak - p.atrChandelierMult * a;
        chandelier[i] = stopLevel;
        if (c[i] <= stopLevel) { signal[i] = "SELL"; inPosition = false; }
      }
      continue;
    }
    if (a === null || avg === null || level === null) continue;
    if (a > avg && c[i] > level) {
      signal[i] = "BUY";
      inPosition = true;
      peak = c[i];
      chandelier[i] = c[i] - p.atrChandelierMult * a;
    }
  }
  return { atr: atrSeries, atrPercent, atrAverage, breakoutLevel, chandelier, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 7) Stochastic Oscillator ═══════════════════════════════════
/**
 * หลักการ: RawK = 100 × (C − LL(n)) / (HH(n) − LL(n)); %K = SMA(RawK,3); %D = SMA(%K,3)
 *
 * การออกแบบสัญญาณ
 *   เอกสารเตือนว่า "ระดับสูงอาจเป็นผลของเทรนด์ขาขึ้นที่ต่อเนื่อง การสวนเทรนด์เพียงเพราะ
 *   เข้าเขต Overbought/Oversold จึงอาจตีความผิด" และแนะนำวิธีอ่านที่ถูกต้องไว้เองว่า
 *   "%K ตัดขึ้นเหนือ %D จากโซนล่างเป็นเงื่อนไขที่ใช้สังเกตโมเมนตัมฟื้นตัว"
 *   กฎพื้นฐานจึงทำตามประโยคนั้นตรง ๆ คือใช้การตัดกัน + ตำแหน่งในกรอบ ไม่ใช่ระดับเดี่ยว ๆ
 *     BUY  = %K ตัดขึ้นเหนือ %D ขณะที่ %D ยังอยู่ในเขต Oversold
 *     SELL = %K ตัดลงใต้ %D ขณะที่ %D อยู่ในเขต Overbought
 *   ใช้ %D (เส้นช้ากว่า) เป็นตัวตัดสินโซน เพื่อกันกรณี %K วิ่งออกจากโซนไปก่อนแล้วค่อยตัด
 *
 * กรณีตัวหารเป็นศูนย์ (HH = LL คือราคานิ่งสนิททั้งหน้าต่าง) กำหนดให้ RawK = 50 ซึ่งเป็นกลาง
 */
export const STOCH_V2_CORE = {
  stochLength: 14,
  stochSmoothK: 3,
  stochSmoothD: 3,
  stochOversoldThreshold: 20,
  stochOverboughtThreshold: 80,
};
export interface StochasticV2Result extends V2Base {
  k: Series;
  d: Series;
  rawK: Series;
}
export function stochasticV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): StochasticV2Result {
  const p = merge(STOCH_V2_CORE, params);
  const c = closes(k), h = highs(k), l = lows(k);
  const len = k.length;
  const n = P(p.stochLength);
  const hh = highest(h, n), ll = lowest(l, n);
  const rawK: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const hi = hh[i], lo = ll[i];
    if (hi === null || lo === null) continue;
    rawK[i] = hi === lo ? 50 : (100 * (c[i] - lo)) / (hi - lo);
  }
  const kLine = sma(rawK, P(p.stochSmoothK, 1));
  const dLine = sma(kLine, P(p.stochSmoothD, 1));
  const signal: V2Signal[] = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    const d = dLine[i];
    if (d === null) continue;
    if (crossOver(kLine, dLine, i) && d < p.stochOversoldThreshold) signal[i] = "BUY";
    else if (crossUnder(kLine, dLine, i) && d > p.stochOverboughtThreshold) signal[i] = "SELL";
  }
  return { k: kLine, d: dLine, rawK, signal, ...withFilter(k, signal, params, startIndex, "reversion") };
}

// ══ 8) Stochastic RSI ══════════════════════════════════════════
/**
 * หลักการ: เอาสูตร Stochastic ไปใช้กับค่า RSI แทนราคา
 *   RawStochRSI = (RSI − LowestRSI(n)) / (HighestRSI(n) − LowestRSI(n)) × 100
 *   %K = SMA(RawStochRSI,3); %D = SMA(%K,3)
 *
 * การออกแบบสัญญาณ
 *   เอกสารระบุว่า StochRSI "ไวกว่า RSI และให้สัญญาณถี่กว่า" และเตือนความเข้าใจผิดสำคัญว่า
 *   "ค่า Stoch RSI ต่ำไม่ได้แปลว่า RSI ต่ำกว่า 30 แต่แปลว่า RSI อยู่ใกล้ด้านล่างของช่วงย้อนหลัง"
 *   ดังนั้นห้ามตีความโซนของ StochRSI เป็นภาวะ Oversold ของราคา
 *   กฎพื้นฐานใช้การตัด K/D ในโซนเหมือน Stochastic แต่เพิ่มการยืนยันหนึ่งชั้น
 *   เพื่อลดความถี่ที่เอกสารเตือนไว้: RSI ต้นทางต้องไม่ได้อยู่ฝั่งตรงข้าม
 *     BUY  = %K ตัดขึ้นเหนือ %D ในเขตต่ำ และ RSI ต้นทางกำลังสูงขึ้นจากแท่งก่อน
 *     SELL = %K ตัดลงใต้ %D ในเขตสูง
 */
export const STOCH_RSI_V2_CORE = {
  stochRsiLength: 14,
  stochRsiStochLength: 14,
  stochRsiSmoothK: 3,
  stochRsiSmoothD: 3,
  stochRsiOversoldThreshold: 20,
  stochRsiOverboughtThreshold: 80,
};
export interface StochRsiV2Result extends V2Base {
  k: Series;
  d: Series;
  /** RSI ต้นทางที่นำมาเข้าสูตร Stochastic */
  rsi: Series;
}
export function stochRsiV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): StochRsiV2Result {
  const p = merge(STOCH_RSI_V2_CORE, params);
  const len = k.length;
  const base = rsiV2(k, { rsiLength: p.stochRsiLength }, startIndex).rsi;
  const n = P(p.stochRsiStochLength);
  const hi = highest(base, n), lo = lowest(base, n);
  const raw: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const h = hi[i], l = lo[i], r = base[i];
    if (h === null || l === null || r === null) continue;
    raw[i] = h === l ? 50 : ((r - l) / (h - l)) * 100;
  }
  const kLine = sma(raw, P(p.stochRsiSmoothK, 1));
  const dLine = sma(kLine, P(p.stochRsiSmoothD, 1));
  const signal: V2Signal[] = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    const d = dLine[i], r = base[i], rPrev = base[i - 1];
    if (d === null) continue;
    if (crossOver(kLine, dLine, i) && d < p.stochRsiOversoldThreshold && r !== null && rPrev !== null && r > rPrev)
      signal[i] = "BUY";
    else if (crossUnder(kLine, dLine, i) && d > p.stochRsiOverboughtThreshold) signal[i] = "SELL";
  }
  return { k: kLine, d: dLine, rsi: base, signal, ...withFilter(k, signal, params, startIndex, "reversion") };
}

// ══ 9) ADX / Directional Movement Index ════════════════════════
/**
 * หลักการ: สร้าง +DM/−DM จากการขยายตัวของ High/Low ระหว่างแท่ง แล้วทำเป็น +DI/−DI
 *   DX = 100 × |+DI − (−DI)| / (+DI + (−DI));  ADX = RMA(DX, 14)
 *
 * การออกแบบสัญญาณ
 *   เอกสารระบุข้อจำกัดที่เป็นหัวใจของการออกแบบ: "ADX สูงไม่ได้แปลว่าขาขึ้น"
 *   ADX บอกแค่ "มีเทรนด์แค่ไหน" ส่วน "ทิศไหน" ต้องอ่านจาก +DI/−DI
 *   จึงต้องใช้สองส่วนคู่กันเสมอ ห้ามใช้ ADX เดี่ยว
 *     BUY  = +DI ตัดขึ้นเหนือ −DI และ ADX ≥ adxThreshold (เทรนด์ชัดพอ)
 *     SELL = −DI ตัดขึ้นเหนือ +DI (ทิศกลับ) หรือ ADX ตัดลงใต้ adxExitThreshold (เทรนด์ตาย)
 *   เอกสารบอกว่าเหนือ ~25 ถือว่าเทรนด์ชัด ต่ำกว่า 20 ถือว่าอ่อน จึงตั้งค่าเริ่มต้นตามนั้น
 *
 *   ทางออกด้วย "ADX ตก" อิงข้อเท็จจริงที่เอกสารระบุว่า ADX ลดไม่ได้ยืนยันการกลับตัว
 *   แต่ในระบบตามเทรนด์ การออกเมื่อเทรนด์หมดแรงคือการยอมรับว่าเงื่อนไขที่ใช้เข้าหมดอายุแล้ว
 */
export const ADX_V2_CORE = {
  adxDiLength: 14,
  adxSmoothLength: 14,
  adxThreshold: 25,
  adxExitThreshold: 20,
};
export interface AdxV2Result extends V2Base {
  adx: Series;
  plusDI: Series;
  minusDI: Series;
}
export function adxV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): AdxV2Result {
  const p = merge(ADX_V2_CORE, params);
  const { plusDI, minusDI, adx } = dmi(k, P(p.adxDiLength), P(p.adxSmoothLength));
  const len = k.length;
  const exitLine = constant(len, p.adxExitThreshold);
  const signal: V2Signal[] = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    const a = adx[i];
    if (a === null) continue;
    if (crossOver(plusDI, minusDI, i) && a >= p.adxThreshold) signal[i] = "BUY";
    else if (crossOver(minusDI, plusDI, i) || crossUnder(adx, exitLine, i)) signal[i] = "SELL";
  }
  return { adx, plusDI, minusDI, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 10) Ichimoku Cloud ═════════════════════════════════════════
/**
 * หลักการ: ใช้จุดกึ่งกลางของกรอบสูงสุด–ต่ำสุดหลายช่วง
 *   Tenkan = (HH(9)+LL(9))/2;  Kijun = (HH(26)+LL(26))/2
 *   Senkou A = (Tenkan+Kijun)/2;  Senkou B = (HH(52)+LL(52))/2  — เลื่อนไปข้างหน้า 26
 *   Chikou = ราคาปิดที่นำไปแสดงย้อนหลัง 26
 *
 * การจัดการ displacement โดยไม่มองอนาคต — จุดสำคัญที่สุดของอินดิเคเตอร์ตัวนี้
 *   เอกสารเตือนว่า "การวาดเมฆไปข้างหน้าเป็นการเลื่อนข้อมูลที่คำนวณได้แล้ว ไม่ใช่ข้อมูลราคาอนาคต"
 *   ดังนั้นเมฆที่ลอยอยู่ "เหนือแท่ง t" คือค่าที่คำนวณจากข้อมูล ณ แท่ง t − 26 ซึ่งรู้ค่าแล้วจริง
 *   โค้ดนี้จึงเก็บ spanAAt/spanBAt = ค่าที่ใช้เทียบกับราคาที่แท่ง t ได้เลย (อ่านจากอดีต)
 *   ส่วน Chikou ที่แท่ง t เทียบกับราคาที่แท่ง t − 26 ก็เป็นข้อมูลอดีตทั้งคู่ ใช้ได้
 *
 * การออกแบบสัญญาณ
 *   เอกสารสรุปการอ่านไว้ว่า "ราคาเหนือเมฆสนับสนุนขาขึ้น ใต้เมฆสนับสนุนขาลง และในเมฆ
 *   บอกภาวะไม่ชัดเจน อ่านร่วมกับ Tenkan/Kijun" กฎพื้นฐานจึงประกอบครบสามชั้นตามนั้น
 *     BUY  = Tenkan ตัดขึ้นเหนือ Kijun + ราคาปิดอยู่เหนือเมฆทั้งก้อน + Chikou ยืนยัน
 *            (ราคาปิดปัจจุบันสูงกว่าราคาปิดเมื่อ displacement แท่งก่อน)
 *     SELL = ราคาปิดหลุดใต้ Kijun (เส้นสมดุลระยะกลาง เป็นจุดออกที่ไวกว่ารอหลุดเมฆ)
 */
export const ICHIMOKU_V2_CORE = {
  ichimokuTenkanLength: 9,
  ichimokuKijunLength: 26,
  ichimokuSenkouBLength: 52,
  ichimokuDisplacement: 26,
};
export interface IchimokuV2Result extends V2Base {
  tenkan: Series;
  kijun: Series;
  /** Senkou A ที่ใช้เทียบกับราคา ณ แท่งนั้นได้ (คำนวณจากแท่ง t − displacement) */
  spanAAt: Series;
  spanBAt: Series;
  /** ตำแหน่งราคาเทียบเมฆ: 1 = เหนือเมฆ, 0 = ในเมฆ, -1 = ใต้เมฆ */
  cloudPosition: Series;
}
export function ichimokuV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): IchimokuV2Result {
  const p = merge(ICHIMOKU_V2_CORE, params);
  const h = highs(k), l = lows(k), c = closes(k);
  const len = k.length;
  const mid = (period: number): Series => {
    const hi = highest(h, period), lo = lowest(l, period);
    const out: Series = new Array(len).fill(null);
    for (let i = 0; i < len; i++) {
      const a = hi[i], b = lo[i];
      if (a !== null && b !== null) out[i] = (a + b) / 2;
    }
    return out;
  };
  const tenkan = mid(P(p.ichimokuTenkanLength));
  const kijun = mid(P(p.ichimokuKijunLength));
  const senkouBRaw = mid(P(p.ichimokuSenkouBLength));
  const disp = P(p.ichimokuDisplacement, 1);
  const spanAAt: Series = new Array(len).fill(null);
  const spanBAt: Series = new Array(len).fill(null);
  for (let i = disp; i < len; i++) {
    const t = tenkan[i - disp], kj = kijun[i - disp], b = senkouBRaw[i - disp];
    if (t !== null && kj !== null) spanAAt[i] = (t + kj) / 2;
    if (b !== null) spanBAt[i] = b;
  }
  const cloudPosition: Series = new Array(len).fill(null);
  const signal: V2Signal[] = new Array(len).fill(null);
  const cSeries: Series = c.slice();
  for (let i = 0; i < len; i++) {
    const a = spanAAt[i], b = spanBAt[i];
    if (a === null || b === null) continue;
    const top = Math.max(a, b), bottom = Math.min(a, b);
    cloudPosition[i] = c[i] > top ? 1 : c[i] < bottom ? -1 : 0;
    const chikouOk = i >= disp && c[i] > c[i - disp];
    if (crossOver(tenkan, kijun, i) && c[i] > top && chikouOk) signal[i] = "BUY";
    else if (crossUnder(cSeries, kijun, i)) signal[i] = "SELL";
  }
  return { tenkan, kijun, spanAAt, spanBAt, cloudPosition, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 11) Supertrend ═════════════════════════════════════════════
/**
 * หลักการ: Mid = (H+L)/2; BasicUpper/Lower = Mid ± factor × ATR
 *   แล้ว "รักษาแนวจากแท่งก่อน" คือแนวล่างขยับขึ้นได้อย่างเดียวขณะราคาปิดยังอยู่เหนือมัน
 *   และแนวบนขยับลงได้อย่างเดียวขณะราคาปิดยังอยู่ใต้มัน
 *
 * เอกสารเน้นว่า "Supertrend จริงมีการรักษาแนวจากแท่งก่อนและสถานะทิศทาง
 * ไม่ใช่แค่เลือก BasicUpper/BasicLower ทุกแท่งใหม่" โค้ดนี้ทำ state machine ตามนั้นครบ
 *
 * การออกแบบสัญญาณ
 *     BUY  = สถานะพลิกจากขาลงเป็นขาขึ้น (ราคาปิดทะลุแนวบนที่รักษาไว้)
 *     SELL = สถานะพลิกจากขาขึ้นเป็นขาลง
 *   ใช้การพลิกสถานะ ไม่ใช่สภาวะ จึงได้สัญญาณครั้งเดียวต่อการเปลี่ยนเทรนด์หนึ่งครั้ง
 *
 * จุดอ่อน: เอกสารระบุว่า "ช่วงออกข้างเกิดการสลับทิศบ่อย" และตัวคูณมากขึ้น
 * ทำให้แนวห่างขึ้นและตอบสนองช้าลง — เป็นการแลกกันตรง ๆ ระหว่างความถี่กับความหน่วง
 */
export const SUPERTREND_V2_CORE = { supertrendAtrLength: 10, supertrendFactor: 3 };
export interface SupertrendV2Result extends V2Base {
  supertrend: Series;
  /** 1 = ขาขึ้น (ใช้แนวล่าง), -1 = ขาลง (ใช้แนวบน) */
  trend: Series;
  upperBand: Series;
  lowerBand: Series;
}
export function supertrendV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): SupertrendV2Result {
  const p = merge(SUPERTREND_V2_CORE, params);
  const h = highs(k), l = lows(k), c = closes(k);
  const len = k.length;
  const atrSeries = atr(k, P(p.supertrendAtrLength));
  const supertrendLine: Series = new Array(len).fill(null);
  const trend: Series = new Array(len).fill(null);
  const upperBand: Series = new Array(len).fill(null);
  const lowerBand: Series = new Array(len).fill(null);
  const signal: V2Signal[] = new Array(len).fill(null);
  let prevUpper: number | null = null, prevLower: number | null = null;
  let prevTrend: 1 | -1 = 1, started = false;
  for (let i = 0; i < len; i++) {
    const a = atrSeries[i];
    if (a === null) continue;
    const mid = (h[i] + l[i]) / 2;
    let upper = mid + p.supertrendFactor * a;
    let lower = mid - p.supertrendFactor * a;
    if (prevLower !== null && prevUpper !== null) {
      // แนวล่างขยับขึ้นได้อย่างเดียวตราบที่ราคาปิดก่อนหน้ายังอยู่เหนือมัน
      lower = c[i - 1] > prevLower ? Math.max(lower, prevLower) : lower;
      upper = c[i - 1] < prevUpper ? Math.min(upper, prevUpper) : upper;
    }
    let current: 1 | -1 = prevTrend;
    if (!started) {
      current = c[i] > mid ? 1 : -1;
      started = true;
    } else if (prevTrend === -1 && prevUpper !== null && c[i] > prevUpper) current = 1;
    else if (prevTrend === 1 && prevLower !== null && c[i] < prevLower) current = -1;

    upperBand[i] = upper;
    lowerBand[i] = lower;
    trend[i] = current;
    supertrendLine[i] = current === 1 ? lower : upper;
    if (current !== prevTrend && i > 0) signal[i] = current === 1 ? "BUY" : "SELL";
    prevUpper = upper; prevLower = lower; prevTrend = current;
  }
  return { supertrend: supertrendLine, trend, upperBand, lowerBand, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 12) VWAP ═══════════════════════════════════════════════════
/**
 * หลักการ: TypicalPrice = (H+L+C)/3;  VWAP = Σ(TP × V) / ΣV สะสมตั้งแต่ Anchor
 *   ผลรวมเริ่มนับใหม่เมื่อเข้าสู่ Anchor period ใหม่ (Session / Week / Month)
 *
 * ข้อควรระวังที่เอกสารระบุไว้โดยตรง
 *   "การใช้ Session บนกราฟรายวันทำให้เริ่มใหม่ทุกแท่งจนไม่เหมาะกับวัตถุประสงค์การสะสม
 *   หลายแท่ง" โค้ดนี้จึงคืนค่า barsSinceAnchor ออกมาให้เห็น ถ้าค่านี้เป็น 0 แทบทุกแท่ง
 *   แปลว่า Anchor ที่เลือกละเอียดกว่าหรือเท่ากับ timeframe ของกราฟ ผลลัพธ์จะไม่มีความหมาย
 *   ต้องเปลี่ยนไปใช้ Anchor ที่ยาวกว่า timeframe เสมอ
 *
 * แถบเบี่ยงเบน: variance = Σ(TP²×V)/ΣV − VWAP² ใช้วัดว่าราคาห่างค่าเฉลี่ยถ่วงน้ำหนักแค่ไหน
 *
 * การออกแบบสัญญาณ
 *   เอกสารให้การอ่านเพียงว่า "ราคาเหนือ VWAP = สูงกว่าค่าเฉลี่ยถ่วงน้ำหนักนับจาก Anchor"
 *   ซึ่งเป็นการแบ่งฝั่ง ไม่ใช่การทำนาย กฎพื้นฐานจึงใช้การข้ามเส้นตรง ๆ
 *     BUY  = ราคาปิดตัดขึ้นเหนือ VWAP และผ่านมาแล้วอย่างน้อย minBarsSinceAnchor แท่งในรอบนี้
 *     SELL = ราคาปิดตัดลงใต้ VWAP
 *   เงื่อนไข minBarsSinceAnchor กันสัญญาณต้นรอบที่ VWAP ยังเท่ากับราคาแท่งเดียว
 */
export const VWAP_V2_CORE = {
  /** 1 = รายวัน (Session), 2 = รายสัปดาห์, 3 = รายเดือน */
  vwapAnchorMode: 1,
  /** ตัวคูณแถบเบี่ยงเบนมาตรฐานรอบ VWAP */
  vwapBandMult: 2,
  /** ต้องผ่านไปกี่แท่งในรอบ Anchor จึงเริ่มรับสัญญาณ */
  vwapMinAnchorBars: 3,
};
export interface VwapV2Result extends V2Base {
  vwap: Series;
  upperBand: Series;
  lowerBand: Series;
  /** ผ่านมากี่แท่งนับจากจุดเริ่ม Anchor ล่าสุด (0 = แท่งแรกของรอบ) */
  barsSinceAnchor: Series;
}
export function vwapV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): VwapV2Result {
  const p = merge(VWAP_V2_CORE, params);
  const len = k.length;
  const mode = Math.min(3, Math.max(1, Math.round(p.vwapAnchorMode)));
  /** คีย์ของรอบ Anchor ตามเวลา UTC */
  const anchorKey = (ms: number): string => {
    const d = new Date(ms);
    if (mode === 3) return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (mode === 2) {
      const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      // จัดกลุ่มเป็นสัปดาห์ที่เริ่มวันจันทร์
      const dow = (new Date(day).getUTCDay() + 6) % 7;
      return String(day - dow * 86400000);
    }
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  };
  const vwapLine: Series = new Array(len).fill(null);
  const upperBand: Series = new Array(len).fill(null);
  const lowerBand: Series = new Array(len).fill(null);
  const barsSinceAnchor: Series = new Array(len).fill(null);
  let key = "", sumPV = 0, sumV = 0, sumP2V = 0, bars = 0;
  for (let i = 0; i < len; i++) {
    const current = anchorKey(k[i].openTime);
    if (current !== key) { key = current; sumPV = 0; sumV = 0; sumP2V = 0; bars = 0; }
    else bars++;
    const tp = (+k[i].high + +k[i].low + +k[i].close) / 3;
    const v = +k[i].volume;
    sumPV += tp * v; sumV += v; sumP2V += tp * tp * v;
    const value = sumV > 0 ? sumPV / sumV : tp;
    vwapLine[i] = value;
    barsSinceAnchor[i] = bars;
    const variance = sumV > 0 ? Math.max(0, sumP2V / sumV - value * value) : 0;
    const dev = Math.sqrt(variance) * p.vwapBandMult;
    upperBand[i] = value + dev;
    lowerBand[i] = value - dev;
  }
  const c = closes(k) as Series;
  const signal: V2Signal[] = new Array(len).fill(null);
  const minBars = Math.max(0, Math.round(p.vwapMinAnchorBars));
  for (let i = 1; i < len; i++) {
    const b = barsSinceAnchor[i];
    if (crossOver(c, vwapLine, i) && b !== null && b >= minBars) signal[i] = "BUY";
    else if (crossUnder(c, vwapLine, i)) signal[i] = "SELL";
  }
  return { vwap: vwapLine, upperBand, lowerBand, barsSinceAnchor, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 13) Volume ═════════════════════════════════════════════════
/**
 * หลักการ: Volume ไม่ใช่สูตรที่อนุมานจากราคา แต่เป็นข้อมูลปริมาณซื้อขายของสัญลักษณ์นั้นโดยตรง
 *   เอกสารให้ตัวอย่างการเทียบไว้ว่า V / SMA(V,20) เท่ากับ 2 หมายถึงปริมาณเป็นสองเท่าของค่าเฉลี่ย
 *
 * การออกแบบสัญญาณ — ข้อจำกัดที่กำหนดรูปแบบทั้งหมด
 *   เอกสารระบุว่า "Volume สูงบอกกิจกรรมมาก ไม่ได้บอกทิศทางสำเร็จแน่นอน การอ่านควรประกอบราคา"
 *   Volume จึงเป็น "ตัวยืนยัน" ไม่ใช่ "ตัวชี้ทิศ" กฎพื้นฐานให้ราคาเป็นคนกำหนดทิศทาง
 *   แล้วใช้ Volume เป็นเงื่อนไขบังคับว่าการเคลื่อนไหวนั้นมีคนเข้าร่วมจริง
 *     BUY  = ราคาปิดทำจุดสูงสุดใหม่ของ breakoutLength แท่งก่อนหน้า (ทิศทางจากราคา)
 *            + Volume ≥ spikeThreshold เท่าของค่าเฉลี่ย (การยืนยันจาก Volume)
 *            + เป็นแท่งเขียวที่ปิดในโซน 60% บนของกรอบแท่ง (แรงซื้อชนะจนจบแท่ง)
 *     SELL = ราคาปิดหลุดจุดต่ำสุดของ breakoutLength แท่งก่อนหน้า
 *            หรือเจอแท่งแดงปริมาณพุ่งที่ปิดในโซน 40% ล่างของกรอบแท่ง (สัญญาณการเทขาย)
 *
 * ข้อควรตรวจก่อนใช้จริง: เอกสารเตือนให้ตรวจว่า Volume ที่ได้เป็นปริมาณซื้อขายจริง
 * Base/Quote volume หรือ Tick volume เพราะแต่ละแหล่งให้ตัวเลขไม่เท่ากัน
 */
export const VOLUME_V2_CORE = {
  volumeAverageLength: 20,
  volumeSpikeThreshold: 1.8,
  volumeBreakoutLength: 20,
};
export interface VolumeV2Result extends V2Base {
  volume: Series;
  volumeAverage: Series;
  /** V / SMA(V, n) — 2 หมายถึงสองเท่าของค่าเฉลี่ย */
  relativeVolume: Series;
  breakoutHigh: Series;
  breakoutLow: Series;
}
export function volumeV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): VolumeV2Result {
  const p = merge(VOLUME_V2_CORE, params);
  const len = k.length;
  const v = volumes(k), c = closes(k), o = opens(k), h = highs(k), l = lows(k);
  const volumeSeries: Series = v.slice();
  const volumeAverage = sma(volumeSeries, P(p.volumeAverageLength));
  const relativeVolume: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const avg = volumeAverage[i];
    if (avg !== null && avg > 0) relativeVolume[i] = v[i] / avg;
  }
  const bo = P(p.volumeBreakoutLength);
  const breakoutHigh: Series = new Array(len).fill(null);
  const breakoutLow: Series = new Array(len).fill(null);
  for (let i = bo; i < len; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - bo; j < i; j++) { hi = Math.max(hi, c[j]); lo = Math.min(lo, c[j]); }
    breakoutHigh[i] = hi;
    breakoutLow[i] = lo;
  }
  const signal: V2Signal[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const rel = relativeVolume[i], hi = breakoutHigh[i], lo = breakoutLow[i];
    if (rel === null || hi === null || lo === null) continue;
    const range = h[i] - l[i];
    const location = range > 0 ? (c[i] - l[i]) / range : 0.5;
    if (c[i] > hi && rel >= p.volumeSpikeThreshold && c[i] > o[i] && location >= 0.6) signal[i] = "BUY";
    else if (c[i] < lo || (rel >= p.volumeSpikeThreshold && c[i] < o[i] && location <= 0.4)) signal[i] = "SELL";
  }
  return { volume: volumeSeries, volumeAverage, relativeVolume, breakoutHigh, breakoutLow, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 14) On Balance Volume ══════════════════════════════════════
/**
 * หลักการ: บวก/ลบ Volume ทั้งแท่งเข้ายอดสะสมตามทิศทางราคาปิดเทียบแท่งก่อน
 *   C(t) > C(t−1) → OBV += V; C(t) < C(t−1) → OBV −= V; เท่ากัน → คงเดิม
 *
 * การออกแบบสัญญาณ
 *   เอกสารเตือนว่า "แท่ง Volume ผิดปกติอาจกระทบยอดสะสมมาก ควรดูรูปทรงและทิศทาง
 *   มากกว่าตัวเลขโดด ๆ" ค่า OBV ดิบจึงเทียบข้ามช่วงเวลาไม่ได้เลย (ขึ้นกับจุดเริ่มสะสม)
 *   วิธีที่ใช้ได้คือเทียบ OBV กับค่าเฉลี่ยของตัวมันเอง ซึ่งเป็นการอ่าน "ทิศทางของยอดสะสม"
 *     BUY  = OBV ตัดขึ้นเหนือ EMA ของ OBV (แรงซื้อสะสมเร่งตัวขึ้น)
 *     SELL = OBV ตัดลงใต้ EMA ของ OBV หรือพบ Bearish divergence
 *
 *   Bearish divergence ในที่นี้นิยามแบบตรวจได้ด้วยเครื่อง: ราคาปิดทำจุดสูงสุดใหม่ของ
 *   divergenceLength แท่ง แต่ OBV ไม่ได้ทำจุดสูงสุดใหม่ในหน้าต่างเดียวกัน
 *   ตรงกับที่เอกสารอธิบายว่า "ราคาขึ้นแต่ OBV อ่อนลง เป็น Divergence ที่ใช้สังเกตความไม่สอดคล้อง"
 *
 * ข้อจำกัดที่ต้องรู้: OBV แบ่ง Volume ทั้งแท่งตามราคาปิด ไม่ใช่การแยกซื้อเชิงรุก/ขายเชิงรุกจริง
 */
export const OBV_V2_CORE = { obvEmaLength: 21, obvDivergenceLength: 30 };
export interface ObvV2Result extends V2Base {
  obv: Series;
  obvEma: Series;
  bullishDivergence: (boolean | null)[];
  bearishDivergence: (boolean | null)[];
}
export function obvV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): ObvV2Result {
  const p = merge(OBV_V2_CORE, params);
  const len = k.length;
  const c = closes(k), v = volumes(k);
  const obvSeries: Series = new Array(len).fill(null);
  let running = 0;
  for (let i = 0; i < len; i++) {
    if (i > 0) running += c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0;
    obvSeries[i] = running;
  }
  const obvEma = ema(obvSeries, P(p.obvEmaLength));
  const dl = P(p.obvDivergenceLength);
  const bullishDivergence: (boolean | null)[] = new Array(len).fill(null);
  const bearishDivergence: (boolean | null)[] = new Array(len).fill(null);
  for (let i = dl; i < len; i++) {
    let priceHigh = -Infinity, priceLow = Infinity, obvHigh = -Infinity, obvLow = Infinity;
    for (let j = i - dl; j < i; j++) {
      priceHigh = Math.max(priceHigh, c[j]);
      priceLow = Math.min(priceLow, c[j]);
      const ov = obvSeries[j];
      if (ov !== null) { obvHigh = Math.max(obvHigh, ov); obvLow = Math.min(obvLow, ov); }
    }
    const ov = obvSeries[i];
    if (ov === null) continue;
    bearishDivergence[i] = c[i] > priceHigh && ov <= obvHigh;
    bullishDivergence[i] = c[i] < priceLow && ov >= obvLow;
  }
  const signal: V2Signal[] = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    if (crossOver(obvSeries, obvEma, i)) signal[i] = "BUY";
    else if (crossUnder(obvSeries, obvEma, i) || bearishDivergence[i]) signal[i] = "SELL";
  }
  return { obv: obvSeries, obvEma, bullishDivergence, bearishDivergence, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 15) Volume Profile ═════════════════════════════════════════
/**
 * หลักการ: กระจาย Volume เป็นแถบตามระดับราคาในช่วงที่เลือก แล้วหา
 *   POC = ระดับราคาที่มี Volume สูงสุด
 *   Value Area = ช่วงราคาที่รวม Volume ตามสัดส่วนที่กำหนด (ปกติ 70%) ขยายออกจาก POC
 *   VAH / VAL = ขอบบน/ขอบล่างของ Value Area
 *
 * การประมาณที่ต้องประกาศให้ชัด
 *   เอกสารระบุว่า TradingView สร้าง Profile จาก "ข้อมูลกรอบเวลาย่อย" ซึ่งเราไม่มีใน backtest นี้
 *   โค้ดนี้จึงประมาณโดยกระจาย Volume ของแต่ละแท่งแบบสม่ำเสมอทั่วช่วง High–Low ของแท่งนั้น
 *   ผลที่ได้ใกล้เคียงแต่ไม่เท่ากับ Volume Profile บน TradingView โดยเฉพาะบน timeframe ใหญ่
 *   ที่หนึ่งแท่งกินช่วงราคากว้าง — ห้ามนำตัวเลข POC/VAH/VAL ไปเทียบกับบนเว็บแบบตรงตัว
 *
 *   ใช้แบบ Fixed Range แบบเลื่อน (rolling) ความยาว profileLength แท่งที่ปิดแล้ว
 *   ไม่ใช้ Visible Range เพราะเอกสารระบุว่ามันเปลี่ยนเมื่อเลื่อนหรือซูมกราฟ ซึ่งทำซ้ำไม่ได้
 *
 * การออกแบบสัญญาณ
 *   เอกสารให้ใช้ Profile "ประกอบการพิจารณาแนวรับต้าน" ไม่ได้ให้กฎซื้อขาย
 *   แนวคิดมาตรฐานของการอ่าน Value Area คือ ราคาที่หลุดออกนอกกรอบมูลค่าแล้วยืนได้
 *   แปลว่าตลาดยอมรับราคาระดับใหม่ กฎพื้นฐานจึงใช้การยอมรับราคา (acceptance) เป็นเกณฑ์
 *     BUY  = ราคาปิดตัดขึ้นเหนือ VAH (ยอมรับราคาเหนือกรอบมูลค่า)
 *     SELL = ราคาปิดตัดลงใต้ POC (กลับเข้าไปในกรอบมูลค่า = การทะลุไม่สำเร็จ)
 *   ใช้ POC เป็นทางออกแทน VAL เพราะรอถึง VAL คือรอให้ราคากลับลงมาสุดกรอบก่อน
 */
export const VOLUME_PROFILE_V2_CORE = {
  /** จำนวนแท่งย้อนหลังที่นำมาสร้าง Profile */
  profileLength: 120,
  /** จำนวนช่องราคาที่แบ่ง Profile */
  profileBinCount: 24,
  /** สัดส่วน Volume ที่นับเป็น Value Area (%) */
  profileValueAreaThreshold: 70,
};
export interface VolumeProfileV2Result extends V2Base {
  poc: Series;
  vah: Series;
  val: Series;
}
export function volumeProfileV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): VolumeProfileV2Result {
  const p = merge(VOLUME_PROFILE_V2_CORE, params);
  const len = k.length;
  const h = highs(k), l = lows(k), c = closes(k), v = volumes(k);
  const window = P(p.profileLength);
  const bins = Math.min(200, P(p.profileBinCount, 4));
  const valueAreaRatio = Math.min(100, Math.max(1, p.profileValueAreaThreshold)) / 100;
  const poc: Series = new Array(len).fill(null);
  const vah: Series = new Array(len).fill(null);
  const val: Series = new Array(len).fill(null);
  const hist = new Float64Array(bins);
  for (let i = window; i < len; i++) {
    // ใช้เฉพาะแท่งที่ปิดแล้วก่อนหน้าแท่งปัจจุบัน เพื่อให้ระดับที่ใช้ตัดสินใจไม่มีข้อมูลแท่งนี้ปน
    const from = i - window, to = i;
    let hi = -Infinity, lo = Infinity;
    for (let j = from; j < to; j++) { hi = Math.max(hi, h[j]); lo = Math.min(lo, l[j]); }
    if (!(hi > lo)) continue;
    hist.fill(0);
    const binSize = (hi - lo) / bins;
    for (let j = from; j < to; j++) {
      const barLow = l[j], barHigh = h[j], barVol = v[j];
      if (barVol <= 0) continue;
      const first = Math.max(0, Math.min(bins - 1, Math.floor((barLow - lo) / binSize)));
      const last = Math.max(0, Math.min(bins - 1, Math.floor((barHigh - lo) / binSize)));
      const span = last - first + 1;
      // กระจาย Volume ของแท่งแบบสม่ำเสมอทั่วช่องที่แท่งนั้นพาดผ่าน
      const share = barVol / span;
      for (let b = first; b <= last; b++) hist[b] += share;
    }
    let pocBin = 0, total = 0;
    for (let b = 0; b < bins; b++) { total += hist[b]; if (hist[b] > hist[pocBin]) pocBin = b; }
    if (total <= 0) continue;
    // ขยาย Value Area ออกจาก POC โดยเลือกฝั่งที่มี Volume มากกว่าทีละก้าว
    let lowBin = pocBin, highBin = pocBin, covered = hist[pocBin];
    const target = total * valueAreaRatio;
    while (covered < target && (lowBin > 0 || highBin < bins - 1)) {
      const below = lowBin > 0 ? hist[lowBin - 1] : -1;
      const above = highBin < bins - 1 ? hist[highBin + 1] : -1;
      if (above >= below) { highBin++; covered += hist[highBin]; }
      else { lowBin--; covered += hist[lowBin]; }
    }
    poc[i] = lo + (pocBin + 0.5) * binSize;
    val[i] = lo + lowBin * binSize;
    vah[i] = lo + (highBin + 1) * binSize;
  }
  const cSeries: Series = c.slice();
  const signal: V2Signal[] = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    if (crossOver(cSeries, vah, i)) signal[i] = "BUY";
    else if (crossUnder(cSeries, poc, i)) signal[i] = "SELL";
  }
  return { poc, vah, val, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 16) Smart Money Concepts (SMC) ═════════════════════════════
/**
 * หลักการ: ตรวจโครงสร้างราคาจาก swing pivot แล้วระบุเหตุการณ์
 *   BOS   (Break of Structure) = ทะลุโครงสร้างไปในทิศเดิม
 *   CHoCH (Change of Character) = ทะลุไปในทิศตรงข้ามกับเทรนด์โครงสร้างเดิม
 *   พร้อมโซน Premium / Equilibrium / Discount วัดจากกรอบ swing ล่าสุด
 *
 * ข้อจำกัดที่ผู้พัฒนาต้นฉบับระบุเอง และมีผลต่อการเขียนโค้ด
 *   "โซนที่วาดเป็นการตีความจากราคา ไม่ได้ยืนยันว่ามีคำสั่งสถาบันอยู่จริง" และ
 *   "เวลาเกิดสัญญาณต้องแยกจากตำแหน่ง Swing ที่นำไปวาดย้อนหลัง"
 *   ข้อหลังคือหัวใจ: pivot ที่แท่ง i จะรู้ว่าเป็น pivot ก็ต่อเมื่อผ่านไปแล้ว swingLength แท่ง
 *   โค้ดนี้จึงใช้ระดับ swing ได้ตั้งแต่แท่ง i + swingLength เท่านั้น (ดู findPivots/confirmedAt)
 *   ถ้าใช้ตำแหน่ง pivot ทันทีที่เกิด ผลทดสอบจะดีเกินจริงเพราะมองอนาคต
 *
 * การออกแบบสัญญาณ
 *   เอกสารระบุว่า BOS ใช้ดูการทะลุในทิศทางเดิม ส่วน CHoCH ใช้สังเกตการเปลี่ยนพฤติกรรม
 *   แล้วจึงดูปฏิกิริยาของราคาต่อโซน กฎพื้นฐานจึงแยกน้ำหนักของสองเหตุการณ์
 *     BUY  = Bullish CHoCH (การกลับตัวของโครงสร้าง — รับได้ทุกโซน)
 *            หรือ Bullish BOS ที่เกิดขณะราคายังไม่อยู่ในโซน Premium
 *            (BOS ในโซนแพงคือไล่ราคาที่ปลายทาง จึงคัดออก)
 *     SELL = Bearish CHoCH หรือ Bearish BOS
 *   ระดับที่ทะลุแล้วจะถูกล้างทิ้งทันที ต้องรอ pivot ใหม่ยืนยัน จึงไม่ยิงสัญญาณซ้ำทุกแท่ง
 */
export const SMC_V2_CORE = {
  /** ความกว้างของ swing pivot (ใช้ทั้งซ้ายและขวา) */
  smcSwingLength: 25,
  /** ขอบเขตโซน Equilibrium รอบกึ่งกลางกรอบ (เช่น 0.1 = 0.45–0.55) */
  smcEquilibriumBand: 0.1,
};
export interface SmcV2Result extends V2Base {
  /** ระดับ swing high/low ที่ยืนยันแล้วและยังไม่ถูกทะลุ */
  swingHigh: Series;
  swingLow: Series;
  /** ตำแหน่งราคาในกรอบ swing: 0 = ก้นกรอบ, 1 = ยอดกรอบ */
  zonePosition: Series;
  /** ทิศโครงสร้าง: 1 = bullish, -1 = bearish */
  structureTrend: Series;
  /** ชนิดเหตุการณ์ที่แท่งนั้น */
  structureEvent: (string | null)[];
  /** Fair Value Gap ขาขึ้นที่เพิ่งเกิด (low[i] > high[i-2]) */
  bullishFvg: (boolean | null)[];
  bearishFvg: (boolean | null)[];
}
export function smcV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): SmcV2Result {
  const p = merge(SMC_V2_CORE, params);
  const len = k.length;
  const c = closes(k), h = highs(k), l = lows(k);
  const swingLen = P(p.smcSwingLength);
  const { pivotHighs, pivotLows } = findPivots(k, swingLen, swingLen);

  const swingHigh: Series = new Array(len).fill(null);
  const swingLow: Series = new Array(len).fill(null);
  const zonePosition: Series = new Array(len).fill(null);
  const structureTrend: Series = new Array(len).fill(null);
  const structureEvent: (string | null)[] = new Array(len).fill(null);
  const bullishFvg: (boolean | null)[] = new Array(len).fill(null);
  const bearishFvg: (boolean | null)[] = new Array(len).fill(null);
  const signal: V2Signal[] = new Array(len).fill(null);

  let hiCursor = 0, loCursor = 0;
  let activeHigh: number | null = null, activeLow: number | null = null;
  // ระดับล่าสุดที่เคยยืนยัน ใช้คำนวณกรอบโซนแม้ระดับฝั่งหนึ่งเพิ่งถูกทะลุ
  let lastHigh: number | null = null, lastLow: number | null = null;
  let trend = 0;

  for (let i = 0; i < len; i++) {
    while (hiCursor < pivotHighs.length && pivotHighs[hiCursor].confirmedAt <= i) {
      activeHigh = pivotHighs[hiCursor].price; lastHigh = activeHigh; hiCursor++;
    }
    while (loCursor < pivotLows.length && pivotLows[loCursor].confirmedAt <= i) {
      activeLow = pivotLows[loCursor].price; lastLow = activeLow; loCursor++;
    }
    swingHigh[i] = activeHigh;
    swingLow[i] = activeLow;

    if (i >= 2) {
      bullishFvg[i] = l[i] > h[i - 2];
      bearishFvg[i] = h[i] < l[i - 2];
    }

    // ตำแหน่งในกรอบ swing ล่าสุด (ใช้ระดับที่ยืนยันแล้วเท่านั้น)
    let position: number | null = null;
    if (lastHigh !== null && lastLow !== null && lastHigh > lastLow)
      position = (c[i] - lastLow) / (lastHigh - lastLow);
    zonePosition[i] = position;

    const band = Math.max(0, Math.min(0.9, p.smcEquilibriumBand)) / 2;
    const premium = position !== null && position > 0.5 + band;

    if (activeHigh !== null && c[i] > activeHigh) {
      const event = trend === -1 ? "CHoCH" : "BOS";
      structureEvent[i] = `Bullish ${event}`;
      if (event === "CHoCH" || !premium) signal[i] = "BUY";
      trend = 1;
      activeHigh = null; // ระดับถูกใช้ไปแล้ว ต้องรอ pivot ใหม่
    } else if (activeLow !== null && c[i] < activeLow) {
      const event = trend === 1 ? "CHoCH" : "BOS";
      structureEvent[i] = `Bearish ${event}`;
      signal[i] = "SELL";
      trend = -1;
      activeLow = null;
    }
    structureTrend[i] = trend === 0 ? null : trend;
  }
  return {
    swingHigh, swingLow, zonePosition, structureTrend, structureEvent,
    bullishFvg, bearishFvg, signal, ...withFilter(k, signal, params, startIndex),
  };
}

// ══ 17) Squeeze Momentum Indicator [LazyBear] ══════════════════
/**
 * หลักการ: เทียบ Bollinger Bands กับ Keltner Channels
 *   ถ้า BB อยู่ภายใน KC ทั้งสองด้าน = ภาวะ Squeeze (ความผันผวนถูกบีบ)
 *   ถ้า BB ออกนอก KC ทั้งสองด้าน = Squeeze คลายตัว
 *   Histogram โมเมนตัมใช้ linear regression ของส่วนต่างราคาปิดกับกึ่งกลางของกรอบ
 *
 * จุดที่ v2 แก้จาก v1 — สำคัญ
 *   v1 คำนวณ sqzOn/sqzOff ไว้แต่ "ไม่ได้ใช้ในเงื่อนไขส่งสัญญาณเลย" เหลือแค่โมเมนตัมข้ามศูนย์
 *   ซึ่งทิ้งแก่นของอินดิเคเตอร์ตัวนี้ไปทั้งหมด เพราะชื่อและกลไกของมันคือ "Squeeze"
 *   v2 บังคับให้การเข้าต้องมาจากการคลายตัวของ Squeeze จริง ตามคำอธิบายต้นฉบับ
 *     BUY  = Squeeze เพิ่งคลายตัวภายใน setupBars แท่ง + โมเมนตัม > 0 + โมเมนตัมกำลังเพิ่ม
 *     SELL = โมเมนตัมตัดลงใต้ศูนย์
 *   เอกสารเตือนว่า "การคลายตัวเพียงอย่างเดียวไม่บอกว่าจะขึ้นหรือลง"
 *   จึงต้องให้ทิศทางมาจากเครื่องหมายและความชันของ Histogram ไม่ใช่จากการคลายตัวเอง
 *
 * หมายเหตุเวอร์ชัน: ต้นฉบับเคยมีปัญหาตัวคูณ BB ติดค่า 1.5 ค่าเริ่มต้นที่ใช้ที่นี่คือ BB 2.0 / KC 1.5
 */
export const SQUEEZE_V2_CORE = {
  squeezeBbLength: 20,
  squeezeBbMult: 2,
  squeezeKcLength: 20,
  squeezeKcMult: 1.5,
  /** Squeeze คลายตัวแล้วยังนับว่าเป็นจังหวะตั้งท่าได้กี่แท่ง */
  squeezeSetupBars: 6,
};
export interface SqueezeV2Result extends V2Base {
  momentum: Series;
  squeezeOn: (boolean | null)[];
  squeezeOff: (boolean | null)[];
}
export function squeezeV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): SqueezeV2Result {
  const p = merge(SQUEEZE_V2_CORE, params);
  const len = k.length;
  const c = closes(k), h = highs(k), l = lows(k);
  const bbLen = P(p.squeezeBbLength), kcLen = P(p.squeezeKcLength);
  const basis = sma(c, bbLen);
  const dev = stdev(c, bbLen);
  const kcBasis = sma(c, kcLen);
  const rangeMa = sma(trueRange(k) as Series, kcLen);
  const squeezeOn: (boolean | null)[] = new Array(len).fill(null);
  const squeezeOff: (boolean | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const b = basis[i], d = dev[i], kb = kcBasis[i], r = rangeMa[i];
    if (b === null || d === null || kb === null || r === null) continue;
    const bbUpper = b + p.squeezeBbMult * d, bbLower = b - p.squeezeBbMult * d;
    const kcUpper = kb + p.squeezeKcMult * r, kcLower = kb - p.squeezeKcMult * r;
    squeezeOn[i] = bbLower > kcLower && bbUpper < kcUpper;
    squeezeOff[i] = bbLower < kcLower && bbUpper > kcUpper;
  }
  // source = close − avg( avg(HH(len), LL(len)), SMA(close,len) )
  const hh = highest(h, kcLen), ll = lowest(l, kcLen), meanClose = sma(c, kcLen);
  const source: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const a = hh[i], b = ll[i], m = meanClose[i];
    if (a === null || b === null || m === null) continue;
    source[i] = c[i] - ((a + b) / 2 + m) / 2;
  }
  const momentum = linreg(source, kcLen, 0);
  const setup = P(p.squeezeSetupBars, 1);
  const signal: V2Signal[] = new Array(len).fill(null);
  const zero = constant(len, 0);
  for (let i = 1; i < len; i++) {
    const m = momentum[i], mPrev = momentum[i - 1];
    if (m === null || mPrev === null) continue;
    // "เพิ่งคลายตัว" = แท่งก่อนหน้าใน setup อยู่ใน squeeze แล้วแท่งนี้ไม่อยู่แล้ว
    let released = false;
    for (let j = Math.max(1, i - setup); j <= i; j++) if (squeezeOn[j - 1] && !squeezeOn[j]) { released = true; break; }
    if (released && m > 0 && m > mPrev) signal[i] = "BUY";
    else if (crossUnder(momentum, zero, i)) signal[i] = "SELL";
  }
  return { momentum, squeezeOn, squeezeOff, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 18) WaveTrend Oscillator [LazyBear] ════════════════════════
/**
 * หลักการ: ปรับเรียบราคาแล้ววัดความเบี่ยงเบนเทียบค่าเฉลี่ยของความเบี่ยงเบนเอง
 *   esa = EMA(HLC3, channelLength)
 *   d   = EMA(|HLC3 − esa|, channelLength)
 *   ci  = (HLC3 − esa) / (0.015 × d)        ← ตัวหาร 0.015 ทำให้สเกลใกล้เคียง CCI
 *   wt1 = EMA(ci, averageLength);  wt2 = SMA(wt1, smoothLength)
 *
 * การออกแบบสัญญาณ — ทำตามที่ผู้พัฒนาต้นฉบับยกตัวอย่างไว้ตรง ๆ
 *   "เส้นหลักตัดลงใต้ Signal ในเขต Overbought เป็นเงื่อนไขฝั่งขาย
 *    และตัดขึ้นเหนือ Signal ในเขต Oversold เป็นเงื่อนไขฝั่งซื้อ"
 *     BUY  = wt1 ตัดขึ้นเหนือ wt2 ขณะ wt2 ≤ ระดับ Oversold
 *     SELL = wt1 ตัดลงใต้ wt2 ขณะ wt2 ≥ ระดับ Overbought
 *
 * ข้อจำกัด: เอกสารระบุว่า "การตัดเส้นอาจเกิดบ่อยและราคาอาจไปต่อสวนสัญญาณ"
 * และสูตรต้นฉบับไม่ได้เปิดเผยครบทุกบรรทัด ค่าที่ได้จึงอาจต่างจากสคริปต์บนเว็บเล็กน้อย
 */
export const WAVETREND_V2_CORE = {
  wtChannelLength: 10,
  wtAverageLength: 21,
  wtSmoothLength: 4,
  wtOverboughtThreshold: 60,
  wtOversoldThreshold: -60,
};
export interface WaveTrendV2Result extends V2Base {
  wt1: Series;
  wt2: Series;
  /** wt1 − wt2 ใช้ดูแรงส่งของการตัดกัน */
  wtDiff: Series;
}
export function waveTrendV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): WaveTrendV2Result {
  const p = merge(WAVETREND_V2_CORE, params);
  const len = k.length;
  const src = hlc3(k) as Series;
  const n1 = P(p.wtChannelLength), n2 = P(p.wtAverageLength);
  const esa = ema(src, n1);
  const absDiff: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const s = src[i], e = esa[i];
    if (s !== null && e !== null) absDiff[i] = Math.abs(s - e);
  }
  const d = ema(absDiff, n1);
  const ci: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const s = src[i], e = esa[i], dv = d[i];
    if (s === null || e === null || dv === null || dv === 0) continue;
    ci[i] = (s - e) / (0.015 * dv);
  }
  const wt1 = ema(ci, n2);
  const wt2 = sma(wt1, P(p.wtSmoothLength, 1));
  const wtDiff: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const a = wt1[i], b = wt2[i];
    if (a !== null && b !== null) wtDiff[i] = a - b;
  }
  const signal: V2Signal[] = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    const b = wt2[i];
    if (b === null) continue;
    if (crossOver(wt1, wt2, i) && b <= p.wtOversoldThreshold) signal[i] = "BUY";
    else if (crossUnder(wt1, wt2, i) && b >= p.wtOverboughtThreshold) signal[i] = "SELL";
  }
  return { wt1, wt2, wtDiff, signal, ...withFilter(k, signal, params, startIndex, "reversion") };
}

// ══ 19) UT Bot Alerts ══════════════════════════════════════════
/**
 * หลักการ: ระยะห่างพื้นฐาน = Sensitivity × ATR(length) แล้วสร้าง trailing stop
 *   ที่ขยับตามราคาและสถานะของแท่งก่อนหน้า
 *     ราคาอยู่เหนือแนวทั้งแท่งนี้และแท่งก่อน → แนวขยับขึ้นได้อย่างเดียว (max)
 *     ราคาอยู่ใต้แนวทั้งสองแท่ง            → แนวขยับลงได้อย่างเดียว (min)
 *     นอกนั้นรีเซ็ตแนวใหม่จากราคาปัจจุบัน
 *
 * การออกแบบสัญญาณ
 *     BUY  = ราคาปิดตัดขึ้นเหนือ trailing stop (แท่งก่อนอยู่ใต้หรือเท่า แท่งนี้อยู่เหนือ)
 *     SELL = ราคาปิดตัดลงใต้ trailing stop
 *   ใช้จุดตัดจริง ไม่ใช่สภาวะ จึงได้สัญญาณครั้งเดียวต่อการพลิกฝั่งหนึ่งครั้ง
 *
 * ข้อควรระวังที่เอกสารระบุ: เส้น Trailing stop ที่ใช้สร้างสัญญาณ
 * "ไม่ได้เท่ากับมีคำสั่ง Stop ถูกส่งไปยังตลาดแล้ว" และช่วงออกข้างจะสลับสัญญาณบ่อย
 * อนึ่ง บทความอ้างอิงของผู้เผยแพร่เป็นการพอร์ตไป TradeStation
 * จึงไม่ยืนยันว่าวิธีเกลี่ย ATR ทุกจุดตรงกับ Pine Script ต้นฉบับ — ที่นี่ใช้ RMA ตามค่าเริ่มต้นของ TradingView
 */
export const UT_BOT_V2_CORE = { utBotKeyValue: 1, utBotAtrLength: 10 };
export interface UtBotV2Result extends V2Base {
  trailingStop: Series;
  /** 1 = ราคาอยู่เหนือแนว, -1 = อยู่ใต้แนว */
  position: Series;
}
export function utBotV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): UtBotV2Result {
  const p = merge(UT_BOT_V2_CORE, params);
  const len = k.length;
  const c = closes(k);
  const atrSeries = atr(k, P(p.utBotAtrLength));
  const trailingStop: Series = new Array(len).fill(null);
  const position: Series = new Array(len).fill(null);
  const signal: V2Signal[] = new Array(len).fill(null);
  let prevStop: number | null = null;
  for (let i = 0; i < len; i++) {
    const a = atrSeries[i];
    if (a === null) continue;
    const nLoss = p.utBotKeyValue * a;
    const src = c[i];
    const prevSrc = i > 0 ? c[i - 1] : src;
    let stop: number;
    if (prevStop === null) stop = src - nLoss; // แท่งแรกที่มี ATR: ตั้งแนวใต้ราคา
    else if (src > prevStop && prevSrc > prevStop) stop = Math.max(prevStop, src - nLoss);
    else if (src < prevStop && prevSrc < prevStop) stop = Math.min(prevStop, src + nLoss);
    else if (src > prevStop) stop = src - nLoss;
    else stop = src + nLoss;
    trailingStop[i] = stop;
    position[i] = src > stop ? 1 : -1;
    if (prevStop !== null) {
      if (prevSrc <= prevStop && src > stop) signal[i] = "BUY";
      else if (prevSrc >= prevStop && src < stop) signal[i] = "SELL";
    }
    prevStop = stop;
  }
  return { trailingStop, position, signal, ...withFilter(k, signal, params, startIndex) };
}

// ══ 20) Machine Learning: Lorentzian Classification ════════════
/**
 * หลักการ: แปลงราคาเป็นคุณลักษณะหลายมิติ (RSI, WaveTrend, CCI, ADX) แล้วค้นหาตัวอย่าง
 * ในอดีตที่ "หน้าตาคล้ายกันที่สุด" ด้วยระยะทางแบบ Lorentzian ผ่านวิธี Approximate
 * Nearest Neighbors จากนั้นรวมป้ายกำกับของเพื่อนบ้านเป็นการจำแนกทิศทาง
 *
 *   Lorentzian distance = Σ log(1 + |x_i − y_i|)
 *   ใช้ log แทนระยะทางแบบยุคลิด เพราะทำให้ความต่างที่ใหญ่ผิดปกติ (ข่าว/เหตุการณ์)
 *   ไม่ครอบงำการวัดความคล้าย ระยะทางจึงทนต่อค่าผิดปกติมากกว่า
 *
 * การจำลองกลไกต้นฉบับ (jdehorty) ให้ตรง
 *   1. คุณลักษณะเริ่มต้น 5 ตัว: RSI(14,1), WaveTrend(10,11), CCI(20,1), ADX(20), RSI(9,1)
 *      ทุกตัวถูกปรับสเกลเป็น 0–1 ด้วย rescale (ช่วงคงที่) หรือ normalize (min/max สะสม)
 *   2. ป้ายกำกับ y_train ที่แท่ง j เทียบ close[j−4] กับ close[j]
 *      close[j−4] < close[j] → short(−1); close[j−4] > close[j] → long(+1); เท่ากัน → 0
 *      นี่คือสูตรตามต้นฉบับตรงตัว ผลคือโมเดลมีลักษณะสวนการเคลื่อนไหว 4 แท่งล่าสุด
 *   2ข. ชุดแท่งที่นำมาค้น: ต้นฉบับวนแท่งที่ 0..maxBarsBack-1 ซึ่งคือ "แท่งเก่าที่สุด" ของชุดข้อมูล
 *      ไม่ใช่แท่งล่าสุด (เพราะใช้ array.push แล้ว array.get(i) โดย i = 0 คือแท่งแรกของกราฟ)
 *      พารามิเตอร์ lorentzianNeighborPool ให้เลือกได้ระหว่างพฤติกรรมนี้กับหน้าต่างเลื่อน
 *   3. การค้นเพื่อนบ้านแบบ ANN ที่เว้นจังหวะ: ข้ามแท่งที่ i % 4 == 0 และรับเฉพาะแท่งที่
 *      ระยะทาง "มากกว่าหรือเท่ากับ" ระยะทางล่าสุดที่รับไว้ เป็นการสุ่มกระจายตัวอย่าง
 *      ให้ไม่กระจุกอยู่ช่วงเวลาเดียวกัน เมื่อครบ neighborsCount จะยกระดับเกณฑ์ไปที่
 *      ควอนไทล์ที่ 75 ของระยะทางที่เก็บไว้ แล้วทิ้งตัวเก่าสุดออก
 *   4. prediction = ผลรวมป้ายกำกับของเพื่อนบ้านที่เก็บได้ (ช่วง −neighbors ถึง +neighbors)
 *
 * เรื่องการมองอนาคต: การวนหาเพื่อนบ้านที่แท่ง t ใช้เฉพาะแท่ง 0..t−1 เท่านั้น
 * และป้ายกำกับของแท่งเหล่านั้นคำนวณจากราคาที่เกิดขึ้นแล้วทั้งหมด จึงไม่มี lookahead
 *
 * ตัวกรองประกอบตามต้นฉบับ
 *   Volatility filter  — ATR สั้น > ATR ยาว (ตลาดต้องมีการเคลื่อนไหวจริง)
 *   Regime filter      — ความชันของเส้น KLMF ต้องไม่ติดลบเกินเกณฑ์ (เลี่ยงตลาดออกข้าง)
 *   ADX filter         — ค่าเริ่มต้นปิดไว้ตามต้นฉบับ
 *   Kernel regression  — Nadaraya-Watson แบบ Rational Quadratic ใช้ยืนยันทิศของเส้นประมาณค่า
 *
 * ข้อจำกัดที่ผู้พัฒนาระบุเอง: ตาราง Trade Stats ภายใน "ใช้แทนการ Backtest เต็มรูปแบบไม่ได้"
 * และคำว่า Machine Learning ไม่ใช่หลักฐานว่าแม่นกว่าวิธีอื่น
 * ค่า prediction ไม่ใช่ความน่าจะเป็นที่สอบเทียบแล้ว เป็นเพียงผลรวมป้ายกำกับ
 *
 * ต้นทุนการคำนวณ: O(จำนวนแท่ง × maxBarsBack × จำนวนคุณลักษณะ)
 * ที่ 10,000 แท่งและ maxBarsBack 2000 คือราว 100 ล้านรอบ ใช้เวลาหลายวินาที
 * ถ้าต้องการเร็วขึ้นให้ลด maxBarsBack ลง ซึ่งจะเปลี่ยนผลลัพธ์ด้วย
 */
export const LORENTZIAN_V2_CORE = {
  /** จำนวนเพื่อนบ้านที่ใช้โหวต (ต้นฉบับเริ่มต้นที่ 8) */
  lorentzianNeighborsCount: 8,
  /** จำนวนแท่งย้อนหลังสูงสุดที่นำมาค้นหา */
  lorentzianMaxBarsBack: 2000,
  /** ใช้คุณลักษณะกี่ตัว (2–5 ตามลำดับ RSI14, WT, CCI, ADX, RSI9) */
  lorentzianFeatureCount: 5,
  /** 1 = เปิดตัวกรองความผันผวน */
  lorentzianUseVolatilityFilter: 1,
  /** 1 = เปิดตัวกรองสภาพตลาด (KLMF) */
  lorentzianUseRegimeFilter: 1,
  /** เกณฑ์ความชัน KLMF ที่ยอมรับได้ */
  lorentzianRegimeThreshold: -0.1,
  /** 1 = เปิดตัวกรอง ADX (ต้นฉบับปิดไว้) */
  lorentzianUseAdxFilter: 0,
  lorentzianAdxThreshold: 20,
  /** 1 = เปิดตัวกรอง EMA ทิศทาง (ต้นฉบับปิดไว้) */
  lorentzianUseEmaFilter: 0,
  lorentzianEmaLength: 200,
  /** 1 = เปิดตัวกรอง SMA ทิศทาง (ต้นฉบับปิดไว้) */
  lorentzianUseSmaFilter: 0,
  lorentzianSmaLength: 200,
  /** 1 = เปิด Kernel regression filter */
  lorentzianUseKernelFilter: 1,
  /** ความกว้างของ kernel (lookback) */
  lorentzianKernelLookback: 8,
  /** น้ำหนักสัมพัทธ์ของ Rational Quadratic kernel */
  lorentzianKernelWeight: 8,
  /** เริ่มถ่วงน้ำหนักที่แท่งใด */
  lorentzianKernelStartBar: 25,
  /** จำนวนแท่งถือสูงสุดตามกติกา 4 แท่งของต้นฉบับ */
  lorentzianMaxHoldBars: 4,
  /**
   * ชุดแท่งที่ใช้ค้นเพื่อนบ้าน
   *   1 = ตามต้นฉบับ Pine ตรงตัว — วนแท่งที่ 0..maxBarsBack-1 คือ "แท่งเก่าที่สุด" ของชุดข้อมูล
   *       (ต้นฉบับใช้ array.push แล้ว array.get(i) โดย i = 0 คือแท่งแรกสุดของกราฟ)
   *   2 = หน้าต่างเลื่อน — วน maxBarsBack แท่งล่าสุดก่อนแท่งปัจจุบัน
   *
   * ค่าเริ่มต้นเป็น 1 เพื่อให้ตรงกับสคริปต์ที่เผยแพร่ แต่ควรรู้ว่าบนชุดข้อมูลยาว ๆ
   * โหมด 1 จะเทียบทุกแท่งกับ "ช่วงต้นของข้อมูล" ตลอดไป ซึ่งมักไม่ใช่สิ่งที่ต้องการใน backtest
   * ถ้าจะใช้ประเมินกลยุทธ์จริงบนข้อมูลหลายพันแท่ง ให้เลือกโหมด 2
   */
  lorentzianNeighborPool: 1,
};
export interface LorentzianV2Result extends V2Base {
  /** ผลรวมป้ายกำกับของเพื่อนบ้าน (บวก = ฝั่งซื้อ, ลบ = ฝั่งขาย) */
  prediction: Series;
  /** ทิศทางหลังผ่านตัวกรองทุกชั้น: 1 = long, -1 = short, 0 = ไม่มีทิศ */
  direction: Series;
  /** ผ่านตัวกรองทุกชั้นหรือไม่ */
  filterAll: (boolean | null)[];
  /** เส้นประมาณค่าแบบ Rational Quadratic */
  kernelEstimate: Series;
}

/** CCI มาตรฐาน: (src − SMA) / (0.015 × ค่าเฉลี่ยส่วนเบี่ยงเบนสัมบูรณ์) */
function cci(src: Series, period: number): Series {
  const len = src.length;
  const mean = sma(src, period);
  const out: Series = new Array(len).fill(null);
  for (let i = period - 1; i < len; i++) {
    const m = mean[i];
    if (m === null) continue;
    let dev = 0, ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      const v = src[j];
      if (v === null) { ok = false; break; }
      dev += Math.abs(v - m);
    }
    if (!ok) continue;
    dev /= period;
    const s = src[i];
    if (s === null) continue;
    out[i] = dev === 0 ? 0 : (s - m) / (0.015 * dev);
  }
  return out;
}

/** ปรับสเกลแบบช่วงคงที่ (ใช้กับตัวที่มีขอบเขตแน่นอนอย่าง RSI/ADX) */
function rescaleSeries(data: Series, oldMin: number, oldMax: number): Series {
  return data.map(v => (v === null ? null : rescale(v, oldMin, oldMax, 0, 1)));
}

/** ADX ฉบับ Lorentzian: ใช้ผลรวมเลื่อนแบบ Wilder แล้วปรับสเกลเป็น 0–1 */
function lorentzianAdx(k: KlineData[], period: number): Series {
  const len = k.length;
  const h = highs(k), l = lows(k), c = closes(k);
  const dx: Series = new Array(len).fill(null);
  let trSmooth = 0, plusSmooth = 0, minusSmooth = 0;
  for (let i = 0; i < len; i++) {
    const prevClose = i > 0 ? c[i - 1] : c[i];
    const tr = Math.max(h[i] - l[i], Math.abs(h[i] - prevClose), Math.abs(l[i] - prevClose));
    const upMove = i > 0 ? h[i] - h[i - 1] : 0;
    const downMove = i > 0 ? l[i - 1] - l[i] : 0;
    const plusDM = upMove > downMove ? Math.max(upMove, 0) : 0;
    const minusDM = downMove > upMove ? Math.max(downMove, 0) : 0;
    trSmooth = trSmooth - trSmooth / period + tr;
    plusSmooth = plusSmooth - plusSmooth / period + plusDM;
    minusSmooth = minusSmooth - minusSmooth / period + minusDM;
    if (trSmooth === 0) continue;
    const diPlus = (plusSmooth / trSmooth) * 100;
    const diMinus = (minusSmooth / trSmooth) * 100;
    const sum = diPlus + diMinus;
    dx[i] = sum === 0 ? 0 : (Math.abs(diPlus - diMinus) / sum) * 100;
  }
  return rescaleSeries(rma(dx, period), 0, 100);
}

/** WaveTrend ที่ปรับสเกลแล้ว สำหรับใช้เป็นคุณลักษณะ */
function lorentzianWaveTrend(k: KlineData[], n1: number, n2: number): Series {
  const src = hlc3(k) as Series;
  const len = src.length;
  const esa = ema(src, n1);
  const absDiff: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const s = src[i], e = esa[i];
    if (s !== null && e !== null) absDiff[i] = Math.abs(s - e);
  }
  const d = ema(absDiff, n1);
  const ci: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const s = src[i], e = esa[i], dv = d[i];
    if (s === null || e === null || dv === null || dv === 0) continue;
    ci[i] = (s - e) / (0.015 * dv);
  }
  const wt1 = ema(ci, n2);
  const wt2 = sma(wt1, 4);
  const diff: Series = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const a = wt1[i], b = wt2[i];
    if (a !== null && b !== null) diff[i] = a - b;
  }
  return normalizeRunning(diff, 0, 1);
}

/** Nadaraya-Watson แบบ Rational Quadratic (ใช้เฉพาะข้อมูลอดีต) */
function rationalQuadraticKernel(src: number[], lookback: number, weight: number, startAtBar: number): Series {
  const len = src.length;
  const out: Series = new Array(len).fill(null);
  const span = startAtBar + 1;
  const weights: number[] = [];
  for (let i = 0; i <= span; i++)
    weights.push(Math.pow(1 + (i * i) / (lookback * lookback * 2 * weight), -weight));
  for (let t = 0; t < len; t++) {
    if (t < span) continue;
    let num = 0, den = 0;
    for (let i = 0; i <= span; i++) { num += src[t - i] * weights[i]; den += weights[i]; }
    out[t] = den === 0 ? null : num / den;
  }
  return out;
}

/** Nadaraya-Watson แบบ Gaussian ใช้เป็นเส้นเปรียบเทียบที่เรียบกว่า */
function gaussianKernel(src: number[], lookback: number, startAtBar: number): Series {
  const len = src.length;
  const out: Series = new Array(len).fill(null);
  const span = startAtBar + 1;
  const weights: number[] = [];
  for (let i = 0; i <= span; i++) weights.push(Math.exp(-(i * i) / (2 * lookback * lookback)));
  for (let t = 0; t < len; t++) {
    if (t < span) continue;
    let num = 0, den = 0;
    for (let i = 0; i <= span; i++) { num += src[t - i] * weights[i]; den += weights[i]; }
    out[t] = den === 0 ? null : num / den;
  }
  return out;
}

/** ตัวกรองสภาพตลาดแบบ KLMF ตามต้นฉบับ */
function regimeFilter(k: KlineData[], threshold: number): (boolean | null)[] {
  const len = k.length;
  const src = ohlc4(k), h = highs(k), l = lows(k);
  const absSlope: Series = new Array(len).fill(null);
  let value1 = 0, value2 = 0, klmf = 0, prevKlmf: number | null = null;
  for (let i = 0; i < len; i++) {
    const change = i > 0 ? src[i] - src[i - 1] : 0;
    value1 = 0.2 * change + 0.8 * value1;
    value2 = 0.1 * (h[i] - l[i]) + 0.8 * value2;
    const omega = value2 === 0 ? 0 : Math.abs(value1 / value2);
    const alpha = (-(omega * omega) + Math.sqrt(Math.pow(omega, 4) + 6 * omega * omega)) / 2;
    klmf = alpha * src[i] + (1 - alpha) * klmf;
    absSlope[i] = prevKlmf === null ? null : Math.abs(klmf - prevKlmf);
    prevKlmf = klmf;
  }
  const avgSlope = ema(absSlope, 200);
  const out: (boolean | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const s = absSlope[i], a = avgSlope[i];
    if (s === null || a === null || a === 0) continue;
    out[i] = (s - a) / a >= threshold;
  }
  return out;
}

export function lorentzianV2(k: KlineData[], params: Record<string, number> = {}, startIndex = 0): LorentzianV2Result {
  const p = merge(LORENTZIAN_V2_CORE, params);
  const len = k.length;
  const c = closes(k);
  const cSeries: Series = c.slice();

  // ── 1) คุณลักษณะ ปรับสเกล 0–1 ทั้งหมด ──────────────────────
  const rsi14 = rescaleSeries(ema(rsiV2(k, { rsiLength: 14 }).rsi, 1), 0, 100);
  const wt = lorentzianWaveTrend(k, 10, 11);
  const cciFeature = normalizeRunning(ema(cci(cSeries, 20), 1), 0, 1);
  const adxFeature = lorentzianAdx(k, 20);
  const rsi9 = rescaleSeries(ema(rsiV2(k, { rsiLength: 9 }).rsi, 1), 0, 100);
  const allFeatures = [rsi14, wt, cciFeature, adxFeature, rsi9];
  const featureCount = Math.min(5, Math.max(2, Math.round(p.lorentzianFeatureCount)));
  const features = allFeatures.slice(0, featureCount);
  // แปลงเป็น Float64Array เพื่อให้ลูปค้นหาเพื่อนบ้านเร็วที่สุด (NaN = ยังไม่มีค่า)
  const featureData = features.map(f => Float64Array.from(f.map(v => (v === null ? NaN : v))));

  // ── 2) ป้ายกำกับตามต้นฉบับ: เทียบ close[j−4] กับ close[j] ──
  const labels = new Int8Array(len);
  for (let i = 4; i < len; i++) labels[i] = c[i - 4] < c[i] ? -1 : c[i - 4] > c[i] ? 1 : 0;

  // ── 3) ตัวกรอง ───────────────────────────────────────────
  const atrRecent = atr(k, 1);
  const atrHistoric = atr(k, 10);
  const regime = regimeFilter(k, p.lorentzianRegimeThreshold);
  const adxNorm = lorentzianAdx(k, 14);
  const emaFilter = ema(cSeries, P(p.lorentzianEmaLength));
  const smaFilter = sma(cSeries, P(p.lorentzianSmaLength));
  const kernelEstimate = rationalQuadraticKernel(
    c, Math.max(1, p.lorentzianKernelLookback), Math.max(0.1, p.lorentzianKernelWeight), P(p.lorentzianKernelStartBar, 2),
  );
  const kernelSmooth = gaussianKernel(
    c, Math.max(1, p.lorentzianKernelLookback - 2), P(p.lorentzianKernelStartBar, 2),
  );

  // ── 4) ค้นหาเพื่อนบ้านแบบ ANN ────────────────────────────
  const neighbors = Math.max(1, Math.round(p.lorentzianNeighborsCount));
  const maxBarsBack = Math.max(50, Math.round(p.lorentzianMaxBarsBack));
  const prediction: Series = new Array(len).fill(null);
  const distances: number[] = [];
  const votes: number[] = [];
  const quantileIndex = Math.round((neighbors * 3) / 4);
  for (let t = 0; t < len; t++) {
    if (t < maxBarsBack) continue;
    let ready = true;
    for (const f of featureData) if (Number.isNaN(f[t])) { ready = false; break; }
    if (!ready) continue;
    distances.length = 0;
    votes.length = 0;
    let lastDistance = -1;
    const rolling = p.lorentzianNeighborPool >= 1.5;
    const poolStart = rolling ? Math.max(0, t - maxBarsBack) : 0;
    const poolEnd = rolling ? t - 1 : Math.min(maxBarsBack - 1, t - 1);
    for (let i = poolStart; i <= poolEnd; i++) {
      if (i % 4 === 0) continue; // เว้นจังหวะตามต้นฉบับ
      let d = 0, valid = true;
      for (const f of featureData) {
        const a = f[t], b = f[i];
        if (Number.isNaN(b)) { valid = false; break; }
        d += Math.log(1 + Math.abs(a - b));
      }
      if (!valid || d < lastDistance) continue;
      lastDistance = d;
      distances.push(d);
      votes.push(labels[i]);
      if (votes.length > neighbors) {
        lastDistance = distances[Math.min(quantileIndex, distances.length - 1)];
        distances.shift();
        votes.shift();
      }
    }
    let sum = 0;
    for (const v of votes) sum += v;
    prediction[t] = sum;
  }

  // ── 5) รวมตัวกรองและสร้างสัญญาณ ──────────────────────────
  const filterAll: (boolean | null)[] = new Array(len).fill(null);
  const direction: Series = new Array(len).fill(null);
  const signal: V2Signal[] = new Array(len).fill(null);
  let currentDirection = 0, prevDirection = 0;
  let inPosition = false, entryIdx = 0;
  const maxHold = Math.max(1, Math.round(p.lorentzianMaxHoldBars));

  for (let i = 0; i < len; i++) {
    const pred = prediction[i];
    const ar = atrRecent[i], ah = atrHistoric[i];
    const volatilityOk = p.lorentzianUseVolatilityFilter < 0.5 ? true : ar !== null && ah !== null && ar > ah;
    const regimeOk = p.lorentzianUseRegimeFilter < 0.5 ? true : regime[i] === true;
    const adxValue = adxNorm[i];
    const adxOk = p.lorentzianUseAdxFilter < 0.5 ? true : adxValue !== null && adxValue * 100 > p.lorentzianAdxThreshold;
    const passed = volatilityOk && regimeOk && adxOk;
    filterAll[i] = passed;

    prevDirection = currentDirection;
    if (pred !== null && pred > 0 && passed) currentDirection = 1;
    else if (pred !== null && pred < 0 && passed) currentDirection = -1;
    direction[i] = currentDirection === 0 ? null : currentDirection;

    const e = emaFilter[i], s = smaFilter[i];
    const emaUp = p.lorentzianUseEmaFilter < 0.5 ? true : e !== null && c[i] > e;
    const smaUp = p.lorentzianUseSmaFilter < 0.5 ? true : s !== null && c[i] > s;
    const k1 = kernelEstimate[i], k1Prev = i > 0 ? kernelEstimate[i - 1] : null;
    const k2 = kernelSmooth[i];
    const kernelBullish = p.lorentzianUseKernelFilter < 0.5
      ? true
      : k1 !== null && k1Prev !== null && k2 !== null && k1 > k1Prev && k2 >= k1;
    const isNewSignal = currentDirection !== prevDirection;

    if (i < startIndex) continue;
    if (inPosition) {
      if (i - entryIdx >= maxHold || (isNewSignal && currentDirection === -1)) {
        signal[i] = "SELL";
        inPosition = false;
      }
    } else if (isNewSignal && currentDirection === 1 && emaUp && smaUp && kernelBullish) {
      signal[i] = "BUY";
      inPosition = true;
      entryIdx = i;
    }
  }
  return {
    prediction, direction, filterAll, kernelEstimate, signal,
    ...withFilter(k, signal, params, startIndex),
  };
}

// ══ ทะเบียนอินดิเคเตอร์ v2 ═════════════════════════════════════
/**
 * ทุกอย่างที่ layer อื่นต้องรู้เกี่ยวกับ v2 อยู่ในทะเบียนนี้ที่เดียว
 * lib/backtest.ts, web ui/engine.ts, web ui/data.ts และ export-calculations.ts
 * อ่านจากที่นี่ทั้งหมด จึงเพิ่มอินดิเคเตอร์ใหม่ได้โดยแก้ไฟล์เดียว
 */
export type V2BaseId =
  | "sma_v2" | "ema_v2" | "rsi_v2" | "macd_v2" | "bollinger_v2"
  | "atr_v2" | "stochastic_v2" | "stoch_rsi_v2" | "adx_v2" | "ichimoku_v2"
  | "supertrend_v2" | "vwap_v2" | "volume_v2" | "obv_v2" | "volume_profile_v2"
  | "smc_v2" | "squeeze_v2" | "wavetrend_v2" | "ut_bot_v2" | "lorentzian_v2";

export interface V2IndicatorDef {
  id: V2BaseId;
  /** คีย์ที่ใช้เก็บผลลัพธ์ใน AllIndicators */
  key: string;
  /** ลำดับในเอกสาร tradingview-popular-indicators-th.md */
  docIndex: number;
  name: string;
  group: string;
  core: Record<string, number>;
  compute: (k: KlineData[], params: Record<string, number>, startIndex: number) => V2Base;
  /** คอลัมน์ที่ web UI ใช้วาดทับกราฟราคาโดยปริยาย */
  overlay: string;
  descriptionTh: string;
  descriptionEn: string;
  /** กฎสัญญาณฉบับเต็มสำหรับไฟล์ Export */
  ruleTh: string;
}

export const V2_INDICATORS: V2IndicatorDef[] = [
  {
    id: "sma_v2", key: "smaV2", docIndex: 1, name: "SMA Cross V2", group: "แนวโน้ม",
    core: SMA_V2_CORE, compute: smaV2, overlay: "smaV2.slow",
    descriptionTh: "ซื้อเมื่อ SMA เร็วตัดขึ้นเหนือ SMA ช้า (Golden Cross) ขายเมื่อตัดลง (Death Cross)",
    descriptionEn: "Buy on fast SMA crossing above slow SMA, sell on cross below",
    ruleTh: "SMA(close, fastLength) และ SMA(close, slowLength) ให้น้ำหนักทุกแท่งเท่ากัน. BUY เมื่อเกิดจุดตัดจริง คือ fast แท่งก่อน <= slow แท่งก่อน และ fast แท่งนี้ > slow แท่งนี้. SELL เมื่อ fast แท่งก่อน >= slow แท่งก่อน และ fast แท่งนี้ < slow แท่งนี้. ใช้จุดตัดไม่ใช่สภาวะ จึงไม่ยิงซ้ำทุกแท่งที่ fast อยู่เหนือ slow. ช่วง warm-up คืน null จนกว่าจะมีข้อมูลครบ slowLength แท่ง",
  },
  {
    id: "ema_v2", key: "emaV2", docIndex: 2, name: "EMA Cross V2", group: "แนวโน้ม",
    core: EMA_V2_CORE, compute: emaV2, overlay: "emaV2.slow",
    descriptionTh: "ซื้อเมื่อ EMA เร็วตัดขึ้นเหนือ EMA ช้าและราคาปิดยืนเหนือ EMA เร็ว ขายเมื่อตัดลง",
    descriptionEn: "Buy when fast EMA crosses above slow EMA with price above fast EMA",
    ruleTh: "EMA(close, fastLength/slowLength) ตั้งต้นด้วย SMA แล้วใช้ alpha = 2/(n+1). BUY เมื่อ fast ตัดขึ้นเหนือ slow และราคาปิดแท่งนั้น > EMA เร็ว (ยืนยันว่าราคาอยู่ฝั่งเดียวกับเส้น). SELL เมื่อ fast ตัดลงใต้ slow โดยไม่บังคับเงื่อนไขราคา เพราะการหน่วงทางออกจะกินกำไรที่ได้มา",
  },
  {
    id: "rsi_v2", key: "rsiV2", docIndex: 3, name: "RSI Cross V2", group: "โมเมนตัม",
    core: RSI_V2_CORE, compute: rsiV2, overlay: "rsiV2.rsi",
    descriptionTh: "ซื้อเมื่อ RSI ตัดขึ้นพ้นเขต Oversold ขายเมื่อ RSI ตัดลงหลุดเขต Overbought (ต่างจาก V1 ที่ใช้ระดับค้าง)",
    descriptionEn: "Buy when RSI crosses back above the oversold level, sell when it crosses below overbought",
    ruleTh: "RSI ใช้ RMA แบบ Wilder: RS = RMA(gain,n)/RMA(loss,n), RSI = 100 − 100/(1+RS). BUY เมื่อ RSI แท่งก่อน <= buyThreshold และ RSI แท่งนี้ > buyThreshold (ตัดขึ้นพ้นเขต Oversold). SELL เมื่อ RSI แท่งก่อน >= sellThreshold และแท่งนี้ < sellThreshold. จุดต่างจาก V1: V1 ส่ง BUY ทุกแท่งที่ RSI < 30 ซึ่งขัดกับข้อจำกัดที่เอกสารระบุว่า RSI อยู่ในโซนสุดขั้วได้นานเมื่อเทรนด์แรง V2 จึงต้องเห็นการฟื้นตัวจริงก่อน",
  },
  {
    id: "macd_v2", key: "macdV2", docIndex: 4, name: "MACD V2", group: "โมเมนตัม/แนวโน้ม",
    core: MACD_V2_CORE, compute: macdV2, overlay: "macdV2.macd",
    descriptionTh: "ซื้อเมื่อ MACD ตัดขึ้นเหนือ Signal โดยอยู่เหนือศูนย์หรือ Histogram กำลังเพิ่ม ขายเมื่อตัดลง",
    descriptionEn: "Buy on MACD crossing above signal with zero-line or histogram confirmation",
    ruleTh: "MACD = EMA(C,fast) − EMA(C,slow); Signal = EMA(MACD, signalLength) ตามสูตรมาตรฐาน. หมายเหตุ: กลยุทธ์ V1 (cm_macd) ใช้ SMA เป็นเส้น Signal ซึ่งไม่ตรงกับเอกสาร V2 แก้เป็น EMA. BUY เมื่อ MACD ตัดขึ้นเหนือ Signal และ (MACD > 0 หรือ histogram แท่งนี้ > histogram แท่งก่อน) เงื่อนไขหลังทำให้ยังรับจังหวะกลับตัวใต้ศูนย์ที่มีแรงส่งจริงได้. SELL เมื่อ MACD ตัดลงใต้ Signal",
  },
  {
    id: "bollinger_v2", key: "bollingerV2", docIndex: 5, name: "Bollinger Squeeze Breakout V2", group: "ความผันผวน",
    core: BB_V2_CORE, compute: bollingerV2, overlay: "bollingerV2.upper",
    descriptionTh: "ซื้อเมื่อกรอบบีบตัวแล้วราคาปิดทะลุขอบบน ขายเมื่อราคาปิดหลุดเส้นกลาง",
    descriptionEn: "Buy on a close above the upper band after a squeeze, sell on a close below the basis",
    ruleTh: "Middle = SMA(C,length); Upper/Lower = Middle ± mult × StdDev(C,length); bandwidth = (Upper−Lower)/Middle; percentB = (C−Lower)/(Upper−Lower). squeeze = bandwidth < SMA(bandwidth, squeezeLength) × squeezeThreshold. BUY เมื่อมี squeeze อย่างน้อยหนึ่งแท่งภายใน setupBars แท่งล่าสุด และราคาปิดแท่งก่อน <= Upper แท่งก่อน แต่ราคาปิดแท่งนี้ > Upper แท่งนี้. SELL เมื่อราคาปิดตัดลงใต้เส้นกลาง. เหตุผลที่ไม่ใช้ 'แตะขอบบน = ขาย' และไม่ใช้ squeeze เดี่ยวเป็นสัญญาณ เพราะเอกสารระบุชัดว่าทั้งสองอย่างนั้นตีความผิด",
  },
  {
    id: "atr_v2", key: "atrV2", docIndex: 6, name: "ATR Volatility Breakout V2", group: "ความผันผวน",
    core: ATR_V2_CORE, compute: atrV2, overlay: "atrV2.chandelier",
    descriptionTh: "ซื้อเมื่อ ATR ขยายตัวพร้อมราคาปิดทำจุดสูงสุดใหม่ ขายเมื่อหลุด Chandelier stop",
    descriptionEn: "Buy on expanding ATR with a new breakout high, exit on the chandelier stop",
    ruleTh: "ATR = RMA(TrueRange, length); atrPercent = ATR/Close × 100 สำหรับเทียบข้ามสินทรัพย์. ATR ไม่บอกทิศทางด้วยตัวเอง ทิศทางจึงมาจากราคาล้วน ๆ. BUY เมื่อ ATR > SMA(ATR, expansionLength) และราคาปิด > ค่าสูงสุดของราคาปิด breakoutLength แท่งก่อนหน้า (ไม่รวมแท่งปัจจุบัน). SELL เมื่อราคาปิด <= Chandelier stop = (ราคาปิดสูงสุดนับตั้งแต่เข้า) − chandelierMult × ATR. ใช้สถานะภายในเพราะ Chandelier ต้องรู้จุดเข้า",
  },
  {
    id: "stochastic_v2", key: "stochasticV2", docIndex: 7, name: "Stochastic V2", group: "โมเมนตัม",
    core: STOCH_V2_CORE, compute: stochasticV2, overlay: "stochasticV2.k",
    descriptionTh: "ซื้อเมื่อ %K ตัดขึ้นเหนือ %D ในเขต Oversold ขายเมื่อตัดลงในเขต Overbought",
    descriptionEn: "Buy on %K crossing above %D inside oversold, sell on the reverse inside overbought",
    ruleTh: "RawK = 100 × (C − LL(length)) / (HH(length) − LL(length)) โดยกำหนด RawK = 50 เมื่อ HH = LL (ราคานิ่งทั้งหน้าต่าง). %K = SMA(RawK, smoothK); %D = SMA(%K, smoothD). BUY เมื่อ %K ตัดขึ้นเหนือ %D และ %D < oversoldThreshold. SELL เมื่อ %K ตัดลงใต้ %D และ %D > overboughtThreshold. ใช้ %D เป็นตัวตัดสินโซนเพราะ %D ช้ากว่า จึงกันกรณี %K วิ่งพ้นโซนไปก่อนแล้วค่อยตัด",
  },
  {
    id: "stoch_rsi_v2", key: "stochRsiV2", docIndex: 8, name: "Stochastic RSI V2", group: "โมเมนตัม",
    core: STOCH_RSI_V2_CORE, compute: stochRsiV2, overlay: "stochRsiV2.k",
    descriptionTh: "ซื้อเมื่อ %K ตัดขึ้นเหนือ %D ในเขตต่ำและ RSI ต้นทางกำลังฟื้น ขายเมื่อตัดลงในเขตสูง",
    descriptionEn: "Buy on StochRSI K/D cross in the low zone with rising source RSI",
    ruleTh: "คำนวณ RSI(rsiLength) ก่อน แล้วใช้สูตร Stochastic กับค่า RSI: raw = (RSI − LowestRSI(stochLength)) / (HighestRSI − LowestRSI) × 100 กำหนด 50 เมื่อตัวหารเป็นศูนย์. %K = SMA(raw, smoothK); %D = SMA(%K, smoothD). BUY เมื่อ %K ตัดขึ้นเหนือ %D, %D < oversoldThreshold และ RSI ต้นทางแท่งนี้ > แท่งก่อน. SELL เมื่อ %K ตัดลงใต้ %D และ %D > overboughtThreshold. เงื่อนไข RSI ต้นทางเพิ่มมาเพื่อลดความถี่ที่เอกสารเตือนว่า StochRSI ไวกว่า RSI มาก และย้ำว่าค่า StochRSI ต่ำไม่ได้แปลว่า RSI ต่ำ",
  },
  {
    id: "adx_v2", key: "adxV2", docIndex: 9, name: "ADX / DMI V2", group: "ความแข็งแรงของแนวโน้ม",
    core: ADX_V2_CORE, compute: adxV2, overlay: "adxV2.adx",
    descriptionTh: "ซื้อเมื่อ +DI ตัดขึ้นเหนือ −DI ขณะ ADX ถึงเกณฑ์ ขายเมื่อ −DI แซงหรือ ADX ตกจนเทรนด์หมดแรง",
    descriptionEn: "Buy on +DI crossing above −DI with ADX above threshold, sell on reversal or ADX decay",
    ruleTh: "UpMove = H(t)−H(t−1); DownMove = L(t−1)−L(t); +DM นับเมื่อ UpMove > DownMove และ > 0. +DI = 100 × RMA(+DM,diLength)/RMA(TR,diLength); DX = 100 × |+DI − −DI|/(+DI + −DI); ADX = RMA(DX, smoothLength). BUY เมื่อ +DI ตัดขึ้นเหนือ −DI และ ADX >= adxThreshold. SELL เมื่อ −DI ตัดขึ้นเหนือ +DI หรือ ADX ตัดลงใต้ adxExitThreshold. ห้ามใช้ ADX เดี่ยวเพราะ ADX สูงไม่ได้แปลว่าขาขึ้น ทิศทางมาจาก +DI/−DI เท่านั้น",
  },
  {
    id: "ichimoku_v2", key: "ichimokuV2", docIndex: 10, name: "Ichimoku Cloud V2", group: "แนวโน้ม/แนวรับต้าน",
    core: ICHIMOKU_V2_CORE, compute: ichimokuV2, overlay: "ichimokuV2.kijun",
    descriptionTh: "ซื้อเมื่อ Tenkan ตัดขึ้นเหนือ Kijun ขณะราคาอยู่เหนือเมฆและ Chikou ยืนยัน ขายเมื่อหลุด Kijun",
    descriptionEn: "Buy on Tenkan/Kijun cross above the cloud with Chikou confirmation, exit below Kijun",
    ruleTh: "Tenkan = (HH(9)+LL(9))/2; Kijun = (HH(26)+LL(26))/2; Senkou A = (Tenkan+Kijun)/2; Senkou B = (HH(52)+LL(52))/2. การจัดการ displacement: เมฆที่ใช้เทียบกับราคาที่แท่ง t คือค่าที่คำนวณจากข้อมูล ณ แท่ง t − displacement (เก็บไว้ในคอลัมน์ spanAAt/spanBAt) จึงเป็นข้อมูลอดีตล้วน ไม่มี lookahead. BUY เมื่อ Tenkan ตัดขึ้นเหนือ Kijun, ราคาปิด > ขอบบนของเมฆ (max ของ spanAAt/spanBAt) และ Chikou ยืนยันคือราคาปิดแท่งนี้ > ราคาปิดเมื่อ displacement แท่งก่อน. SELL เมื่อราคาปิดตัดลงใต้ Kijun ซึ่งไวกว่ารอให้หลุดเมฆทั้งก้อน. cloudPosition: 1 = เหนือเมฆ, 0 = ในเมฆ, -1 = ใต้เมฆ",
  },
  {
    id: "supertrend_v2", key: "supertrendV2", docIndex: 11, name: "Supertrend V2", group: "ตามแนวโน้ม",
    core: SUPERTREND_V2_CORE, compute: supertrendV2, overlay: "supertrendV2.supertrend",
    descriptionTh: "ซื้อเมื่อสถานะพลิกเป็นขาขึ้น ขายเมื่อพลิกเป็นขาลง พร้อมการรักษาแนวจากแท่งก่อนครบตามต้นฉบับ",
    descriptionEn: "Buy when the trend state flips bullish, sell when it flips bearish",
    ruleTh: "Mid = (H+L)/2; BasicUpper/Lower = Mid ± factor × ATR(atrLength) โดย ATR ใช้ RMA. การรักษาแนว: ถ้าราคาปิดแท่งก่อน > lower แท่งก่อน ให้ lower = max(lower, lower แท่งก่อน) และถ้าราคาปิดแท่งก่อน < upper แท่งก่อน ให้ upper = min(upper, upper แท่งก่อน). สถานะ: ขาลงอยู่แล้วและราคาปิด > upper แท่งก่อน → พลิกเป็นขาขึ้น; ขาขึ้นอยู่แล้วและราคาปิด < lower แท่งก่อน → พลิกเป็นขาลง. แท่งแรกที่มี ATR ตั้งสถานะจากราคาปิดเทียบ Mid. BUY/SELL ส่งเฉพาะแท่งที่สถานะพลิกจริง",
  },
  {
    id: "vwap_v2", key: "vwapV2", docIndex: 12, name: "Anchored VWAP V2", group: "ราคาและปริมาณ",
    core: VWAP_V2_CORE, compute: vwapV2, overlay: "vwapV2.vwap",
    descriptionTh: "ซื้อเมื่อราคาปิดตัดขึ้นเหนือ VWAP ของรอบ Anchor ขายเมื่อตัดลง (เลือก Anchor วัน/สัปดาห์/เดือน)",
    descriptionEn: "Buy on a close crossing above the anchored VWAP, sell on a cross below",
    ruleTh: "TypicalPrice = (H+L+C)/3; VWAP = Σ(TP×V)/ΣV สะสมใหม่ทุกครั้งที่เข้ารอบ Anchor ใหม่ (anchorMode 1 = รายวัน UTC, 2 = รายสัปดาห์เริ่มวันจันทร์ UTC, 3 = รายเดือน UTC). แถบเบี่ยงเบน: variance = Σ(TP²×V)/ΣV − VWAP² แล้ว VWAP ± bandMult × √variance. BUY เมื่อราคาปิดตัดขึ้นเหนือ VWAP และ barsSinceAnchor >= minAnchorBars. SELL เมื่อราคาปิดตัดลงใต้ VWAP. ต้องตรวจคอลัมน์ barsSinceAnchor ก่อนเชื่อผล: ถ้าเป็น 0 แทบทุกแท่ง แปลว่า Anchor ละเอียดกว่าหรือเท่ากับ timeframe ของกราฟ (เช่น Anchor รายวันบนกราฟ 1d) ค่า VWAP จะไม่มีความหมาย ต้องเลือก Anchor ที่ยาวกว่า timeframe เสมอ",
  },
  {
    id: "volume_v2", key: "volumeV2", docIndex: 13, name: "Volume Breakout V2", group: "ปริมาณซื้อขาย",
    core: VOLUME_V2_CORE, compute: volumeV2, overlay: "volumeV2.relativeVolume",
    descriptionTh: "ซื้อเมื่อราคาทะลุพร้อม Volume พุ่งและแท่งเขียวปิดแรง ขายเมื่อหลุดกรอบล่างหรือเจอแท่งเทขาย",
    descriptionEn: "Buy on a price breakout confirmed by a volume spike and a strong bullish close",
    ruleTh: "relativeVolume = V / SMA(V, averageLength) โดย 2 หมายถึงสองเท่าของค่าเฉลี่ย. breakoutHigh/Low = ค่าสูงสุด/ต่ำสุดของราคาปิด breakoutLength แท่งก่อนหน้า (ไม่รวมแท่งปัจจุบัน). location = (C−L)/(H−L) บอกว่าปิดที่ส่วนใดของกรอบแท่ง. BUY เมื่อราคาปิด > breakoutHigh, relativeVolume >= spikeThreshold, เป็นแท่งเขียว (C > O) และ location >= 0.6. SELL เมื่อราคาปิด < breakoutLow หรือ (relativeVolume >= spikeThreshold และเป็นแท่งแดงที่ location <= 0.4). Volume เป็นตัวยืนยันเท่านั้น ทิศทางทั้งหมดมาจากราคา ตามข้อจำกัดที่เอกสารระบุว่า Volume สูงไม่ได้บอกทิศทาง. ก่อนใช้จริงต้องตรวจว่าข้อมูล Volume เป็น Base/Quote volume หรือ Tick volume",
  },
  {
    id: "obv_v2", key: "obvV2", docIndex: 14, name: "OBV Trend V2", group: "ราคาและปริมาณ",
    core: OBV_V2_CORE, compute: obvV2, overlay: "obvV2.obv",
    descriptionTh: "ซื้อเมื่อ OBV ตัดขึ้นเหนือ EMA ของตัวเอง ขายเมื่อตัดลงหรือพบ Bearish divergence",
    descriptionEn: "Buy when OBV crosses above its own EMA, sell on the cross down or bearish divergence",
    ruleTh: "OBV สะสม: C(t) > C(t−1) → +V; C(t) < C(t−1) → −V; เท่ากัน → คงเดิม. ค่าดิบเทียบข้ามช่วงเวลาไม่ได้เพราะขึ้นกับจุดเริ่มสะสม จึงเทียบกับ EMA(OBV, emaLength) ของตัวเอง. BUY เมื่อ OBV ตัดขึ้นเหนือ EMA. SELL เมื่อ OBV ตัดลงใต้ EMA หรือพบ bearishDivergence. นิยาม divergence ที่ตรวจได้ด้วยเครื่อง: bearish = ราคาปิดแท่งนี้ > ค่าสูงสุดของราคาปิด divergenceLength แท่งก่อนหน้า แต่ OBV แท่งนี้ <= ค่าสูงสุดของ OBV ในหน้าต่างเดียวกัน (ราคาขึ้นแต่ยอดสะสมไม่ตาม); bullish = นิยามกลับกัน. ข้อจำกัด: OBV แบ่ง Volume ทั้งแท่งตามราคาปิด ไม่ใช่การแยกซื้อ/ขายเชิงรุกจริง",
  },
  {
    id: "volume_profile_v2", key: "volumeProfileV2", docIndex: 15, name: "Volume Profile V2", group: "ปริมาณตามระดับราคา",
    core: VOLUME_PROFILE_V2_CORE, compute: volumeProfileV2, overlay: "volumeProfileV2.poc",
    descriptionTh: "ซื้อเมื่อราคาปิดตัดขึ้นเหนือ VAH (ยอมรับราคาเหนือกรอบมูลค่า) ขายเมื่อหลุดกลับใต้ POC",
    descriptionEn: "Buy on acceptance above the value area high, sell on a close back below the POC",
    ruleTh: "สร้าง Fixed Range Profile แบบเลื่อนจาก profileLength แท่งที่ปิดแล้วก่อนแท่งปัจจุบัน แบ่งช่วง High–Low ของหน้าต่างเป็น profileBinCount ช่อง. การประมาณที่ต้องรู้: TradingView ใช้ข้อมูลกรอบเวลาย่อยสร้าง Profile แต่ backtest นี้ไม่มี จึงกระจาย Volume ของแต่ละแท่งแบบสม่ำเสมอทั่วช่องที่ช่วง High–Low ของแท่งนั้นพาดผ่าน ตัวเลข POC/VAH/VAL จึงไม่เท่ากับบนเว็บโดยเฉพาะบน timeframe ใหญ่. POC = ช่องที่มี Volume สูงสุด. Value Area: ขยายออกจาก POC ทีละช่องโดยเลือกฝั่งที่มี Volume มากกว่า จนครอบคลุม valueAreaThreshold% ของ Volume รวม; VAL = ขอบล่างของช่องล่างสุด, VAH = ขอบบนของช่องบนสุด. BUY เมื่อราคาปิดตัดขึ้นเหนือ VAH. SELL เมื่อราคาปิดตัดลงใต้ POC (ใช้ POC แทน VAL เพราะรอถึง VAL คือรอให้ราคากลับลงสุดกรอบก่อน). ไม่ใช้ Visible Range เพราะเปลี่ยนตามการเลื่อน/ซูมกราฟ ทำซ้ำไม่ได้",
  },
  {
    id: "smc_v2", key: "smcV2", docIndex: 16, name: "Smart Money Concepts V2", group: "โครงสร้างราคา",
    core: SMC_V2_CORE, compute: smcV2, overlay: "smcV2.swingHigh",
    descriptionTh: "ซื้อเมื่อเกิด Bullish CHoCH หรือ BOS ที่ไม่อยู่ในโซน Premium ขายเมื่อโครงสร้างพลิกเป็นขาลง",
    descriptionEn: "Buy on bullish CHoCH, or bullish BOS outside premium; sell on bearish structure breaks",
    ruleTh: "ใช้ swing pivot กว้าง swingLength ทั้งสองฝั่ง และใช้ระดับได้ตั้งแต่แท่ง pivotIndex + swingLength เท่านั้น (confirmedAt) จึงไม่มี lookahead จากการวาด pivot ย้อนหลัง. เมื่อราคาปิดทะลุ swing high ที่ยังไม่ถูกใช้: เป็น CHoCH ถ้าเทรนด์โครงสร้างเดิมเป็น bearish มิฉะนั้นเป็น BOS แล้วตั้งเทรนด์เป็น bullish และล้างระดับนั้นทิ้ง (ต้องรอ pivot ใหม่ จึงไม่ยิงซ้ำทุกแท่ง). zonePosition = (C − lastSwingLow)/(lastSwingHigh − lastSwingLow); Premium = zonePosition > 0.5 + equilibriumBand/2. BUY เมื่อเป็น Bullish CHoCH (รับได้ทุกโซน เพราะเป็นการกลับโครงสร้าง) หรือ Bullish BOS ที่ไม่อยู่ในโซน Premium (BOS ในโซนแพงคือการไล่ราคาที่ปลายทาง). SELL เมื่อเกิด Bearish CHoCH หรือ Bearish BOS. คอลัมน์ประกอบ: bullishFvg = low[i] > high[i−2]; bearishFvg = high[i] < low[i−2]. ข้อจำกัดที่ผู้พัฒนาต้นฉบับระบุเอง: โซนที่วาดเป็นการตีความจากราคา ไม่ได้ยืนยันว่ามีคำสั่งสถาบันอยู่จริง",
  },
  {
    id: "squeeze_v2", key: "squeezeV2", docIndex: 17, name: "Squeeze Momentum V2", group: "ความผันผวน",
    core: SQUEEZE_V2_CORE, compute: squeezeV2, overlay: "squeezeV2.momentum",
    descriptionTh: "ซื้อเมื่อ Squeeze คลายตัวพร้อมโมเมนตัมบวกที่กำลังเพิ่ม ขายเมื่อโมเมนตัมตัดลงใต้ศูนย์ (V1 ไม่ได้ใช้ Squeeze เลย)",
    descriptionEn: "Buy when the squeeze releases with rising positive momentum, sell on momentum crossing below zero",
    ruleTh: "BB: SMA(C,bbLength) ± bbMult × StdDev. KC: SMA(C,kcLength) ± kcMult × SMA(TrueRange,kcLength). squeezeOn = BB อยู่ในกรอบ KC ทั้งสองด้าน; squeezeOff = BB ออกนอก KC ทั้งสองด้าน. momentum = linreg(C − avg(avg(HH(kcLength), LL(kcLength)), SMA(C,kcLength)), kcLength, 0). BUY เมื่อภายใน setupBars แท่งล่าสุดมีการเปลี่ยนจาก squeezeOn เป็นไม่ squeeze อย่างน้อยหนึ่งครั้ง และ momentum > 0 และ momentum แท่งนี้ > แท่งก่อน. SELL เมื่อ momentum ตัดลงใต้ศูนย์. จุดต่างจาก V1 (squeeze_momentum): V1 คำนวณ sqzOn/sqzOff ไว้แต่ไม่ได้ใช้ในเงื่อนไขส่งสัญญาณเลย เหลือแค่โมเมนตัมข้ามศูนย์ ซึ่งทิ้งแก่นของอินดิเคเตอร์ไป V2 บังคับให้การเข้าต้องมาจากการคลายตัวจริง และให้ทิศทางมาจากเครื่องหมายกับความชันของ Histogram ตามที่เอกสารเตือนว่าการคลายตัวเองไม่บอกทิศ",
  },
  {
    id: "wavetrend_v2", key: "waveTrendV2", docIndex: 18, name: "WaveTrend V2", group: "โมเมนตัม",
    core: WAVETREND_V2_CORE, compute: waveTrendV2, overlay: "waveTrendV2.wt1",
    descriptionTh: "ซื้อเมื่อ wt1 ตัดขึ้นเหนือ wt2 ในเขต Oversold ขายเมื่อตัดลงในเขต Overbought ตามที่ผู้พัฒนายกตัวอย่าง",
    descriptionEn: "Buy on wt1 crossing above wt2 in oversold, sell on the cross down in overbought",
    ruleTh: "esa = EMA(HLC3, channelLength); d = EMA(|HLC3 − esa|, channelLength); ci = (HLC3 − esa)/(0.015 × d); wt1 = EMA(ci, averageLength); wt2 = SMA(wt1, smoothLength). BUY เมื่อ wt1 ตัดขึ้นเหนือ wt2 และ wt2 <= oversoldThreshold. SELL เมื่อ wt1 ตัดลงใต้ wt2 และ wt2 >= overboughtThreshold. ตรงตามตัวอย่างที่ผู้พัฒนาต้นฉบับให้ไว้. ข้อจำกัด: สูตรต้นฉบับไม่ได้เปิดเผยครบทุกบรรทัดในคำอธิบาย ค่าที่ได้จึงอาจต่างจากสคริปต์บนเว็บเล็กน้อย และการตัดเส้นเกิดบ่อยโดยราคาอาจไปต่อสวนสัญญาณ",
  },
  {
    id: "ut_bot_v2", key: "utBotV2", docIndex: 19, name: "UT Bot V2", group: "ตามแนวโน้ม",
    core: UT_BOT_V2_CORE, compute: utBotV2, overlay: "utBotV2.trailingStop",
    descriptionTh: "ซื้อเมื่อราคาปิดตัดขึ้นเหนือ ATR trailing stop ขายเมื่อตัดลง",
    descriptionEn: "Buy when price crosses above the ATR trailing stop, sell when it crosses below",
    ruleTh: "nLoss = keyValue × ATR(atrLength) โดย ATR ใช้ RMA ตามค่าเริ่มต้นของ TradingView. แนว trailing stop: ถ้าราคาปิดแท่งนี้และแท่งก่อนอยู่เหนือแนวเดิม → max(แนวเดิม, C − nLoss); ถ้าอยู่ใต้ทั้งสองแท่ง → min(แนวเดิม, C + nLoss); นอกนั้นรีเซ็ตเป็น C ∓ nLoss ตามฝั่ง. แท่งแรกที่มี ATR ตั้งแนวที่ C − nLoss. BUY เมื่อราคาปิดแท่งก่อน <= แนวแท่งก่อน และราคาปิดแท่งนี้ > แนวแท่งนี้. SELL เมื่อราคาปิดแท่งก่อน >= แนวแท่งก่อน และแท่งนี้ < แนวแท่งนี้. ข้อควรระวัง: เส้น trailing stop นี้ใช้สร้างสัญญาณเท่านั้น ไม่ได้แปลว่ามีคำสั่ง Stop ส่งไปตลาดแล้ว และช่วงออกข้างจะสลับสัญญาณบ่อย",
  },
  {
    id: "lorentzian_v2", key: "lorentzianV2", docIndex: 20, name: "Lorentzian Classification V2", group: "ML/จำแนกทิศทาง",
    core: LORENTZIAN_V2_CORE, compute: lorentzianV2, overlay: "lorentzianV2.kernelEstimate",
    descriptionTh: "จำแนกทิศทางด้วย k-NN ระยะทาง Lorentzian บนคุณลักษณะ 5 มิติ พร้อมตัวกรองความผันผวน/สภาพตลาด/Kernel",
    descriptionEn: "Lorentzian-distance k-NN classification over 5 features with volatility, regime and kernel filters",
    ruleTh: "คุณลักษณะ 5 ตัวปรับสเกล 0–1: RSI(14) ผ่าน EMA(1) แล้ว rescale 0–100→0–1, WaveTrend(10,11) ผ่าน normalize สะสม, CCI(20) ผ่าน EMA(1) แล้ว normalize สะสม, ADX(20) ฉบับ Lorentzian แล้ว rescale, RSI(9) เช่นเดียวกับตัวแรก. ป้ายกำกับที่แท่ง j: close[j−4] < close[j] → −1; close[j−4] > close[j] → +1; เท่ากัน → 0 (สูตรตามต้นฉบับตรงตัว ผลคือโมเดลมีลักษณะสวนการเคลื่อนไหว 4 แท่งล่าสุด). ระยะทาง Lorentzian = Σ log(1 + |x_i − y_i|) ซึ่งทนต่อค่าผิดปกติมากกว่าระยะทางยุคลิด. การค้นเพื่อนบ้านที่แท่ง t ใช้ข้อมูลอดีตล้วน ไม่มี lookahead โดยชุดแท่งขึ้นกับ lorentzianNeighborPool: โหมด 1 (ตามต้นฉบับ) วนแท่ง 0..min(maxBarsBack−1, t−1) ซึ่งคือแท่งเก่าที่สุดของชุดข้อมูล ไม่ใช่แท่งล่าสุด — บนข้อมูลยาว ๆ จึงเทียบทุกแท่งกับช่วงต้นข้อมูลตลอด, โหมด 2 วน maxBarsBack แท่งล่าสุดก่อนแท่งปัจจุบันซึ่งเหมาะกับการประเมินกลยุทธ์มากกว่า; ข้ามแท่งที่ i%4 == 0 และรับเฉพาะแท่งที่ระยะทาง >= ระยะทางล่าสุดที่รับไว้ เมื่อเก็บครบ neighborsCount จะยกเกณฑ์ไปที่ควอนไทล์ 75 ของระยะทางที่เก็บไว้แล้วทิ้งตัวเก่าสุด. prediction = ผลรวมป้ายกำกับของเพื่อนบ้าน. ตัวกรอง: volatility (ATR(1) > ATR(10)), regime (ความชัน KLMF เทียบ EMA(200) ของตัวเอง >= regimeThreshold), ADX (ปิดไว้ตามต้นฉบับ), EMA/SMA ทิศทาง (ปิดไว้), kernel Rational Quadratic (h = kernelLookback, r = kernelWeight, x = kernelStartBar) ต้องชี้ขึ้นและเส้น Gaussian อยู่ไม่ต่ำกว่า. BUY เมื่อทิศทางเปลี่ยนเป็น long ครั้งใหม่ และผ่านตัวกรอง EMA/SMA/kernel. SELL เมื่อถือครบ maxHoldBars (กติกา 4 แท่งของต้นฉบับ) หรือทิศทางเปลี่ยนเป็น short. ข้อจำกัดที่ผู้พัฒนาระบุเอง: ค่า prediction ไม่ใช่ความน่าจะเป็นที่สอบเทียบแล้ว และ Trade Stats ภายในใช้แทน Backtest เต็มรูปแบบไม่ได้. ต้นทุนการคำนวณเป็น O(แท่ง × maxBarsBack × คุณลักษณะ)",
  },
];

/** คำอธิบายชุดตัวกรองร่วม ใช้ต่อท้ายกฎของทุกกลยุทธ์โหมด _filtered ในไฟล์ Export */
export const V2_FILTER_RULE_TH =
  "โหมด _filtered: นำสัญญาณดิบข้างต้นมาเป็น 'เจตนา' แล้วกรองอีกชั้นก่อนเข้า และบริหารการออกเอง. " +
  "ตัวกรองเข้า 4 ชั้น ต้องผ่านครบทุกข้อ: (1) ราคาปิด > EMA(filterTrendLength) " +
  "— ใช้เฉพาะอินดิเคเตอร์แบบเข้าตามแรง " +
  "(2) EMA เทรนด์ตัวนั้นสูงกว่าเมื่อ filterSlopeBars แท่งก่อน (ความชันเป็นบวก) " +
  "(3) ADX(filterAdxLength) >= filterAdxThreshold และ +DI > −DI " +
  "(4) ATR(filterAtrLength) / ATR(filterAtrLength × 4) <= filterMaxVolRatio (ไม่เข้าตอนความผันผวนพุ่งผิดปกติ). " +
  "อินดิเคเตอร์แบบซื้อย่อ (rsi_v2, stochastic_v2, stoch_rsi_v2, wavetrend_v2) ใช้ชุดที่ต่างออกไป: " +
  "ข้ามข้อ (1) และข้อ +DI > −DI ในข้อ (3) แล้ววัดความชัน EMA ในข้อ (2) ด้วยหน้าต่างยาวขึ้นเป็น filterTrendLength/4 แท่ง. " +
  "เหตุผลวัดจากข้อมูลจริง (BTCUSDT 1h 4,000 แท่ง ณ แท่งสัญญาณ RSI 58 แท่ง): ราคา > EMA100 ผ่าน 0/58, " +
  "EMA100 ชันขึ้นเทียบ 5 แท่ง ผ่าน 0/58, +DI > −DI ผ่าน 0/58 — สามข้อนี้เป็นเท็จโดยโครงสร้างเพราะแท่งที่ออสซิลเลเตอร์ " +
  "ให้สัญญาณคือแท่งที่ราคาเพิ่งอ่อนแรง ขณะที่ EMA100 สูงกว่าเมื่อ 25 แท่งก่อน ผ่าน 14/58 จึงยังแยกแยะเทรนด์ได้จริง. " +
  "เพิ่มช่วงพัก filterCooldownBars แท่งหลังออกทุกครั้ง. " +
  "การออก: stop เริ่มต้น = ราคาปิดที่เข้า − max(filterStopAtr × ATR, ราคาเข้า × filterMinStopPct/100); " +
  "trailing = ราคาปิดสูงสุดนับจากเข้า − max(filterTrailAtr × ATR, peak × filterMinStopPct/100) โดย stop เลื่อนขึ้นเท่านั้น. " +
  "SELL เมื่อราคาปิด <= stop, เจอสัญญาณขายดิบของอินดิเคเตอร์ หรือถือครบ filterMaxHoldBars แท่ง. " +
  "ทุก stop เทียบราคาปิด ไม่ใช่คำสั่ง stop ระหว่างแท่ง เอนจินจะไปปิดจริงที่ราคาเปิดแท่งถัดไปพร้อม fee/slippage. " +
  "ดูคอลัมน์ filterStop และ filterReason รายแท่งเพื่อตรวจว่าทำไมเข้าหรือไม่เข้า. " +
  "ข้อควรรู้: ตัวกรองลดจำนวนสัญญาณเสมอ ไม่รับประกันว่ากำไรดีขึ้น เทียบกับกลยุทธ์โหมดพื้นฐานชื่อเดียวกันเพื่อดูผลจริง";

export const V2_INDICATOR_BY_ID = new Map(V2_INDICATORS.map(d => [d.id, d]));

// ══ คำอธิบายและขอบเขตของพารามิเตอร์ ════════════════════════════
/**
 * web ui/data.ts ใช้ min/max/integer ตรวจค่าที่ส่งมาจากเบราว์เซอร์
 * public/app.js ใช้ label/min/max/step สร้างช่องกรอกและป้ายภาษาไทย
 * จึงเป็นแหล่งความจริงเดียวของทั้งฝั่ง server และ client
 */
export interface V2ParamMeta {
  label: string;
  min: number;
  max: number;
  step: number;
  integer: boolean;
}
const barLen = (label: string, max = 400): V2ParamMeta => ({ label, min: 2, max, step: 1, integer: true });
const level = (label: string, min = 1, max = 100): V2ParamMeta => ({ label, min, max, step: 1, integer: false });
const mult = (label: string, min = 0.1, max = 20): V2ParamMeta => ({ label, min, max, step: 0.1, integer: false });
const count = (label: string, min: number, max: number): V2ParamMeta => ({ label, min, max, step: 1, integer: true });
const toggle = (label: string): V2ParamMeta => ({ label, min: 0, max: 1, step: 1, integer: true });

export const V2_PARAM_META: Record<string, V2ParamMeta> = {
  // 1–2 ค่าเฉลี่ยเคลื่อนที่
  smaFastLength: barLen("SMA เร็ว (แท่ง)"),
  smaSlowLength: barLen("SMA ช้า (แท่ง)"),
  emaFastLength: barLen("EMA เร็ว (แท่ง)"),
  emaSlowLength: barLen("EMA ช้า (แท่ง)"),
  // 3 RSI
  rsiLength: barLen("ช่วงคำนวณ RSI"),
  rsiBuyThreshold: level("ระดับ Oversold ที่ตัดขึ้นแล้วซื้อ"),
  rsiSellThreshold: level("ระดับ Overbought ที่ตัดลงแล้วขาย"),
  // 4 MACD
  macdFastLength: barLen("EMA เร็ว"),
  macdSlowLength: barLen("EMA ช้า"),
  macdSignalLength: barLen("EMA เส้น Signal"),
  // 5 Bollinger
  bbLength: barLen("ช่วง Bollinger"),
  bbMult: mult("ตัวคูณส่วนเบี่ยงเบน", 0.5, 10),
  bbSqueezeLength: barLen("ช่วงอ้างอิงความกว้างกรอบ", 1000),
  bbSqueezeThreshold: mult("แคบกว่าค่าเฉลี่ยกี่เท่าถึงเรียกบีบตัว", 0.1, 2),
  bbSetupBars: count("อายุภาวะบีบตัว (แท่ง)", 1, 100),
  // 6 ATR
  atrLength: barLen("ช่วง ATR"),
  atrExpansionLength: barLen("ช่วงเทียบการขยายตัวของ ATR"),
  atrBreakoutLength: barLen("ช่วงหาจุดสูงสุดที่ต้องทะลุ"),
  atrChandelierMult: mult("ระยะ Chandelier stop × ATR", 0.5, 20),
  // 7 Stochastic
  stochLength: barLen("ช่วง Stochastic"),
  stochSmoothK: count("ปรับเรียบ %K", 1, 50),
  stochSmoothD: count("ปรับเรียบ %D", 1, 50),
  stochOversoldThreshold: level("ระดับ Oversold"),
  stochOverboughtThreshold: level("ระดับ Overbought"),
  // 8 Stochastic RSI
  stochRsiLength: barLen("ช่วง RSI ต้นทาง"),
  stochRsiStochLength: barLen("ช่วง Stochastic บน RSI"),
  stochRsiSmoothK: count("ปรับเรียบ %K", 1, 50),
  stochRsiSmoothD: count("ปรับเรียบ %D", 1, 50),
  stochRsiOversoldThreshold: level("ระดับ Oversold"),
  stochRsiOverboughtThreshold: level("ระดับ Overbought"),
  // 9 ADX/DMI
  adxDiLength: barLen("ช่วง +DI/−DI"),
  adxSmoothLength: barLen("ช่วงเกลี่ย ADX"),
  adxThreshold: level("ADX ขั้นต่ำที่ถือว่ามีเทรนด์"),
  adxExitThreshold: level("ADX ที่ต่ำจนถือว่าเทรนด์ตาย"),
  // 10 Ichimoku
  ichimokuTenkanLength: barLen("Tenkan-sen"),
  ichimokuKijunLength: barLen("Kijun-sen"),
  ichimokuSenkouBLength: barLen("Senkou Span B"),
  ichimokuDisplacement: count("Displacement (แท่ง)", 1, 200),
  // 11 Supertrend
  supertrendAtrLength: barLen("ช่วง ATR"),
  supertrendFactor: mult("ตัวคูณ ATR", 0.5, 20),
  // 12 VWAP
  vwapAnchorMode: count("Anchor (1=วัน 2=สัปดาห์ 3=เดือน)", 1, 3),
  vwapBandMult: mult("ตัวคูณแถบเบี่ยงเบน", 0.1, 10),
  vwapMinAnchorBars: count("ต้องผ่านกี่แท่งในรอบก่อนรับสัญญาณ", 0, 200),
  // 13 Volume
  volumeAverageLength: barLen("ช่วงค่าเฉลี่ย Volume"),
  volumeSpikeThreshold: mult("Volume ต้องเป็นกี่เท่าของค่าเฉลี่ย", 1, 20),
  volumeBreakoutLength: barLen("ช่วงหากรอบราคาที่ต้องทะลุ"),
  // 14 OBV
  obvEmaLength: barLen("EMA ของ OBV"),
  obvDivergenceLength: barLen("หน้าต่างตรวจ Divergence"),
  // 15 Volume Profile
  profileLength: count("จำนวนแท่งที่ใช้สร้าง Profile", 20, 1000),
  profileBinCount: count("จำนวนช่องราคา", 4, 200),
  profileValueAreaThreshold: level("สัดส่วน Value Area (%)", 10, 99),
  // 16 SMC
  smcSwingLength: barLen("ความกว้าง Swing pivot", 200),
  smcEquilibriumBand: mult("ความกว้างโซน Equilibrium (0–0.9)", 0, 0.9),
  // 17 Squeeze Momentum
  squeezeBbLength: barLen("ช่วง Bollinger"),
  squeezeBbMult: mult("ตัวคูณ BB", 0.5, 10),
  squeezeKcLength: barLen("ช่วง Keltner"),
  squeezeKcMult: mult("ตัวคูณ KC", 0.5, 10),
  squeezeSetupBars: count("อายุการคลายตัว (แท่ง)", 1, 100),
  // 18 WaveTrend
  wtChannelLength: barLen("Channel length"),
  wtAverageLength: barLen("Average length"),
  wtSmoothLength: count("ปรับเรียบเส้น Signal", 1, 50),
  wtOverboughtThreshold: { label: "ระดับ Overbought", min: 0, max: 200, step: 1, integer: false },
  wtOversoldThreshold: { label: "ระดับ Oversold (ติดลบ)", min: -200, max: 0, step: 1, integer: false },
  // 19 UT Bot
  utBotKeyValue: mult("ความไว (Key value)", 0.1, 10),
  utBotAtrLength: barLen("ช่วง ATR"),
  // 20 Lorentzian
  lorentzianNeighborsCount: count("จำนวนเพื่อนบ้าน", 1, 32),
  lorentzianMaxBarsBack: count("แท่งย้อนหลังสูงสุดที่ค้นหา", 50, 5000),
  lorentzianFeatureCount: count("จำนวนคุณลักษณะ (2–5)", 2, 5),
  lorentzianUseVolatilityFilter: toggle("เปิดตัวกรองความผันผวน"),
  lorentzianUseRegimeFilter: toggle("เปิดตัวกรองสภาพตลาด (KLMF)"),
  lorentzianRegimeThreshold: { label: "เกณฑ์ความชัน KLMF", min: -10, max: 10, step: 0.1, integer: false },
  lorentzianUseAdxFilter: toggle("เปิดตัวกรอง ADX"),
  lorentzianAdxThreshold: level("ADX ขั้นต่ำ"),
  lorentzianUseEmaFilter: toggle("เปิดตัวกรอง EMA"),
  lorentzianEmaLength: barLen("ช่วง EMA ตัวกรอง", 1000),
  lorentzianUseSmaFilter: toggle("เปิดตัวกรอง SMA"),
  lorentzianSmaLength: barLen("ช่วง SMA ตัวกรอง", 1000),
  lorentzianUseKernelFilter: toggle("เปิด Kernel regression filter"),
  lorentzianKernelLookback: count("Kernel lookback", 2, 100),
  lorentzianKernelWeight: mult("น้ำหนักสัมพัทธ์ของ kernel", 0.1, 50),
  lorentzianKernelStartBar: count("เริ่มถ่วงน้ำหนักที่แท่งใด", 2, 100),
  lorentzianMaxHoldBars: count("จำนวนแท่งถือสูงสุด", 1, 200),
  lorentzianNeighborPool: count("ชุดเพื่อนบ้าน (1=ตามต้นฉบับ 2=หน้าต่างเลื่อน)", 1, 2),
  // ชุดตัวกรองร่วม
  filterTrendLength: barLen("EMA กรองทิศทางหลัก", 1000),
  filterSlopeBars: count("ระยะเทียบความชัน EMA (แท่ง)", 1, 200),
  filterAdxLength: barLen("ช่วง ADX/DI"),
  filterAdxThreshold: level("ADX ขั้นต่ำ", 0, 100),
  filterAtrLength: barLen("ช่วง ATR"),
  filterMaxVolRatio: mult("ATR เร็ว/ช้าสูงสุดก่อนงดเข้า", 0.5, 20),
  filterStopAtr: mult("ระยะ Stop × ATR", 0.1, 20),
  filterTrailAtr: mult("ระยะ Trailing × ATR", 0.1, 20),
  filterMinStopPct: mult("ระยะ Stop ขั้นต่ำ (%)", 0.01, 20),
  filterMaxHoldBars: count("จำนวนแท่งถือสูงสุด", 2, 2000),
  filterCooldownBars: count("พักหลังออก (แท่ง)", 0, 200),
};

// ══ รหัสกลยุทธ์ v2 ═════════════════════════════════════════════
/** ต่อท้าย _filtered = กฎเดิมบวกชุดตัวกรองร่วมและการบริหารการออก */
export type V2StrategyId = Exclude<V2BaseId, RemovedV2PlainId> | `${V2BaseId}_filtered`;

/**
 * โหมดพื้นฐานที่ถูกถอดออกจากรายการกลยุทธ์ตามคำขอของผู้ใช้ (ผลย้อนหลังบน 1h ขาดทุนหนักทุกตัว)
 * ถอดเฉพาะโหมดพื้นฐาน — โหมด `_filtered` ของอินดิเคเตอร์เดียวกันยังอยู่ จึงยังเก็บโค้ดอินดิเคเตอร์ไว้
 * (`utBotV2` ยังเป็นชั้นจังหวะของ `flowgate_utbot_v3` ด้วย)
 */
const REMOVED_V2_PLAIN = ["obv_v2", "vwap_v2", "ut_bot_v2", "macd_v2", "bollinger_v2", "stoch_rsi_v2"] as const;
type RemovedV2PlainId = (typeof REMOVED_V2_PLAIN)[number];
const REMOVED_V2_PLAIN_SET = new Set<string>(REMOVED_V2_PLAIN);

export const V2_STRATEGY_IDS: V2StrategyId[] = V2_INDICATORS.flatMap(
  d => [...(REMOVED_V2_PLAIN_SET.has(d.id) ? [] : [d.id as V2StrategyId]), `${d.id}_filtered` as V2StrategyId],
);

const V2_ID_SET = new Set<string>(V2_STRATEGY_IDS);
export function isV2StrategyId(id: string): id is V2StrategyId {
  return V2_ID_SET.has(id);
}

/** แยกรหัสกลยุทธ์เป็นอินดิเคเตอร์ต้นทางกับโหมดที่ใช้ */
export function resolveV2Strategy(id: V2StrategyId): { def: V2IndicatorDef; filtered: boolean } {
  const filtered = id.endsWith("_filtered");
  const baseId = (filtered ? id.slice(0, -"_filtered".length) : id) as V2BaseId;
  const def = V2_INDICATOR_BY_ID.get(baseId);
  if (!def) throw new Error(`ไม่พบอินดิเคเตอร์ v2: ${id}`);
  return { def, filtered };
}

/** ชุดพารามิเตอร์เริ่มต้นของกลยุทธ์นั้น (โหมด filtered จะมีพารามิเตอร์ตัวกรองเพิ่ม) */
export function v2Defaults(id: V2StrategyId): Record<string, number> {
  const { def, filtered } = resolveV2Strategy(id);
  return filtered ? { ...def.core, ...TRADE_FILTER_DEFAULTS } : { ...def.core };
}

/** คำนวณผลลัพธ์ของอินดิเคเตอร์ต้นทางสำหรับกลยุทธ์นั้น */
export function computeV2(
  id: V2StrategyId, k: KlineData[], params: Record<string, number> = {}, startIndex = 0,
): V2Base {
  return resolveV2Strategy(id).def.compute(k, params, startIndex);
}

/** สัญญาณที่กลยุทธ์นั้นใช้จริง: โหมดพื้นฐานใช้ signal, โหมด filtered ใช้ signalFiltered */
export function v2SignalOf(id: V2StrategyId, result: V2Base): V2Signal[] {
  return resolveV2Strategy(id).filtered ? result.signalFiltered : result.signal;
}

/**
 * จำนวนแท่งอุ่นเครื่องที่กลยุทธ์ v2 ต้องการก่อนให้สัญญาณที่เชื่อถือได้
 * Lorentzian ต้องการเป็นพิเศษเพราะไม่เริ่มทำนายเลยจนกว่าจะมีแท่งครบ maxBarsBack
 */
export function v2WarmupBars(id: V2StrategyId, params: Record<string, number> = {}): number {
  const { def } = resolveV2Strategy(id);
  const merged = { ...v2Defaults(id), ...params };
  if (def.id === "lorentzian_v2")
    return Math.round(merged.lorentzianMaxBarsBack ?? LORENTZIAN_V2_CORE.lorentzianMaxBarsBack) + 300;
  let longest = 0;
  for (const [key, value] of Object.entries(merged)) {
    const meta = V2_PARAM_META[key];
    // นับเฉพาะพารามิเตอร์ที่เป็นช่วงย้อนหลังจริง ไม่นับจำนวนช่อง/เพื่อนบ้าน/ตัวคูณ
    if (meta?.integer && meta.max >= 50 && Number.isFinite(value)) longest = Math.max(longest, value);
  }
  return Math.min(2000, Math.max(300, longest * 5));
}

/**
 * ตรวจความสมเหตุสมผลของพารามิเตอร์ที่เกี่ยวพันกัน
 * คืนข้อความภาษาไทยเมื่อไม่ผ่าน หรือ null เมื่อผ่าน
 */
export function validateV2Params(id: V2StrategyId, p: Record<string, number>): string | null {
  const { def } = resolveV2Strategy(id);
  switch (def.id) {
    case "sma_v2":
      return p.smaFastLength >= p.smaSlowLength ? "SMA เร็วต้องสั้นกว่า SMA ช้า" : null;
    case "ema_v2":
      return p.emaFastLength >= p.emaSlowLength ? "EMA เร็วต้องสั้นกว่า EMA ช้า" : null;
    case "rsi_v2":
      return p.rsiBuyThreshold >= p.rsiSellThreshold ? "ระดับ Oversold ต้องน้อยกว่าระดับ Overbought" : null;
    case "macd_v2":
      return p.macdFastLength >= p.macdSlowLength ? "MACD: EMA เร็วต้องสั้นกว่า EMA ช้า" : null;
    case "stochastic_v2":
      return p.stochOversoldThreshold >= p.stochOverboughtThreshold
        ? "Stochastic: ระดับ Oversold ต้องน้อยกว่า Overbought" : null;
    case "stoch_rsi_v2":
      return p.stochRsiOversoldThreshold >= p.stochRsiOverboughtThreshold
        ? "Stochastic RSI: ระดับ Oversold ต้องน้อยกว่า Overbought" : null;
    case "adx_v2":
      return p.adxExitThreshold > p.adxThreshold
        ? "ADX: เกณฑ์ออกต้องไม่สูงกว่าเกณฑ์เข้า" : null;
    case "ichimoku_v2":
      return p.ichimokuTenkanLength >= p.ichimokuKijunLength || p.ichimokuKijunLength >= p.ichimokuSenkouBLength
        ? "Ichimoku: ต้องเรียงจากสั้นไปยาว Tenkan < Kijun < Senkou B" : null;
    case "wavetrend_v2":
      return p.wtOversoldThreshold >= p.wtOverboughtThreshold
        ? "WaveTrend: ระดับ Oversold ต้องน้อยกว่า Overbought" : null;
    case "atr_v2":
      return p.atrLength >= p.atrExpansionLength
        ? "ATR: ช่วงเทียบการขยายตัวต้องยาวกว่าช่วง ATR" : null;
    case "bollinger_v2":
      return p.bbLength >= p.bbSqueezeLength
        ? "Bollinger: ช่วงอ้างอิงความกว้างกรอบต้องยาวกว่าช่วง Bollinger" : null;
    default:
      return null;
  }
}
