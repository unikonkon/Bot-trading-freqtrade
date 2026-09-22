/**
 * หาหน้าต่างที่สั้นพอจะให้สัญญาณถี่ขึ้นและดึงสดได้ โดยความได้เปรียบยังอยู่
 *
 * ปัญหาที่ต้องแก้มีสองข้อและแยกกันคนละเรื่อง
 *   1) ชั้นทิศทางต้องสะสม 125 วัน = 6,000 แท่งที่ 30m ถึง 180,000 แท่งที่ 1m
 *      ขณะที่ Binance ให้ 1,000 แท่งต่อคำขอ → **ดึงสดแล้วไม่มีสัญญาณเลยทุก timeframe**
 *   2) ต่อให้ข้อมูลยาวพอ ก็เข้าไม้เพียง 1 ครั้งต่อ 5–9 วัน (0.21–0.39 สัญญาณต่อวัน)
 *
 * ไฟล์นี้แก้ข้อ 2 ที่ต้นเหตุ: หน้าต่างถูกนับเป็น**วัน** ความถี่จึงไม่ขึ้นกับ timeframe เลย
 * (วัดแล้ว: 1m ได้ 141 สัญญาณ · 30m ได้ 124 สัญญาณ ทั้งที่จำนวนแท่งต่างกัน 28 เท่า)
 * การเปลี่ยนไปใช้ 1m จึงไม่ทำให้สัญญาณถี่ขึ้น ต้องย่อหน้าต่างเป็นวันเท่านั้น
 *
 * ═══ เกณฑ์ตัดสิน ประกาศไว้ก่อนเห็นผล ═══════════════════════════════════
 *   1) เลือกจาก **train ของ BTCUSDT เท่านั้น** ด้วยค่ามัธยฐานข้าม timeframe และ band
 *      และต้องมีที่ราบ — เพื่อนบ้านทั้งสองแกนต้องเป็นบวกด้วย
 *   2) ต้องให้สัญญาณอย่างน้อย **1 สัญญาณต่อวัน** มิฉะนั้นไม่ตอบโจทย์ที่ตั้งไว้
 *   3) รวมหน้าต่างแล้วต้อง ≤ 1,000 แท่งในอย่างน้อยหนึ่ง timeframe ที่ใช้งานจริง
 *   4) บน test ของ BTCUSDT ต้องเป็นบวก และบนพอร์ต ETH/SOL/BNB/XRP ที่ไม่เคยถูกใช้
 *      เลือกค่า ต้องเป็นบวกทั้งสองช่วง ทุก band (6/6) — ด่านเดียวกับทุกรหัสที่ลงทะเบียน
 * ไม่ครบทุกข้อ = รายงานตัวเลขแล้วไม่ลงทะเบียน
 *
 *   npx tsx "signal-bot/web ui/research-v3/fast-window-select.ts"
 */
import fs from "node:fs";
import path from "node:path";
import { load, split, run, f2, SPLIT_AT } from "./lib";
import type { KlineData } from "../../../lib/types/kline";
import { orderFlowV3 } from "../../../lib/indicators-v3";

