/**
 * Trendlines with Breaks + indicator เสริม โดยจำนวนเทรด ≥ บอทเดิมเสมอ
 *
 * ทุกป้ายเข้าของบอท (สตรีมหลัง alternateSignals) ยังเปิดไม้ที่ราคาปิดแท่งสัญญาณเหมือนเดิม ไม่มีการกรองทิ้ง
 * indicator เสริมทำได้ 3 อย่าง:
 *   1) เลือกกฎออกตามสภาพตลาด (regime) ณ แท่งเข้า — ไม้ตามเทรนด์ใช้ `exit` · ไม้สวนเทรนด์ใช้ `counter`
 *   2) ออกด้วยสัญญาณ indicator ที่ราคาปิด (Supertrend กลับทิศ, ปิดตัด EMA, หลุด Donchian, RSI สุดทาง)
 *   3) เข้าซ้ำ (re-entry) เมื่อไม่มีไม้ฝั่งนั้นและ indicator ยืนยันเทรนด์ใหม่ → จำนวนเทรดเพิ่ม
 *      ไม้เข้าซ้ำที่ถือมาถึงป้ายเข้าจริงของบอท: ถือต่อเป็นไม้เดียว เปลี่ยนไปใช้กฎออกของไม้ปกติ (ราคาเข้าเดิม · ATR ณ แท่งป้าย)
 *      ป้ายเข้าที่ถูกรวมแบบนี้หนึ่งป้าย ใช้ไม้เข้าซ้ำหนึ่งไม้เสมอ จำนวนไม้จึงไม่น้อยกว่าบอทเดิม
 *
 * Long และ Short จำลองแยกบัญชีเหมือนตารางใน Pine (สองฝั่ง = Long + Short)
 * กฎออกแบบคำสั่ง (stop/limit) ใช้ความหมายเดียวกับ exits.ts ทุกอย่าง
 */
import { directionalMovement, ema, rsi, supertrend } from "../../../lib/indicators";
import type { KlineData } from "../../../lib/types/kline";
import { EXIT_RULES, ruleLabel, type ExitRule } from "./exits";
import type { Costs, Lines, Series } from "./sim";

// ─── Indicators ─────────────────────────────────────────────────
export interface Ind {
  ema20: Float64Array; ema50: Float64Array; ema200: Float64Array;
  rsi: Float64Array; adx: Float64Array; pdi: Float64Array; mdi: Float64Array;
  /** Supertrend(10, 3) ของ lib/indicators.ts: 1 ขาขึ้น · −1 ขาลง · 0 ยังไม่พร้อม */
  st: Int8Array;
  /** สูงสุด/ต่ำสุดของ n แท่งก่อนหน้า (ไม่รวมแท่งนี้) = ta.highest(high, n)[1] */
  hi20: Float64Array; lo20: Float64Array; hi10: Float64Array; lo10: Float64Array;
}

const toF = (a: (number | null)[]) => Float64Array.from(a, (x) => (x === null ? NaN : x));
function prevExtreme(x: Float64Array, n: number, hi: boolean): Float64Array {
  const out = new Float64Array(x.length).fill(NaN);
  for (let i = n; i < x.length; i++) {
    let m = hi ? -Infinity : Infinity;
    for (let j = i - n; j < i; j++) m = hi ? Math.max(m, x[j]) : Math.min(m, x[j]);
    out[i] = m;
  }
  return out;
}

export function indicators(k: KlineData[], S: Series): Ind {
  const c = Array.from(S.c), dm = directionalMovement(k, 14);
  return {
    ema20: toF(ema(c, 20)), ema50: toF(ema(c, 50)), ema200: toF(ema(c, 200)),
    rsi: toF(rsi(c, 14)), adx: toF(dm.adx), pdi: toF(dm.plusDI), mdi: toF(dm.minusDI),
    st: Int8Array.from(supertrend(k, 10, 3).trend, (x) => x ?? 0),
    hi20: prevExtreme(S.h, 20, true), lo20: prevExtreme(S.l, 20, false),
    hi10: prevExtreme(S.h, 10, true), lo10: prevExtreme(S.l, 10, false),
  };
}

