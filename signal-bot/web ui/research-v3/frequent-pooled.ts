/**
 * ความพยายามครั้งสุดท้ายที่จะได้ OrderFlow ที่ถี่ ≥ 1 สัญญาณ/วัน/เหรียญ และยังเป็นบวก
 * — เลือกจาก **5 เหรียญพร้อมกัน** แทน BTCUSDT เหรียญเดียว
 *
 * ที่มา: `frequent-select.ts` เลือกจาก train ของ BTCUSDT แล้วได้ 5/10/0.002/0.25 ที่ผ่าน test
 * ของ BTCUSDT ทุก timeframe แต่พอร์ตเหรียญอื่นติดลบ −28% ในช่วงก่อน 17 พ.ค. ทุกช่อง
 * `fast-window-select.ts` ก็ตกแบบเดียวกัน (4/10 ได้ 1/6) — หน้าต่างสั้นที่เลือกจากเหรียญเดียว
 * จับลักษณะเฉพาะของเหรียญนั้น ไฟล์นี้จึงเปลี่ยน **ข้อมูลที่ใช้เลือก** ไม่ใช่เปลี่ยนกริด
 *
 * ═══ การแบ่งข้อมูล ═════════════════════════════════════════════════════
 *   เลือก: BTC/ETH/SOL/BNB/XRP ช่วง 17 ก.ย. 2025 – 17 พ.ค. 2026 (15m + 30m)
 *   ตัดสิน: ทั้ง 5 เหรียญ ช่วง 17 พ.ค. – 17 ก.ย. 2026 ซึ่งการเลือกในไฟล์นี้ไม่แตะเลย
 *   ทุกเหรียญมีแท่งอุ่นเครื่องตั้งแต่ 1 พ.ค. 2025 (139 วัน) จึงพอสำหรับ debias ทุกค่าในกริด
 *
 * ═══ เกณฑ์ตัดสิน ประกาศไว้ก่อนเห็นผล ═══════════════════════════════════
 * การเลือก — คะแนน = ผลตอบแทนพอร์ตแบ่งทุนเท่ากัน 5 เหรียญ เฉลี่ย 15m กับ 30m
 *   ก) ความถี่มัธยฐานรายเหรียญ ≥ 1 สัญญาณต่อวัน
 *   ข) ที่ราบ: เพื่อนบ้าน ±1 ขั้นทั้งสี่แกนต้องมีคะแนนเป็นบวกทุกช่อง
 *   ค) เอาช่องที่คะแนนสูงสุด
 * ด่าน (ช่วงหลัง 17 พ.ค. เท่านั้น)
 *   1) พอร์ต 5 เหรียญเป็นบวก ทั้ง 15m/30m × band ที่เลือกและเพื่อนบ้านสองข้าง (6/6)
 *   2) พอร์ตชนะเส้นฐาน "ซื้อตลอด" และ "ขายตลอด" ทั้ง 15m และ 30m
 *   3) ความถี่มัธยฐานรายเหรียญยัง ≥ 0.75 สัญญาณต่อวัน (ความถี่ต้องรอดนอกช่วงเลือกด้วย)
 * ไม่ครบทุกข้อ = รายงานตัวเลขแล้วไม่ลงทะเบียน
 *
 *   SYMBOLS=BTCUSDT npx tsx scripts/download-crosscoin.ts <dir-btc>
 *   npx tsx "signal-bot/web ui/research-v3/frequent-pooled.ts" <dir-btc> [data-test/crosscoin]
 */
import fs from "node:fs";
import path from "node:path";
import { run, f2, SPLIT_AT } from "./lib";
import type { KlineData } from "../../../lib/types/kline";
import { orderFlowV3 } from "../../../lib/indicators-v3";

const DIRS = [process.argv[2], process.argv[3] ?? "data-test/crosscoin"];
if (!DIRS[0] || !fs.existsSync(DIRS[0])) {
  console.log("ต้องระบุโฟลเดอร์ BTCUSDT ที่เริ่ม 1 พ.ค. 2025 (ดูวิธีดึงในหัวไฟล์)");
  process.exit(1);
}
const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const TFS = ["15m", "30m"];
const PER_DAY: Record<string, number> = { "15m": 96, "30m": 48 };
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
const LOOKS = [1, 2, 3, 4, 5, 6, 8];
const DEBIAS = [10, 20, 40, 60, 120];
const BANDS = [0.002, 0.003, 0.005, 0.0075, 0.01];
const EXITS = [1, 0.5, 0.25, 0];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
type P = { l: number; d: number; b: number; e: number };
const key = (p: P) => `${p.l}|${p.d}|${p.b}|${p.e}`;
const params = (p: P) => ({ flowLookbackDays: p.l, flowDebiasDays: p.d, flowBand: p.b, flowExitMult: p.e });

