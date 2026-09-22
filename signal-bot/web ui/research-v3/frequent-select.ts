/**
 * หาชุดค่า OrderFlow ที่ให้สัญญาณ ≥ 1 ครั้งต่อวันต่อเหรียญ และยังทำกำไรหลังต้นทุน
 *
 * ที่มา: `frequency-frontier.ts` พบว่าย่าน **debias ~10 วัน** (ไม่ใช่ 120) ให้ผลบน train
 * สูงกว่าค่าตั้งต้นทั้งที่ถี่กว่า 3–6 เท่า (5/10/0.005/0 ได้ +60.19% ที่ 0.5–1 สัญญาณ/วัน
 * เทียบกับ 5/120 ที่ +20.1% ที่ 0.22 สัญญาณ/วัน) และต้องสะสมเพียง 15 วัน = 720 แท่งที่ 30m
 * ซึ่ง **ดึงสดได้ในคำขอเดียว** ขณะที่ `fast-window-select.ts` เคยเลือก 4/10 แล้วตกด่านข้ามเหรียญ
 * (1/6) เพราะกวาดแค่สองแกน (lookback × debias) โดยตรึง exit ไว้ที่ 0.5 — ไฟล์นี้กวาดครบสี่แกน
 *
 * ═══ เกณฑ์ตัดสิน ประกาศไว้ก่อนเห็นผล ═══════════════════════════════════
 * การเลือก (train ของ BTCUSDT เท่านั้น · คะแนน = มัธยฐานข้าม 5m / 15m / 30m)
 *   ก) ความถี่มัธยฐาน ≥ 1 สัญญาณต่อวันต่อเหรียญ — โจทย์คือ "ต้องมีสัญญาณทุกวัน"
 *   ข) ที่ราบ: เพื่อนบ้าน ±1 ขั้นของทั้งสี่แกน (8 ช่อง) ต้องเป็นบวกบน train ทุกช่อง
 *   ค) ในบรรดาช่องที่ผ่าน ก) และ ข) เอาช่องที่ **กำไร train สูงสุด** — ความถี่เป็นข้อจำกัด
 *      ส่วนกำไรเป็นเป้าหมาย ตามคำสั่ง "ต้องทำกำไรมากที่สุด"
 * ด่านที่ต้องผ่านทั้งหมดก่อนลงทะเบียน (ใช้ข้อมูลที่ไม่ได้ใช้เลือกค่าเท่านั้น)
 *   1) test ของ BTCUSDT เป็นบวกทุก timeframe ที่ใช้เลือก (5m / 15m / 30m)
 *   2) พอร์ต ETH/SOL/BNB/XRP เป็นบวกทั้งสองช่วง × 15m/30m × band ที่เลือกและเพื่อนบ้านสองข้าง
 *      (6/6) — ด่านเดียวกับทุกรหัสที่ลงทะเบียนอยู่แล้ว
 *   3) test ของ BTCUSDT ต้องชนะเส้นฐาน "ซื้อตลอด" และ "ขายตลอด" ทุก timeframe
 *      เพื่อตัดกรณีที่กำไรมาจากการเอียงตามตลาด ไม่ใช่การทำนาย
 * ไม่ครบทุกข้อ = รายงานตัวเลขแล้วไม่ลงทะเบียน
 *
 *   npx tsx "signal-bot/web ui/research-v3/frequent-select.ts"
 */
import fs from "node:fs";
import path from "node:path";
import { load, split, run, f2, tstat, SPLIT_AT } from "./lib";
import type { KlineData } from "../../../lib/types/kline";
import { orderFlowV3 } from "../../../lib/indicators-v3";

const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const TFS = ["5m", "15m", "30m"];
const PER_DAY: Record<string, number> = { "1m": 1440, "3m": 480, "5m": 288, "15m": 96, "30m": 48 };
const LOOKS = [3, 4, 5, 6, 8];
const DEBIAS = [8, 10, 12, 15, 20, 30];
const BANDS = [0.002, 0.003, 0.005, 0.0075, 0.01];
const EXITS = [1, 0.5, 0.25, 0];
const MIN_SIG_PER_DAY = 1;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
type P = { l: number; d: number; b: number; e: number };
const key = (p: P) => `${p.l}|${p.d}|${p.b}|${p.e}`;
const params = (p: P) => ({ flowLookbackDays: p.l, flowDebiasDays: p.d, flowBand: p.b, flowExitMult: p.e });