const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const TFS = ["5m", "15m", "30m"];
const PER_DAY: Record<string, number> = { "1m": 1440, "3m": 480, "5m": 288, "15m": 96, "30m": 48 };
const LOOKS = [0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 8];
const DEBIAS = [2, 5, 6, 8, 10, 15, 20, 30, 40, 60, 120];
const BANDS = [0.005, 0.01, 0.02];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const COIN_DIR = "data-test/crosscoin";
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
function coinWindows(tf: string) {
  return fs.readdirSync(COIN_DIR).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort().map((file) => {
    const k = fs.readFileSync(path.join(COIN_DIR, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
    return { before: { k: k.slice(0, k.findIndex((b) => b.openTime >= SPLIT_AT)), start: k.findIndex((b) => b.openTime >= EVAL_FROM) },
             after: { k, start: k.findIndex((b) => b.openTime >= SPLIT_AT) } };
  });
}

const trains = Object.fromEntries(TFS.map((tf) => [tf, split(load(tf)).train]));

console.log("# หาหน้าต่างที่สั้นพอจะดึงสดได้ — เลือกจาก train ของ BTCUSDT เท่านั้น\n");
console.log("## 1. ผลตอบแทนมัธยฐานบน train (ข้าม 3 timeframe x 3 band = 9 ชุดต่อช่อง)\n");
console.log("| lookback \\ debias | " + DEBIAS.map((d) => `${d} วัน`).join(" | ") + " |");
console.log("|---|" + DEBIAS.map(() => "---:").join("|") + "|");
const grid: Record<string, { ret: number; sigPerDay: number }> = {};
for (const flowLookbackDays of LOOKS) {
  const cells = DEBIAS.map((flowDebiasDays) => {
    if (flowLookbackDays >= flowDebiasDays) return "—";
    const rs: number[] = [], sd: number[] = [];
    for (const tf of TFS) for (const flowBand of BANDS) {
      const w = trains[tf];
      const r = orderFlowV3(w.k, { flowLookbackDays, flowDebiasDays, flowBand }, w.start);
      rs.push(run(w.k, r.exposure, w.start, FEE, SLIP, FUNDING).returnPct);
      sd.push(r.signal.filter(Boolean).length / ((w.k.length - w.start) / PER_DAY[tf]));
    }
    const m = median(rs), s = median(sd);
    grid[`${flowLookbackDays}|${flowDebiasDays}`] = { ret: m, sigPerDay: s };
    return `${f2(m, 1)}<br><sub>${f2(s, 2)} สัญญาณ/วัน</sub>`;
  });
  console.log(`| **${flowLookbackDays} วัน** | ${cells.join(" | ")} |`);
}

console.log("\n## 2. ช่องที่ผ่านทั้งสามข้อแรก (บวก · ≥1 สัญญาณ/วัน · ดึงสดได้)\n");
console.log("| lookback | debias | ผลตอบแทน train | สัญญาณ/วัน | แท่งที่ต้องมี 5m / 15m / 30m | ดึงสดได้ที่ |");
console.log("|---:|---:|---:|---:|---|---|");
const pass: { l: number; d: number; ret: number; sig: number }[] = [];
for (const l of LOOKS) for (const d of DEBIAS) {
  const g = grid[`${l}|${d}`];
  if (!g || g.ret <= 0 || g.sigPerDay < 1) continue;
  const bars = (tf: string) => Math.round((l + d) * PER_DAY[tf]);
  const fits = TFS.filter((tf) => bars(tf) <= 1000);
  if (!fits.length) continue;
  pass.push({ l, d, ret: g.ret, sig: g.sigPerDay });
  console.log(`| ${l} | ${d} | ${f2(g.ret)}% | ${f2(g.sigPerDay, 2)} | ${TFS.map((tf) => bars(tf).toLocaleString()).join(" / ")} | ${fits.join(", ")} |`);
}
if (!pass.length) console.log("| — | — | — | — | — | **ไม่มีช่องไหนผ่าน** |");

// ══ 3) กฎการเลือก: ที่ราบสี่ทิศต้องเป็นบวก แล้วเอาช่องที่ให้สัญญาณถี่ที่สุด ═══
console.log("\n## 3. ช่องที่มีที่ราบรองรับครบสี่ทิศ เรียงตามความถี่ของสัญญาณ\n");
console.log("| lookback | debias | train | สัญญาณ/วัน | เพื่อนบ้านทั้งสี่ | แท่งที่ต้องมี 30m |");
console.log("|---:|---:|---:|---:|---|---:|");
const plateau: { l: number; d: number; ret: number; sig: number }[] = [];
for (const l of LOOKS) for (const d of DEBIAS) {
  const g = grid[`${l}|${d}`];
  if (!g || g.ret <= 0) continue;
  const li = LOOKS.indexOf(l), di = DEBIAS.indexOf(d);
  const nb = ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).map(([dl, dd]) => {
    const nl = LOOKS[li + dl], nd = DEBIAS[di + dd];
    return nl !== undefined && nd !== undefined ? grid[`${nl}|${nd}`] : undefined;
  });
  if (!nb.every((x) => x === undefined || x.ret > 0)) continue;
  plateau.push({ l, d, ret: g.ret, sig: g.sigPerDay });
}
plateau.sort((a, b) => b.sig - a.sig);
for (const c of plateau.slice(0, 8)) {
  const li = LOOKS.indexOf(c.l), di = DEBIAS.indexOf(c.d);
  const nb = ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).map(([dl, dd]) => {
    const nl = LOOKS[li + dl], nd = DEBIAS[di + dd];
    const g = nl !== undefined && nd !== undefined ? grid[`${nl}|${nd}`] : undefined;
    return g ? `${nl}/${nd}:${f2(g.ret, 0)}` : "ขอบ";
  });
  console.log(`| ${c.l} | ${c.d} | ${f2(c.ret)}% | **${f2(c.sig, 2)}** | ${nb.join(" ")} | ${Math.round((c.l + c.d) * PER_DAY["30m"])} |`);
}
const pick = plateau[0];
console.log(`\n**ค่าที่เลือกตามกฎ** (ที่ราบครบสี่ทิศ แล้วเอาที่ถี่ที่สุด): lookback ${pick.l} วัน · debias ${pick.d} วัน`);
console.log(`เทียบกับค่าปัจจุบัน 5/120 ซึ่งได้ ${f2(grid["5|120"].sigPerDay, 2)} สัญญาณ/วัน — **ถี่ขึ้น ${f2(pick.sig / grid["5|120"].sigPerDay, 1)} เท่า**`);