type Win = { k: KlineData[]; start: number };
type Coin = { name: string; before: Win; after: Win };
const coins: Record<string, Coin[]> = {};
for (const tf of TFS) {
  coins[tf] = DIRS.flatMap((dir) => fs.readdirSync(dir).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort().map((file) => {
    const k = fs.readFileSync(path.join(dir, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
    const cut = k.findIndex((b) => b.openTime >= SPLIT_AT);
    return {
      name: file.split("-")[0].replace("USDT", ""),
      before: { k: k.slice(0, cut), start: k.findIndex((b) => b.openTime >= EVAL_FROM) },
      after: { k, start: cut },
    };
  }));
}
console.log(`# เลือก OrderFlow ที่ถี่ ≥ 1 สัญญาณ/วัน จาก 5 เหรียญพร้อมกัน\n`);
console.log(`เหรียญ: ${coins["15m"].map((c) => c.name).join(" / ")} · เลือกจากช่วงก่อน 17 พ.ค. · ตัดสินที่ช่วงหลัง 17 พ.ค.\n`);

/** พอร์ตแบ่งทุนเท่ากัน: เฉลี่ยเส้นทุนของทุกเหรียญ แล้วอ่านค่าสุดท้าย */
function portfolio(tf: string, o: Record<string, number>, which: "before" | "after", fixed?: number) {
  const per = coins[tf].map((c) => {
    const w = c[which];
    const r = fixed === undefined ? orderFlowV3(w.k, o, w.start) : null;
    const exposure = r ? r.exposure : w.k.map(() => fixed!);
    const s = run(w.k, exposure, w.start, FEE, SLIP, FUNDING);
    const sig = r ? r.signal.slice(w.start).filter(Boolean).length / ((w.k.length - w.start) / PER_DAY[tf]) : 0;
    return { name: c.name, s, sig };
  });
  const len = Math.min(...per.map((x) => x.s.equity.length));
  const ret = per.reduce((a, x) => a + x.s.equity[len - 1], 0) / per.length;
  return { ret, per, sig: median(per.map((x) => x.sig)) };
}

// ══ 1) กวาดบนช่วงก่อน 17 พ.ค. ═════════════════════════════════════
const grid = new Map<string, { score: number; sig: number; byTf: number[] }>();
for (const l of LOOKS) for (const d of DEBIAS) {
  if (l >= d) continue;
  for (const b of BANDS) for (const e of EXITS) {
    const res = TFS.map((tf) => portfolio(tf, params({ l, d, b, e }), "before"));
    grid.set(key({ l, d, b, e }), {
      score: res.reduce((a, r) => a + r.ret, 0) / res.length,
      sig: median(res.map((r) => r.sig)),
      byTf: res.map((r) => r.ret),
    });
  }
}
const neighbours = (p: P): P[] => {
  const out: P[] = [];
  const axes: [keyof P, number[]][] = [["l", LOOKS], ["d", DEBIAS], ["b", BANDS], ["e", EXITS]];
  for (const [ax, xs] of axes) {
    const i = xs.indexOf(p[ax]);
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < xs.length) out.push({ ...p, [ax]: xs[j] });
  }
  return out;
};
const rows = [...grid].map(([k, g]) => {
  const [l, d, b, e] = k.split("|").map(Number);
  const nb = neighbours({ l, d, b, e }).map((q) => grid.get(key(q))).filter(Boolean) as { score: number }[];
  return { l, d, b, e, ...g, plateau: nb.every((x) => x.score > 0) };
});

console.log(`## 1. เส้นขอบเขตความถี่–กำไร บนช่วงเลือก (${grid.size} ชุดค่า · พอร์ต 5 เหรียญ)\n`);
console.log("| สัญญาณ/วัน/เหรียญ | ชุดค่าดีสุด look/debias/band/exit | พอร์ต 15m | พอร์ต 30m | ที่ราบ |");
console.log("|---:|---|---:|---:|---|");
const BUCKETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5];
for (let i = 0; i < BUCKETS.length; i++) {
  const lo = i ? BUCKETS[i - 1] : 0, hi = BUCKETS[i];
  const inB = rows.filter((r) => r.sig > lo && r.sig <= hi);
  if (!inB.length) continue;
  const best = inB.reduce((a, b) => (b.score > a.score ? b : a));
  console.log(`| ${lo}–${hi} | ${best.l} / ${best.d} / ${best.b} / ${best.e} | ${f2(best.byTf[0])}% | ${f2(best.byTf[1])}% | ${best.plateau ? "✅" : "❌"} |`);
}
const def = grid.get(key({ l: 5, d: 120, b: 0.01, e: 0.5 }))!, zero = grid.get(key({ l: 5, d: 120, b: 0.01, e: 0 }))!;
console.log(`\nเทียบรหัสที่ลงทะเบียนแล้ว: orderflow_v3 (5/120/0.01/0.5) ${f2(def.byTf[0])}% / ${f2(def.byTf[1])}% ที่ ${f2(def.sig, 2)} สัญญาณ/วัน · ` +
  `orderflow_v3_zero ${f2(zero.byTf[0])}% / ${f2(zero.byTf[1])}% ที่ ${f2(zero.sig, 2)} สัญญาณ/วัน`);