// ══ 1) กวาดบน train ของ BTCUSDT ═════════════════════════════════
const btc = Object.fromEntries(["1m", "3m", ...TFS].map((tf) => [tf, split(load(tf))])) as Record<string, ReturnType<typeof split>>;
const grid = new Map<string, { ret: number; sig: number; worst: number }>();
for (const l of LOOKS) for (const d of DEBIAS) {
  if (l >= d) continue;
  for (const b of BANDS) for (const e of EXITS) {
    const rs: number[] = [], sg: number[] = [];
    for (const tf of TFS) {
      const w = btc[tf].train;
      const r = orderFlowV3(w.k, params({ l, d, b, e }), w.start);
      rs.push(run(w.k, r.exposure, w.start, FEE, SLIP, FUNDING).returnPct);
      sg.push(r.signal.filter(Boolean).length / ((w.k.length - w.start) / PER_DAY[tf]));
    }
    grid.set(key({ l, d, b, e }), { ret: median(rs), sig: median(sg), worst: Math.min(...rs) });
  }
}
console.log("# เลือกชุดค่าที่ถี่ ≥ 1 สัญญาณ/วัน จาก train ของ BTCUSDT เท่านั้น\n");
console.log(`กวาด ${grid.size} ชุดค่า × ${TFS.join("/")} · หักต้นทุน futures taker (fee ${FEE}% + slip ${SLIP}% ต่อขา + funding)\n`);

const neighbours = (p: P): P[] => {
  const out: P[] = [];
  const axes: [keyof P, number[]][] = [["l", LOOKS], ["d", DEBIAS], ["b", BANDS], ["e", EXITS]];
  for (const [ax, xs] of axes) {
    const i = xs.indexOf(p[ax]);
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < xs.length) out.push({ ...p, [ax]: xs[j] });
  }
  return out;
};
const all: (P & { ret: number; sig: number; worst: number; plateau: boolean })[] = [];
for (const [k, g] of grid) {
  const [l, d, b, e] = k.split("|").map(Number);
  const p = { l, d, b, e };
  const nb = neighbours(p).map((q) => grid.get(key(q))).filter(Boolean) as { ret: number }[];
  all.push({ ...p, ...g, plateau: nb.every((x) => x.ret > 0) });
}
const eligible = all.filter((r) => r.sig >= MIN_SIG_PER_DAY && r.ret > 0 && r.plateau).sort((a, b) => b.ret - a.ret);

