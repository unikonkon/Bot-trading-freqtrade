/**
 * ออกก่อนป้ายตรงข้าม โดยจุดเข้าเหมือนบอทเดิมทุกไม้ → จำนวนเทรดเท่าเดิมเสมอ
 *
 * จุดเข้า = ป้าย BUY/SELL ของบอท (สตรีมหลัง alternateSignals) ที่ราคาปิดแท่งสัญญาณ เหมือน Pine และ runBacktest
 * จุดออก = ป้ายตรงข้าม หรือกฎด้านล่างที่ถึงก่อน · ออกแล้วรอป้ายเข้าถัดไป ไม่เข้าซ้ำระหว่างทาง
 *
 * ส่วนประกอบของกฎ (รวมกันได้ ตัวที่ถึงก่อนเป็นตัวปิด) · ATR = ATR(length) ตัวเดียวกับที่ใช้ทำ slope
 *   ts   trailing: จุดสุดทางกำไรตั้งแต่เข้า ∓ m × ATR ล่าสุด
 *   sl   stop loss: ราคาเข้า ∓ m × ATR ณ แท่งเข้า
 *   tp   take profit: ราคาเข้า ± m × ATR ณ แท่งเข้า
 *   be   breakeven: ราคาไปทางกำไรถึง a × ATR ณ แท่งเข้าแล้ว ตั้ง stop ที่ทุนรวม fee ไป-กลับ (เป็นคำสั่ง stop เสมอ)
 *   line ออกเมื่อราคาข้ามเส้นฝั่งตรงข้าม แม้เส้นนั้นเคยถูกทะลุแล้ว (Long = เส้นล่าง · Short = เส้นบน)
 *   time ออกที่ราคาปิดเมื่อถือครบ n แท่ง
 * exec "close" = ตรวจที่ราคาปิดแท่ง ออกที่ราคาปิด (แบบเดียวกับป้าย)
 * exec "order" = วาง stop / limit ไว้ในตลาดตั้งแต่เปิดแท่งถัดไป
 *   stop fill ที่ราคา stop หรือราคาเปิดถ้ากระโดดข้าม แล้วหัก slippage · limit fill ที่ราคา limit หรือราคาเปิดถ้าดีกว่า
 *   แท่งเดียวแตะทั้ง stop และ limit นับเป็น stop (ทางที่แย่กว่า) เพราะไม่รู้ลำดับราคาในแท่ง
 *
 * Short: กำไรต่อไม้ = (เข้า − ออก) / เข้า · ไม่รวม funding · equity ติดลบถือว่าล้างพอร์ต (0)
 * เพิ่มกฎใหม่: เพิ่มใน EXIT_RULES — cache ของ exits-wf.ts คำนวณใหม่เองเพราะ key มี SHA-256 ของไฟล์นี้
 */
import type { Chain, Costs, Lines, Series } from "./sim";

export type Exec = "close" | "order";
export interface ExitRule {
  ts?: { m: number; exec: Exec };
  sl?: { m: number; exec: Exec };
  tp?: { m: number; exec: Exec };
  be?: number;
  line?: Exec;
  time?: number;
}

const X = (exec: Exec) => (exec === "close" ? "c" : "o");
export const EXIT_RULES: Record<string, ExitRule> = Object.fromEntries<ExitRule>([
  ["none", {}],
  ...(["close", "order"] as const).flatMap((exec) => [
    ...[1, 1.5, 2, 3, 4, 6].map((m): [string, ExitRule] => [`ts${m}${X(exec)}`, { ts: { m, exec } }]),
    ...[1, 2, 3, 5].map((m): [string, ExitRule] => [`sl${m}${X(exec)}`, { sl: { m, exec } }]),
    ...[1, 2, 3, 5, 8, 12].map((m): [string, ExitRule] => [`tp${m}${X(exec)}`, { tp: { m, exec } }]),
    [`line${X(exec)}`, { line: exec }] as [string, ExitRule],
    ...[3, 5, 8].flatMap((tp) => [2, 3, 4].map((ts): [string, ExitRule] =>
      [`tp${tp}${X(exec)}+ts${ts}${X(exec)}`, { tp: { m: tp, exec }, ts: { m: ts, exec } }])),
  ]),
  ...[1, 2, 3].map((a): [string, ExitRule] => [`be${a}`, { be: a }]),
  ...[6, 12, 24, 48, 96].map((n): [string, ExitRule] => [`time${n}`, { time: n }]),
  ...[2, 3].flatMap((sl) => [3, 5, 8].map((tp): [string, ExitRule] =>
    [`sl${sl}o+tp${tp}o`, { sl: { m: sl, exec: "order" }, tp: { m: tp, exec: "order" } }])),
]);

/** กฎที่ตัดสินที่ราคาปิดแท่งทั้งหมด (ไม่ต้องวางคำสั่งในตลาด) */
export const isCloseOnly = (r: ExitRule) =>
  r.ts?.exec !== "order" && r.sl?.exec !== "order" && r.tp?.exec !== "order" && r.be === undefined && r.line !== "order";