// ─── Config ─────────────────────────────────────────────────────
export type Regime = "ema200" | "st" | "adx";
export type Trigger = "st" | "don20" | "ema20x50" | "emaX50";
/** ออกด้วย indicator ที่ราคาปิด (Long; Short กลับด้าน) */
export interface IndExit { st?: boolean; ema?: 20 | 50; don?: 10 | 20; rsi?: number }
/** rule = คีย์ใน EXIT_RULES (none / TP / SL / trailing ...) + indicator exit */
export interface Exit { rule: string; ind?: IndExit }
export interface SideCfg {
  exit: Exit;
  regime?: Regime;
  counter?: Exit;
  re?: { trig: Trigger; gate: boolean; exit: Exit };
}
export interface SideOut { comp: number; sum: number; mdd: number; trades: number; wins: number; early: number; re: number }

/** ทิศเทรนด์ ณ ราคาปิดแท่ง i: 1 ขึ้น · −1 ลง · 0 ไม่ชัด/ยังไม่พร้อม */
export function regimeAt(I: Ind, id: Regime, c: Float64Array, i: number): number {
  if (id === "ema200") return Number.isNaN(I.ema200[i]) ? 0 : c[i] > I.ema200[i] ? 1 : -1;
  if (id === "st") return I.st[i];
  if (Number.isNaN(I.adx[i]) || I.adx[i] < 20) return 0;
  return I.pdi[i] > I.mdi[i] ? 1 : -1;
}

// ─── Labels ─────────────────────────────────────────────────────
export const REGIME_LABEL: Record<Regime, string> = { ema200: "EMA200", st: "Supertrend(10,3)", adx: "ADX(14)>20 + DI" };
export const TRIGGER_LABEL: Record<Trigger, string> = {
  st: "Supertrend กลับทิศ", don20: "ทะลุ Donchian 20", ema20x50: "EMA20 ตัด EMA50", emaX50: "ปิดข้าม EMA50",
};
export function exitLabel(x: Exit): string {
  const parts: string[] = x.rule === "none" ? [] : [ruleLabel(x.rule)];
  const d = x.ind;
  if (d?.st) parts.push("Supertrend กลับทิศ");
  if (d?.ema) parts.push(`ปิดตัด EMA${d.ema}`);
  if (d?.don) parts.push(`หลุด Donchian ${d.don}`);
  if (d?.rsi) parts.push(`RSI ${d.rsi} (Short ${100 - d.rsi})`);
  return parts.length ? parts.join(" + ") : "ตามป้าย";
}
export function cfgLabel(cfg: SideCfg, mult = 1): string {
  const parts: string[] = [];
  if (mult !== 1) parts.push(`Slope × ${mult}`);
  if (cfg.regime) parts.push(`${REGIME_LABEL[cfg.regime]}: ตามเทรนด์ ${exitLabel(cfg.exit)} · สวนเทรนด์ ${exitLabel(cfg.counter ?? cfg.exit)}`);
  else parts.push(`ออก ${exitLabel(cfg.exit)}`);
  if (cfg.re) parts.push(`เข้าซ้ำเมื่อ ${TRIGGER_LABEL[cfg.re.trig]}${cfg.re.gate ? " (ฝั่งเดียวกับ EMA200)" : ""} → ออก ${exitLabel(cfg.re.exit)}`);
  return parts.join(" · ");
}

// ─── Simulation ─────────────────────────────────────────────────
/**
 * จำลองฝั่งเดียว (sd = 1 Long · −1 Short) ช่วง [s, e) เริ่มว่าง · ไม้ค้างตอนจบปิดที่ราคาปิดแท่งสุดท้าย
 * ลำดับในแท่ง: คำสั่ง stop/limit → กฎที่ราคาปิด → ป้ายของบอท → เข้าซ้ำ → วางคำสั่งสำหรับแท่งถัดไป
 */