console.log(`## 1. ช่องที่ผ่านข้อ ก) ≥${MIN_SIG_PER_DAY} สัญญาณ/วัน และ ข) ที่ราบครบ 8 ทิศ — เรียงตามกำไร train\n`);
console.log("| อันดับ | look | debias | band | exit | สัญญาณ/วัน | train มัธยฐาน | train แย่สุด | แท่งอุ่นเครื่อง 5m / 30m |");
console.log("|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const [i, r] of eligible.slice(0, 12).entries())
  console.log(`| ${i + 1} | ${r.l} | ${r.d} | ${r.b} | ${r.e} | ${f2(r.sig, 2)} | **${f2(r.ret)}%** | ${f2(r.worst)}% | ${Math.round((r.l + r.d) * 288).toLocaleString()} / ${Math.round((r.l + r.d) * 48)} |`);
if (!eligible.length) { console.log("\n**ไม่มีช่องไหนผ่านข้อ ก) และ ข) — จบ ไม่ลงทะเบียน**"); process.exit(0); }
const pick = eligible[0];
console.log(`\n**ค่าที่เลือกตามกฎ ค)**: lookback ${pick.l} · debias ${pick.d} · band ${pick.b} · exit ${pick.e}`);
const defaultTrain = median(TFS.map((tf) => {
  const w = btc[tf].train;
  return run(w.k, orderFlowV3(w.k, {}, w.start).exposure, w.start, FEE, SLIP, FUNDING).returnPct;
}));
console.log(`(ค่าตั้งต้นปัจจุบัน 5/120/0.01/0.5 บน train มัธยฐาน ${f2(defaultTrain)}%)`);

// ══ 2) ด่าน 1 + 3: test ของ BTCUSDT และเส้นฐานถือฝั่งเดียว ═══════
console.log("\n## 2. BTCUSDT — train / test ทุก timeframe เทียบค่าตั้งต้นและเส้นฐาน (รายงาน test ครั้งเดียว)\n");
console.log("| tf | ช่วง | ที่เลือก | ไม้ | สัญญาณ/วัน | dd | t ต่อไม้ | orderflow_v3 | ซื้อตลอด | ขายตลอด |");
console.log("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
let gate1 = true, gate3 = true;
for (const tf of ["1m", "3m", ...TFS]) {
  for (const label of ["train", "test"] as const) {
    const w = btc[tf][label];
    const r = orderFlowV3(w.k, params(pick), w.start);
    const s = run(w.k, r.exposure, w.start, FEE, SLIP, FUNDING);
    const base = run(w.k, orderFlowV3(w.k, {}, w.start).exposure, w.start, FEE, SLIP, FUNDING);
    const flat = (x: number) => run(w.k, w.k.map(() => x), w.start, FEE, SLIP, FUNDING).returnPct;
    const long = flat(1), short = flat(-1);
    const days = (w.k.length - w.start) / PER_DAY[tf];
    const t = tstat(s.trades.map((x) => x.pnlPct)).t;
    if (label === "test" && TFS.includes(tf)) {
      if (s.returnPct <= 0) gate1 = false;
      if (s.returnPct <= long || s.returnPct <= short) gate3 = false;
    }
    console.log(`| ${tf} | ${label} | **${f2(s.returnPct)}%** | ${s.totalTrades} | ${f2(r.signal.filter(Boolean).length / days, 2)} | ${f2(s.maxDrawdownPct)}% | ${f2(t)} | ${f2(base.returnPct)}% | ${f2(long)}% | ${f2(short)}% |`);
  }
}

// ══ 3) ด่าน 2: พอร์ตเหรียญที่ไม่เคยถูกใช้เลือกค่า ═══════════════════
const COIN_DIR = "data-test/crosscoin";
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
const coins = (tf: string) => fs.readdirSync(COIN_DIR).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort().map((file) => ({
  name: file.split("-")[0].replace("USDT", ""),
  k: fs.readFileSync(path.join(COIN_DIR, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData),
}));
const bi = BANDS.indexOf(pick.b);
// band ที่เลือกกับเพื่อนบ้านสองค่าที่ใกล้ที่สุด — ถ้าอยู่ขอบกริดให้เอาสองค่าถัดไปข้างเดียว
// เพื่อให้ด่านมีครบ 6 ช่องเสมอ ไม่ตกอัตโนมัติเพราะตำแหน่งในกริด
const lo = Math.max(0, Math.min(bi - 1, BANDS.length - 3));
const bandSet = BANDS.slice(lo, lo + 3);
console.log("\n## 3. พอร์ต ETH/SOL/BNB/XRP แบ่งทุนเท่ากัน (ไม่เคยถูกใช้เลือกค่า) · ก่อน / หลัง 17 พ.ค.\n");
console.log("| tf | band | รายเหรียญ ก่อน/หลัง | **พอร์ต ก่อน** | **พอร์ต หลัง** | orderflow_v3 ก่อน/หลัง | สัญญาณ/วัน รวม 4 เหรียญ |");
console.log("|---|---|---|---:|---:|---:|---:|");
let ok = 0, cells = 0;
for (const tf of ["15m", "30m"]) {
  const cs = coins(tf);
  for (const flowBand of bandSet) {
    const evalOne = (o: Record<string, number>) => cs.map((c) => {
      const cut = c.k.findIndex((b) => b.openTime >= SPLIT_AT);
      const start = c.k.findIndex((b) => b.openTime >= EVAL_FROM);
      const before = c.k.slice(0, cut);
      const rb = orderFlowV3(before, o, start), ra = orderFlowV3(c.k, o, cut);
      return {
        name: c.name,
        before: run(before, rb.exposure, start, FEE, SLIP, FUNDING),
        after: run(c.k, ra.exposure, cut, FEE, SLIP, FUNDING),
        sigPerDay: ra.signal.slice(cut).filter(Boolean).length / ((c.k.length - cut) / PER_DAY[tf]),
      };
    });
    const blend = (xs: ReturnType<typeof evalOne>, key: "before" | "after") => {
      const len = Math.min(...xs.map((x) => x[key].equity.length));
      return xs.reduce((s, x) => s + x[key].equity[len - 1], 0) / xs.length;
    };
    const mine = evalOne({ ...params(pick), flowBand });
    const base = evalOne({ flowBand: 0.01 });
    const b = blend(mine, "before"), a = blend(mine, "after");
    cells++; if (b > 0 && a > 0) ok++;
    const per = mine.map((x) => `${x.name} ${f2(x.before.returnPct, 0)}/${f2(x.after.returnPct, 0)}`).join(" · ");
    console.log(`| ${tf} | ${flowBand}${flowBand === pick.b ? " ◀" : ""} | ${per} | ${b > 0 && a > 0 ? "✅ " : ""}${f2(b)}% | ${f2(a)}% | ${f2(blend(base, "before"))}% / ${f2(blend(base, "after"))}% | ${f2(mine.reduce((s, x) => s + x.sigPerDay, 0), 2)} |`);
  }
}
const gate2 = ok === cells && cells === 6;

console.log("\n### คำตัดสินตามเกณฑ์ที่ประกาศไว้ก่อนเห็นผล\n");
console.log(`- ด่าน 1 test ของ BTCUSDT บวกทุก timeframe: ${gate1 ? "ผ่าน" : "ไม่ผ่าน"}`);
console.log(`- ด่าน 2 พอร์ตเหรียญอื่นบวก ${ok}/${cells}: ${gate2 ? "ผ่าน" : "ไม่ผ่าน"}`);
console.log(`- ด่าน 3 ชนะเส้นฐานถือฝั่งเดียวทุก timeframe บน test: ${gate3 ? "ผ่าน" : "ไม่ผ่าน"}`);
console.log(`\n**${gate1 && gate2 && gate3 ? "ผ่านครบ → ลงทะเบียนได้" : "ไม่ผ่าน → ไม่ลงทะเบียน"}**`);
