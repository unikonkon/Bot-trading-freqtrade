/**
 * ตัวสร้างป้าย BUY/SELL จาก RSI หลายแบบ สำหรับเทียบกับ Trendlines with Breaks
 *
 * ทุกแบบให้ "ป้ายดิบ" ที่ราคาปิดแท่ง (1 BUY / −1 SELL / 0) แล้วผ่านกฎสลับเดียวกับบอท (BUY → SELL → BUY …)
 * ผลลัพธ์อยู่ในรูป Lines (แทน stream/raw ของเส้นเทรนด์) จึงใช้ simulateSide และกฎออกทุกแบบของ enhance.ts ได้ทันที
 * ATR ที่ใช้กับ TP/SL = ATR(14) ของราคา (ตัวเดียวกับ Pine เดิม)
 *
 * แบบที่มี (n = ความยาว RSI แบบ Wilder = ta.rsi):
 *   level   RSI < lo = BUY · RSI > hi = SELL (แบบ "rsi" ของแอปเดิม)
 *   revert  RSI ตัดขึ้นผ่าน lo = BUY · ตัดลงผ่าน hi = SELL (รอให้กลับตัวก่อน)
 *   cross   RSI ตัดขึ้นผ่าน 50 + h = BUY · ตัดลงผ่าน 50 − h = SELL (โมเมนตัม มีช่วงกันสั่น h)
 *   signal  RSI ตัดเส้น EMA(RSI, m) ขึ้น/ลง (เหมือน MACD บน RSI)
 *   tl      เส้นเทรนด์ LuxAlgo บน "กราฟ RSI": pivot ของ RSI · slope = ATR ของ RSI / len · RSI ทะลุเส้น = ป้าย
 *   hybrid  ป้ายดิบของเส้นเทรนด์ราคา ∪ ป้าย cross ของ RSI แล้วค่อยสลับ (ป้ายมากกว่าเส้นเทรนด์อย่างเดียว)
 */
import type { KlineData } from "../../../lib/types/kline";
import type { Lines, Series } from "./sim";
import { trendLines } from "./sim";

export type RsiGen =
  | { kind: "level" | "revert"; n: number; lo: number; hi: number }
  | { kind: "cross"; n: number; h: number }
  | { kind: "signal"; n: number; m: number }
  | { kind: "tl"; n: number; len: number }
  | { kind: "hybrid"; n: number; h: number };

export function genId(g: RsiGen): string {
  switch (g.kind) {
    case "level": case "revert": return `${g.kind}${g.n}:${g.lo}/${g.hi}`;
    case "cross": case "hybrid": return `${g.kind}${g.n}:±${g.h}`;
    case "signal": return `signal${g.n}:ema${g.m}`;
    case "tl": return `tl${g.n}:len${g.len}`;
  }
}

export function genLabel(g: RsiGen): string {
  switch (g.kind) {
    case "level": return `RSI(${g.n}) < ${g.lo} ซื้อ · > ${g.hi} ขาย (แบบแอปเดิม)`;
    case "revert": return `RSI(${g.n}) ตัดขึ้น ${g.lo} ซื้อ · ตัดลง ${g.hi} ขาย`;
    case "cross": return `RSI(${g.n}) ตัดขึ้น ${50 + g.h} ซื้อ · ตัดลง ${50 - g.h} ขาย`;
    case "signal": return `RSI(${g.n}) ตัดเส้น EMA${g.m} ของ RSI`;
    case "tl": return `เส้นเทรนด์บน RSI(${g.n}) · pivot ${g.len}`;
    case "hybrid": return `เส้นเทรนด์ราคา + RSI(${g.n}) ตัด ${50 + g.h}/${50 - g.h}`;
  }
}