export function simulateSide(S: Series, L: Lines, I: Ind, sd: 1 | -1, cfg: SideCfg, s: number, e: number, cost: Costs): SideOut {
  const { o, h, l, c } = S;
  const fee = cost.feePct / 100, slip = cost.slipPct / 100;
  let inPos = false, closedAt = -1, r: ExitRule = {}, ie: IndExit | undefined;
  let entry = 0, atrE = 0, ext = 0, extC = 0, held = 0, stop = NaN, limit = NaN;
  let eq = 1, eqPeak = 1, mdd = 0, sum = 0, n = 0, wins = 0, early = 0, nRe = 0;

  const use = (x: Exit) => { r = EXIT_RULES[x.rule]; ie = x.ind; if (!r) throw Error(`ไม่รู้จักกฎ ${x.rule}`); };
  const normalExit = (i: number) => (cfg.regime && regimeAt(I, cfg.regime, c, i) !== sd ? cfg.counter ?? cfg.exit : cfg.exit);
  const open = (i: number, x: Exit) => {
    inPos = true; entry = c[i]; atrE = L.atr[i]; ext = extC = c[i]; held = 0; n++; use(x);
  };
  const exit = (px: number, isEarly: boolean, i: number) => {
    const g = (sd * (px - entry)) / entry;
    sum += g * 100 - 2 * cost.feePct;
    eq = Math.max(0, eq * (1 + g) * (1 - fee) ** 2);
    if (g > 0) wins++;
    if (isEarly) early++;
    inPos = false; stop = NaN; limit = NaN; closedAt = i;
  };
  const arm = (i: number) => {
    stop = NaN;
    const add = (x: number) => {
      if (!Number.isNaN(x)) stop = Number.isNaN(stop) ? x : sd === 1 ? Math.max(stop, x) : Math.min(stop, x);
    };
    if (r.ts?.exec === "order") add(ext - sd * r.ts.m * L.atr[i]);
    if (r.sl?.exec === "order") add(entry - sd * r.sl.m * atrE);
    if (r.be !== undefined && sd * (ext - entry) >= r.be * atrE) add(entry * (1 + sd * 2 * fee));
    if (r.line === "order" && i + 1 < c.length) add(sd === 1 ? L.loProj[i + 1] : L.upProj[i + 1]);
    limit = r.tp?.exec === "order" ? entry + sd * r.tp.m * atrE : NaN;
  };
  const crossUp = (a: Float64Array, b: Float64Array, i: number) => a[i] > b[i] && a[i - 1] <= b[i - 1];
  const crossDn = (a: Float64Array, b: Float64Array, i: number) => a[i] < b[i] && a[i - 1] >= b[i - 1];
  const cUp = (b: Float64Array, i: number) => c[i] > b[i] && c[i - 1] <= b[i - 1];
  const cDn = (b: Float64Array, i: number) => c[i] < b[i] && c[i - 1] >= b[i - 1];
  const indHit = (i: number) => {
    const d = ie;
    if (!d || i < 1) return false;
    if (d.st && I.st[i] === -sd && I.st[i - 1] === sd) return true;
    if (d.ema) { const m = d.ema === 20 ? I.ema20 : I.ema50; if (sd === 1 ? cDn(m, i) : cUp(m, i)) return true; }
    if (d.don) {
      const lo = d.don === 10 ? I.lo10 : I.lo20, hi = d.don === 10 ? I.hi10 : I.hi20;
      if (sd === 1 ? c[i] < lo[i] : c[i] > hi[i]) return true;
    }
    if (d.rsi) {
      const lv = sd === 1 ? d.rsi : 100 - d.rsi;
      if (sd === 1 ? I.rsi[i] >= lv && I.rsi[i - 1] < lv : I.rsi[i] <= lv && I.rsi[i - 1] > lv) return true;
    }
    return false;
  };
  const trigger = (t: Trigger, i: number) => {
    if (i < 1) return false;
    if (t === "st") return I.st[i] === sd && I.st[i - 1] === -sd;
    if (t === "don20") return sd === 1 ? cUp(I.hi20, i) : cDn(I.lo20, i);
    if (t === "ema20x50") return sd === 1 ? crossUp(I.ema20, I.ema50, i) : crossDn(I.ema20, I.ema50, i);
    return sd === 1 ? cUp(I.ema50, i) : cDn(I.ema50, i);
  };

  for (let i = s; i < e; i++) {
    // 1) คำสั่งที่วางไว้ตั้งแต่ปิดแท่งก่อน: ราคาเปิดกระโดดข้ามก่อน แล้วค่อยดูสูง/ต่ำของแท่ง (stop ก่อน limit)
    if (inPos) {
      held++;
      const adverse = sd === 1 ? l[i] : h[i], favor = sd === 1 ? h[i] : l[i];
      if (!Number.isNaN(stop) && sd * (o[i] - stop) <= 0) exit(o[i] * (1 - sd * slip), true, i);
      else if (!Number.isNaN(limit) && sd * (o[i] - limit) >= 0) exit(o[i], true, i);
      else if (!Number.isNaN(stop) && sd * (adverse - stop) <= 0) exit(stop * (1 - sd * slip), true, i);
      else if (!Number.isNaN(limit) && sd * (favor - limit) >= 0) exit(limit, true, i);
    }
    // 2) กฎที่ราคาปิด (กฎเดิมของ exits.ts + indicator)
    if (inPos) {
      ext = sd === 1 ? Math.max(ext, h[i]) : Math.min(ext, l[i]);
      extC = sd === 1 ? Math.max(extC, c[i]) : Math.min(extC, c[i]);
      if ((r.ts?.exec === "close" && sd * (c[i] - extC) < -r.ts.m * L.atr[i])
        || (r.sl?.exec === "close" && sd * (c[i] - entry) < -r.sl.m * atrE)
        || (r.tp?.exec === "close" && sd * (c[i] - entry) >= r.tp.m * atrE)
        || (r.line === "close" && (sd === 1 ? L.hasPl[i] === 1 && c[i] < L.lower[i] : L.hasPh[i] === 1 && c[i] > L.upper[i]))
        || (r.time !== undefined && held >= r.time)
        || indHit(i)) exit(c[i], true, i);
    }
    // 3) ป้ายของบอท: ป้ายตรงข้ามปิดไม้ · ป้ายเข้าเปิดไม้ (หรือรับไม้เข้าซ้ำที่ถืออยู่มาเป็นไม้ปกติ)
    const sig = L.stream[i];
    if (sig === -sd) {
      if (inPos) exit(c[i], false, i);
    } else if (sig === sd) {
      if (inPos) { use(normalExit(i)); atrE = L.atr[i]; }
      else open(i, normalExit(i));
    } else if (!inPos && cfg.re && closedAt !== i && trigger(cfg.re.trig, i)
      && (!cfg.re.gate || (!Number.isNaN(I.ema200[i]) && sd * (c[i] - I.ema200[i]) > 0))) {
      // 4) เข้าซ้ำ: ยังไม่มีไม้ฝั่งนี้ และ indicator เพิ่งยืนยันเทรนด์ (ไม่เข้าในแท่งเดียวกับที่เพิ่งปิด)
      open(i, cfg.re.exit);
      nRe++;
    }
    if (inPos) arm(i);

    const mtm = inPos ? Math.max(0, eq * (1 + (sd * (c[i] - entry)) / entry)) : eq;
    if (mtm > eqPeak) eqPeak = mtm;
    if (eqPeak > 0 && 1 - mtm / eqPeak > mdd) mdd = 1 - mtm / eqPeak;
  }
  if (inPos) exit(c[e - 1], false, e - 1);
  return { comp: (eq - 1) * 100, sum, mdd: mdd * 100, trades: n, wins, early, re: nRe };
}
