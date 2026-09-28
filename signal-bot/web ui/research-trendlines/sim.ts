/**
 * ตัวจำลองการซื้อขาย Long-only ของ Trendlines with Breaks หลายแบบ สำหรับ walk-forward
 *
 * ทุกแบบใช้เส้นชุดเดียวกับ `trendlinesWithBreaks()` (ตรวจเทียบทุกครั้งใน `trendLines`)
 * ต่างกันแค่ "เข้า/ออกเมื่อไร และที่ราคาไหน":
 *   A    = บอทเดิม · สตรีมหลัง `alternateSignals` · เข้า/ออกที่ราคาปิดแท่งสัญญาณ (ตรงกับ runBacktest)
 *   B    = ซื้อแบบ A · ขายทุกครั้งที่ปิดใต้เส้นล่าง แม้เส้นนั้นเคยถูกทะลุแล้ว
 *   C    = ซื้อทุกครั้งที่ปิดเหนือเส้นบน · ขายแบบ B
 *   D    = stop order กลางแท่งทั้งซื้อและขาย ที่ราคาเส้นที่ลากต่อจากแท่งก่อน
 *   D1   = ซื้อ stop กลางแท่ง · ขายแบบ B
 *   D2   = ซื้อแบบ A · ขาย stop กลางแท่ง
 *   G2/3 = ซื้อแบบ A · ขายเมื่อ SELL หรือราคาปิดต่ำกว่าจุดสูงสุดตั้งแต่เข้า − 2 / 3 × ATR
 *
 * เพิ่มแบบใหม่: เพิ่มชื่อใน VARIANTS แล้วเพิ่มกิ่งใน `simulate` — ผลเก่าใน cache จะถูกคำนวณใหม่อัตโนมัติ
 * เพราะ walk-forward.ts ใช้ SHA-256 ของไฟล์นี้เป็นส่วนหนึ่งของ cache key
 */
import { alternateSignals } from "../../../lib/backtest";
import { atr, pivotEvents, trendlinesWithBreaks } from "../../../lib/indicators";
import type { KlineData } from "../../../lib/types/kline";

export const VARIANTS = ["A", "B", "C", "D", "D1", "D2", "G2", "G3"] as const;
export type Variant = typeof VARIANTS[number];
export const VARIANT_LABEL: Record<Variant, string> = {
  A: "บอทเดิม (ราคาปิดแท่ง)",
  B: "ขายทุกครั้งที่ปิดใต้เส้น",
  C: "ซื้อ/ขายทุกครั้งที่ปิดนอกเส้น",
  D: "stop กลางแท่ง ซื้อ+ขาย",
  D1: "ซื้อ stop กลางแท่ง · ขายแบบ B",
  D2: "ขาย stop กลางแท่ง",
  G2: "Trailing 2×ATR",
  G3: "Trailing 3×ATR",
};

export interface Series {
  o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array;
}
export const toSeries = (k: KlineData[]): Series => ({
  o: Float64Array.from(k, (x) => +x.open), h: Float64Array.from(k, (x) => +x.high),
  l: Float64Array.from(k, (x) => +x.low), c: Float64Array.from(k, (x) => +x.close),
});

export interface Lines {
  upper: Float64Array; lower: Float64Array;
  /** ราคาเส้นที่รู้ตั้งแต่เปิดแท่ง (ลากต่อจากแท่งก่อน) — ใช้วาง stop order · NaN = ยังไม่มีเส้น */
  upProj: Float64Array; loProj: Float64Array;
  isPh: Uint8Array; hasPh: Uint8Array; hasPl: Uint8Array;
  atr: Float64Array;
  /** สัญญาณดิบ (1 BUY / −1 SELL) และสตรีมหลังกฎสลับของบอท */
  raw: Int8Array; stream: Int8Array;
}

export function trendLines(k: KlineData[], len: number, mult = 1.0): Lines {
  const n = k.length;
  const pv = pivotEvents(k.map((x) => +x.high), k.map((x) => +x.low), len, len, true);
  const a = atr(k, len);
  const ref = trendlinesWithBreaks(k, len, mult, "Atr", true);
  const L: Lines = {
    upper: new Float64Array(n), lower: new Float64Array(n), upProj: new Float64Array(n), loProj: new Float64Array(n),
    isPh: new Uint8Array(n), hasPh: new Uint8Array(n), hasPl: new Uint8Array(n), atr: Float64Array.from(a, (x) => x ?? 0),
    raw: Int8Array.from(ref.signal, (s) => (s === "BUY" ? 1 : s === "SELL" ? -1 : 0)),
    stream: Int8Array.from(alternateSignals(ref.signal.map((s) => s ?? "HOLD")), (s) => (s === "BUY" ? 1 : s === "SELL" ? -1 : 0)),
  };
  let cu = 0, cl = 0, sph = 0, spl = 0, hasPh = false, hasPl = false;
  for (let i = 0; i < n; i++) {
    const slope = ((a[i] ?? 0) / len) * mult;
    L.upProj[i] = hasPh ? cu - sph : NaN;
    L.loProj[i] = hasPl ? cl + spl : NaN;
    if (pv.highPrice[i] !== null) { cu = pv.highPrice[i]!; sph = slope; hasPh = true; L.isPh[i] = 1; } else cu -= sph;
    if (pv.lowPrice[i] !== null) { cl = pv.lowPrice[i]!; spl = slope; hasPl = true; } else cl += spl;
    L.upper[i] = cu; L.lower[i] = cl; L.hasPh[i] = hasPh ? 1 : 0; L.hasPl[i] = hasPl ? 1 : 0;
    if (Math.abs(cu - ref.upper[i]!) > 1e-9 * Math.max(1, cu) || Math.abs(cl - ref.lower[i]!) > 1e-9 * Math.max(1, cl))
      throw Error(`เส้นไม่ตรงกับ trendlinesWithBreaks ที่แท่ง ${i}`);
  }
  return L;
}