/** RSI แบบ Wilder (เหมือน lib/indicators.ts `rsi` และ ta.rsi) · NaN ก่อนพร้อม */
export function rsiW(c: Float64Array, n: number): Float64Array {
  const out = new Float64Array(c.length).fill(NaN);
  let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
    if (i < n) { g += up; l += dn; continue; }
    if (i === n) { g = (g + up) / n; l = (l + dn) / n; }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
    out[i] = l === 0 ? 100 : g === 0 ? 0 : 100 - 100 / (1 + g / l);
  }
  return out;
}

/** EMA ที่เริ่มด้วย SMA ของค่าแรกที่พร้อม m ค่า (ข้าม NaN ต้นอนุกรม) */
export function emaFrom(x: Float64Array, m: number): Float64Array {
  const out = new Float64Array(x.length).fill(NaN), a = 2 / (m + 1);
  let e = NaN, cnt = 0, sum = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(x[i])) continue;
    if (Number.isNaN(e)) { sum += x[i]; cnt++; if (cnt === m) e = sum / m; }
    else e = x[i] * a + e * (1 - a);
    out[i] = e;
  }
  return out;
}

/** กฎสลับของบอท: เริ่มรอ BUY · BUY แล้วรอ SELL · SELL แล้วรอ BUY */
export function alternate(raw: Int8Array): Int8Array {
  const out = new Int8Array(raw.length);
  let st = 0;
  for (let i = 0; i < raw.length; i++) {
    if (st === 0 && raw[i] === 1) { out[i] = 1; st = 1; }
    else if (st === 1 && raw[i] === -1) { out[i] = -1; st = 0; }
  }
  return out;
}

/** ป้ายดิบของแต่ละแบบ (SELL ทับ BUY ถ้าเกิดแท่งเดียวกัน) */
export function rsiRaw(k: KlineData[], S: Series, L: Lines, g: RsiGen): Int8Array {
  const n = S.c.length, raw = new Int8Array(n), r = rsiW(S.c, g.n);
  const upX = (lv: number, i: number) => r[i] > lv && r[i - 1] <= lv;
  const dnX = (lv: number, i: number) => r[i] < lv && r[i - 1] >= lv;
  if (g.kind === "tl") {
    // เส้นเทรนด์บน RSI: แท่งเทียมที่ open = high = low = close = RSI (ATR = RMA ของ |RSI เปลี่ยน|)
    const fake = k.map((x, i) => {
      const v = String(Number.isNaN(r[i]) ? 50 : r[i]);
      return { ...x, open: v, high: v, low: v, close: v };
    });
    return trendLines(fake, g.len).raw;
  }
  const sig = g.kind === "signal" ? emaFrom(r, g.m) : undefined;
  for (let i = 1; i < n; i++) {
    if (Number.isNaN(r[i]) || Number.isNaN(r[i - 1])) continue;
    let b = false, s = false;
    switch (g.kind) {
      case "level": b = r[i] < g.lo; s = r[i] > g.hi; break;
      case "revert": b = upX(g.lo, i); s = dnX(g.hi, i); break;
      case "cross": case "hybrid": b = upX(50 + g.h, i); s = dnX(50 - g.h, i); break;
      case "signal":
        if (!Number.isNaN(sig![i - 1])) { b = r[i] > sig![i] && r[i - 1] <= sig![i - 1]; s = r[i] < sig![i] && r[i - 1] >= sig![i - 1]; }
        break;
    }
    if (g.kind === "hybrid") { b ||= L.raw[i] === 1; s ||= L.raw[i] === -1; }
    raw[i] = s ? -1 : b ? 1 : 0;
  }
  return raw;
}

/** Lines ของเส้นเทรนด์ราคา แต่เปลี่ยนป้ายเป็นของ RSI (ใช้กับ simulateSide ได้ตรง ๆ) */
export function rsiLines(k: KlineData[], S: Series, L: Lines, g: RsiGen): Lines {
  const raw = rsiRaw(k, S, L, g);
  return { ...L, raw, stream: alternate(raw) };
}