const eligible = rows.filter((r) => r.sig >= 1 && r.score > 0 && r.plateau).sort((a, b) => b.score - a.score);
console.log("\n## 2. ช่องที่ผ่านข้อ ก) และ ข) เรียงตามคะแนน\n");
console.log("| อันดับ | look | debias | band | exit | สัญญาณ/วัน | พอร์ต 15m | พอร์ต 30m |");
console.log("|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const [i, r] of eligible.slice(0, 10).entries())
  console.log(`| ${i + 1} | ${r.l} | ${r.d} | ${r.b} | ${r.e} | ${f2(r.sig, 2)} | ${f2(r.byTf[0])}% | ${f2(r.byTf[1])}% |`);
if (!eligible.length) {
  console.log("| — | — | — | — | — | — | — | — |");
  console.log("\n**ไม่มีชุดค่าใดที่ถี่ ≥ 1 สัญญาณ/วัน และเป็นบวกพร้อมที่ราบบนพอร์ต 5 เหรียญ → ไม่ลงทะเบียน**");
  process.exit(0);
}
const pick = eligible[0];
console.log(`\n**ค่าที่เลือกตามกฎ ค)**: ${pick.l} / ${pick.d} / ${pick.b} / ${pick.e}`);

// ══ 2) ตัดสินบนช่วงหลัง 17 พ.ค. ══════════════════════════════════
console.log("\n## 3. ช่วงหลัง 17 พ.ค. (ไม่ถูกใช้เลือก) — รายงานครั้งเดียว\n");
console.log("| tf | band | รายเหรียญ | **พอร์ต** | สัญญาณ/วัน/เหรียญ | orderflow_v3 | ซื้อตลอด | ขายตลอด |");
console.log("|---|---|---|---:|---:|---:|---:|---:|");
const bi = BANDS.indexOf(pick.b);
// band ที่เลือกกับเพื่อนบ้านสองค่าที่ใกล้ที่สุด — ถ้าอยู่ขอบกริดให้เอาสองค่าถัดไปข้างเดียว
// เพื่อให้ด่านมีครบ 6 ช่องเสมอ ไม่ตกอัตโนมัติเพราะตำแหน่งในกริด
const lo = Math.max(0, Math.min(bi - 1, BANDS.length - 3));
const bandSet = BANDS.slice(lo, lo + 3);
let ok = 0, cells = 0, gate2 = true, gate3 = true;
for (const tf of TFS) {
  const long = portfolio(tf, {}, "after", 1).ret, short = portfolio(tf, {}, "after", -1).ret;
  const base = portfolio(tf, {}, "after").ret;
  for (const flowBand of bandSet) {
    const r = portfolio(tf, { ...params(pick), flowBand }, "after");
    cells++; if (r.ret > 0) ok++;
    if (flowBand === pick.b) {
      if (r.ret <= long || r.ret <= short) gate2 = false;
      if (r.sig < 0.75) gate3 = false;
    }
    const per = r.per.map((x) => `${x.name} ${f2(x.s.returnPct, 0)}`).join(" · ");
    console.log(`| ${tf} | ${flowBand}${flowBand === pick.b ? " ◀" : ""} | ${per} | **${f2(r.ret)}%** | ${f2(r.sig, 2)} | ${f2(base)}% | ${f2(long)}% | ${f2(short)}% |`);
  }
}
const gate1 = ok === cells && cells === 6;
console.log("\n### คำตัดสินตามเกณฑ์ที่ประกาศไว้ก่อนเห็นผล\n");
console.log(`- ด่าน 1 พอร์ตบวก ${ok}/${cells} (ต้อง 6/6): ${gate1 ? "ผ่าน" : "ไม่ผ่าน"}`);
console.log(`- ด่าน 2 ชนะเส้นฐานถือฝั่งเดียวทั้ง 15m และ 30m: ${gate2 ? "ผ่าน" : "ไม่ผ่าน"}`);
console.log(`- ด่าน 3 ความถี่ยัง ≥ 0.75 สัญญาณ/วัน/เหรียญ: ${gate3 ? "ผ่าน" : "ไม่ผ่าน"}`);
console.log(`\n**${gate1 && gate2 && gate3 ? "ผ่านครบ → ลงทะเบียนได้" : "ไม่ผ่าน → ไม่ลงทะเบียน"}**`);