export function ruleLabel(key: string): string {
  const r = EXIT_RULES[key];
  if (!r || key === "none") return "ไม่มี (บอทเดิม)";
  const how = (e: Exec) => (e === "close" ? "ปิดแท่ง" : "คำสั่ง");
  const parts: string[] = [];
  if (r.tp) parts.push(`TP ${r.tp.m}×ATR ${how(r.tp.exec)}`);
  if (r.ts) parts.push(`Trailing ${r.ts.m}×ATR ${how(r.ts.exec)}`);
  if (r.sl) parts.push(`SL ${r.sl.m}×ATR ${how(r.sl.exec)}`);
  if (r.be !== undefined) parts.push(`Breakeven หลัง +${r.be}×ATR`);
  if (r.line) parts.push(`ข้ามเส้นซ้ำ ${how(r.line)}`);
  if (r.time !== undefined) parts.push(`ถือครบ ${r.time} แท่ง`);
  return parts.join(" + ");
}

/** กฎของแต่ละฝั่ง · undefined = ไม่เทรดฝั่งนั้น (Long อย่างเดียว / Short อย่างเดียว / สองฝั่ง) */
export interface Sides { long?: ExitRule; short?: ExitRule }
export interface ExitResult { comp: number; sum: number; mdd: number; trades: number; wins: number; early: number }

/** จำลองช่วง [s, e) เริ่มสถานะว่าง · ไม้ที่ค้างตอนจบช่วงปิดที่ราคาปิดแท่งสุดท้าย (แบบเดียวกับเว็บ) */
export function simulateExits(S: Series, L: Lines, sides: Sides, s: number, e: number, cost: Costs, chain?: Chain): ExitResult {
  const { o, h, l, c } = S;
  const fee = cost.feePct / 100, slip = cost.slipPct / 100;
  let side = 0, rule: ExitRule = {};
  let entry = 0, atrE = 0, ext = 0, extC = 0, held = 0, stop = NaN, limit = NaN;
  let eq = 1, eqPeak = 1, mdd = 0, sum = 0, n = 0, wins = 0, early = 0;

  const exit = (px: number, isEarly: boolean) => {
    const g = (side * (px - entry)) / entry;
    sum += g * 100 - 2 * cost.feePct;
    eq = Math.max(0, eq * (1 + g) * (1 - fee) ** 2);
    if (g > 0) wins++;
    if (isEarly) early++;
    side = 0; stop = NaN; limit = NaN;
  };
  // ระดับ stop / limit สำหรับแท่งถัดไป จากข้อมูลถึงราคาปิดแท่ง i · stop หลายตัวใช้ตัวที่ใกล้ราคาที่สุด
  const arm = (i: number) => {
    const sd = side, r = rule;
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

  for (let i = s; i < e; i++) {
    // 1) คำสั่งที่วางไว้ตั้งแต่ปิดแท่งก่อน: ราคาเปิดกระโดดข้ามก่อน แล้วค่อยดูสูง/ต่ำของแท่ง (stop ก่อน limit)
    if (side !== 0) {
      held++;
      const sd = side, adverse = sd === 1 ? l[i] : h[i], favor = sd === 1 ? h[i] : l[i];
      if (!Number.isNaN(stop) && sd * (o[i] - stop) <= 0) exit(o[i] * (1 - sd * slip), true);
      else if (!Number.isNaN(limit) && sd * (o[i] - limit) >= 0) exit(o[i], true);
      else if (!Number.isNaN(stop) && sd * (adverse - stop) <= 0) exit(stop * (1 - sd * slip), true);
      else if (!Number.isNaN(limit) && sd * (favor - limit) >= 0) exit(limit, true);
    }
    // 2) กฎที่ตรวจที่ราคาปิด
    if (side !== 0) {
      const sd = side, r = rule;
      ext = sd === 1 ? Math.max(ext, h[i]) : Math.min(ext, l[i]);
      extC = sd === 1 ? Math.max(extC, c[i]) : Math.min(extC, c[i]);
      if ((r.ts?.exec === "close" && sd * (c[i] - extC) < -r.ts.m * L.atr[i])
        || (r.sl?.exec === "close" && sd * (c[i] - entry) < -r.sl.m * atrE)
        || (r.tp?.exec === "close" && sd * (c[i] - entry) >= r.tp.m * atrE)
        || (r.line === "close" && (sd === 1 ? L.hasPl[i] === 1 && c[i] < L.lower[i] : L.hasPh[i] === 1 && c[i] > L.upper[i]))
        || (r.time !== undefined && held >= r.time)) exit(c[i], true);
    }
    // 3) ป้ายของบอทที่ราคาปิด: ปิดไม้ฝั่งตรงข้าม แล้วเปิดฝั่งของป้าย (ถ้าเทรดฝั่งนั้น)
    const sig = L.stream[i];
    if (sig !== 0) {
      if (side === -sig) exit(c[i], false);
      const r = sig === 1 ? sides.long : sides.short;
      if (side === 0 && r) { side = sig; rule = r; entry = c[i]; atrE = L.atr[i]; ext = extC = c[i]; held = 0; n++; }
    }
    if (side !== 0) arm(i);

    const mtm = side === 0 ? eq : Math.max(0, eq * (1 + (side * (c[i] - entry)) / entry));
    if (mtm > eqPeak) eqPeak = mtm;
    if (1 - mtm / eqPeak > mdd) mdd = 1 - mtm / eqPeak;
    if (chain) {
      const ce = chain.eq * mtm;
      if (ce > chain.peak) chain.peak = ce;
      if (chain.peak > 0 && 1 - ce / chain.peak > chain.mdd) chain.mdd = 1 - ce / chain.peak;
    }
  }
  if (side !== 0) exit(c[e - 1], false);
  if (chain) chain.eq *= eq;
  return { comp: (eq - 1) * 100, sum, mdd: mdd * 100, trades: n, wins, early };
}