// ══ 4) ด่านที่เหลือ: test ของ BTCUSDT แล้วจึงเหรียญที่ไม่เคยถูกใช้เลือกค่า ═══
const FAST = { flowLookbackDays: pick.l, flowDebiasDays: pick.d };
console.log("\n## 4. BTCUSDT ครบทั้ง 5 timeframe (band 0.01 · หักต้นทุนแล้ว)\n");
console.log("| tf | train | test | สัญญาณ/วัน test | ไม้ test | เทียบ 5/120 train | test |");
console.log("|---|---:|---:|---:|---:|---:|---:|");
for (const tf of ["1m", "3m", "5m", "15m", "30m"]) {
  const { train, test } = split(load(tf));
  const go = (w: { k: KlineData[]; start: number }, o: Record<string, number>) => {
    const r = orderFlowV3(w.k, o, w.start);
    return { s: run(w.k, r.exposure, w.start, FEE, SLIP, FUNDING), r };
  };
  const a = go(train, FAST), b = go(test, FAST);
  const a0 = go(train, {}), b0 = go(test, {});
  const days = (test.k.length - test.start) / PER_DAY[tf];
  console.log(`| ${tf} | ${f2(a.s.returnPct)}% | ${f2(b.s.returnPct)}% | ${f2(b.r.signal.filter(Boolean).length / days, 2)} | ${b.s.totalTrades} | ${f2(a0.s.returnPct)}% | ${f2(b0.s.returnPct)}% |`);
}

console.log("\n## 5. พอร์ต ETH/SOL/BNB/XRP ที่ไม่เคยถูกใช้เลือกค่าเลย (ก่อน/หลัง 17 พ.ค.)\n");
console.log("| band | 15m ค่าใหม่ | 15m 5/120 | 30m ค่าใหม่ | 30m 5/120 |");
console.log("|---|---:|---:|---:|---:|");
let ok = 0;
for (const flowBand of BANDS) {
  const cell = (tf: string, o: Record<string, number>) => {
    const cs = coinWindows(tf).map((c) => ({
      before: run(c.before.k, orderFlowV3(c.before.k, { ...o, flowBand }, c.before.start).exposure, c.before.start, FEE, SLIP, FUNDING),
      after: run(c.after.k, orderFlowV3(c.after.k, { ...o, flowBand }, c.after.start).exposure, c.after.start, FEE, SLIP, FUNDING),
    }));
    const blend = (key: "before" | "after") => {
      const len = Math.min(...cs.map((x) => x[key].equity.length));
      let last = 0;
      for (let i = 0; i < len; i++) last = cs.reduce((s, x) => s + x[key].equity[i], 0) / cs.length;
      return last;
    };
    const before = blend("before"), after = blend("after");
    return { txt: `${before > 0 && after > 0 ? "✅ " : ""}${f2(before, 1)}/${f2(after, 1)}`, pass: before > 0 && after > 0 };
  };
  const a = cell("15m", FAST), b = cell("30m", FAST);
  if (a.pass) ok++;
  if (b.pass) ok++;
  console.log(`| ${flowBand} | ${a.txt} | ${cell("15m", {}).txt} | ${b.txt} | ${cell("30m", {}).txt} |`);
}
console.log(`\n**ด่านข้ามเหรียญ: ${ok}/6 ช่อง** → ${ok === 6 ? "ผ่าน ลงทะเบียนได้" : "ไม่ผ่าน ไม่ลงทะเบียน"}`);