export interface Costs { feePct: number; slipPct: number }
export interface Result {
  /** ผลตอบแทนทบต้น % · ผลรวม % ต่อไม้แบบเว็บ · drawdown % ของ equity ราคาปิด · จำนวนไม้ */
  comp: number; sum: number; mdd: number; trades: number; wins: number;
}
/** equity ต่อเนื่องข้ามหลายช่วง (ใช้ต่อผลช่วงทดสอบของ walk-forward) */
export interface Chain { eq: number; peak: number; mdd: number }

/**
 * จำลองช่วง [s, e) เริ่มสถานะว่าง ไม้ที่ค้างปิดที่ราคาปิดแท่งสุดท้าย (แบบเดียวกับเว็บ)
 * stop order: fill ที่ราคาเส้น หรือราคาเปิดถ้ากระโดดข้าม · ถ้าราคาอยู่เลยเส้นขายไปแล้วตอนซื้อ ขายทันทีที่ราคาซื้อ
 */
export function simulate(S: Series, L: Lines, v: Variant, s: number, e: number, cost: Costs, chain?: Chain): Result {
  const { o, h, l, c } = S;
  const fee = cost.feePct / 100, slip = cost.slipPct / 100;
  let inPos = false, entry = 0, peak = 0, eq = 1, eqPeak = 1, mdd = 0, sum = 0, n = 0, wins = 0;
  let upos = 1; // D/D1: เส้นบนเส้นปัจจุบันถูกทะลุแล้วหรือยัง (1 = ใช้แล้ว รอ pivot ใหม่)
  const exit = (px: number) => {
    const g = (px - entry) / entry;
    sum += g * 100 - 2 * cost.feePct; eq *= (1 + g) * (1 - fee) ** 2; n++; if (px > entry) wins++; inPos = false;
  };
  const enter = (px: number) => { inPos = true; entry = px; peak = px; };
  for (let i = s; i < e; i++) {
    const brkDn = L.hasPl[i] === 1 && c[i] < L.lower[i];
    switch (v) {
      case "A":
        if (!inPos && L.stream[i] === 1) enter(c[i]);
        else if (inPos && L.stream[i] === -1) exit(c[i]);
        break;
      case "G2": case "G3": {
        const m = v === "G2" ? 2 : 3;
        if (!inPos && L.raw[i] === 1) enter(c[i]);
        else if (inPos) {
          peak = Math.max(peak, c[i]);
          if (L.raw[i] === -1 || c[i] < peak - m * L.atr[i]) exit(c[i]);
        }
        break;
      }
      case "B":
        if (!inPos && L.raw[i] === 1) enter(c[i]);
        else if (inPos && brkDn) exit(c[i]);
        break;
      case "C":
        if (!inPos && L.isPh[i] === 0 && !Number.isNaN(L.upProj[i]) && c[i] > L.upper[i] && !brkDn) enter(c[i]);
        else if (inPos && brkDn) exit(c[i]);
        break;
      case "D": case "D1": {
        let fill = NaN;
        if (upos === 0 && !Number.isNaN(L.upProj[i]) && h[i] >= L.upProj[i]) {
          if (!inPos) { fill = Math.max(o[i], L.upProj[i]); enter(fill * (1 + slip)); }
          upos = 1;
        }
        if (inPos) {
          if (v === "D1") { if (brkDn) exit(c[i]); }
          else if (!Number.isNaN(L.loProj[i]) && l[i] <= L.loProj[i])
            exit(Math.min(Number.isNaN(fill) ? o[i] : fill, L.loProj[i]) * (1 - slip));
        }
        if (L.isPh[i]) upos = 0;
        break;
      }
      case "D2":
        if (inPos && !Number.isNaN(L.loProj[i]) && l[i] <= L.loProj[i]) exit(Math.min(o[i], L.loProj[i]) * (1 - slip));
        else if (!inPos && L.raw[i] === 1 && !(L.hasPl[i] && c[i] <= L.lower[i])) enter(c[i]);
        break;
    }
    const mtm = inPos ? eq * (c[i] / entry) : eq;
    if (mtm > eqPeak) eqPeak = mtm;
    if (1 - mtm / eqPeak > mdd) mdd = 1 - mtm / eqPeak;
    if (chain) {
      const ce = chain.eq * mtm;
      if (ce > chain.peak) chain.peak = ce;
      if (1 - ce / chain.peak > chain.mdd) chain.mdd = 1 - ce / chain.peak;
    }
  }
  if (inPos) exit(c[e - 1]);
  if (chain) chain.eq *= eq;
  return { comp: (eq - 1) * 100, sum, mdd: mdd * 100, trades: n, wins };
}
