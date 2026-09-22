/**
 * วัดผู้สมัครบนเส้นขอบเขตความถี่ให้ครบทุกด่าน ก่อนลงทะเบียน
 *
 * `frequency-frontier.ts` พบว่าตัวคุมความถี่ที่ไม่ทำลายความได้เปรียบคือ **flowBand**
 * (เกณฑ์เข้า) ไม่ใช่ `flowLookbackDays` (หน้าต่างสะสม) ซึ่งเป็นสิ่งที่เคยลองแล้วพัง
 * ลด band ลงพร้อมย่อ debias เหลือ 10 วัน ให้ทั้งสัญญาณถี่ขึ้นและกำไร train สูงขึ้น
 *
 * ═══ เกณฑ์ตัดสิน ประกาศไว้ก่อนเห็นผล test และก่อนเห็นผลเหรียญอื่น ═══════
 *   1) ที่ราบ: เพื่อนบ้านทุกแกนบน train ต้องเป็นบวก
 *   2) test ของ BTCUSDT ต้องเป็นบวกทุก timeframe ที่ใช้งานได้
 *   3) พอร์ต ETH/SOL/BNB/XRP ต้องเป็นบวกทั้งสองช่วง ทั้ง 15m และ 30m (4/4)
 *   4) ต้องให้สัญญาณ ≥1 ครั้ง/วันบนเหรียญเดียว มิฉะนั้นไม่ตอบโจทย์
 * ครบทุกข้อ = ลงทะเบียนเป็นรหัสความถี่สูง · ไม่ครบ = รายงานตัวเลขแล้วเลือกจุดที่ต่ำลงมา
 *
 *   npx tsx "signal-bot/web ui/research-v3/fast-validate.ts"
 */
import fs from "node:fs";
import path from "node:path";
import { load, split, run, f2, SPLIT_AT } from "./lib";
import { orderFlowV3 } from "../../../lib/indicators-v3";
import type { KlineData } from "../../../lib/types/kline";

const COIN_DIR = "data-test/crosscoin";
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const PER_DAY: Record<string, number> = { "1m": 1440, "3m": 480, "5m": 288, "15m": 96, "30m": 48 };
const ALL_TFS = ["1m", "3m", "5m", "15m", "30m"];

type P = { flowLookbackDays: number; flowDebiasDays: number; flowBand: number; flowExitMult: number };
const CANDIDATES: { name: string; p: P }[] = [
  { name: "A ถี่ปานกลาง", p: { flowLookbackDays: 5, flowDebiasDays: 10, flowBand: 0.005, flowExitMult: 0 } },
  { name: "B ถี่สูง", p: { flowLookbackDays: 5, flowDebiasDays: 10, flowBand: 0.002, flowExitMult: 0.5 } },
  { name: "C ถี่สูงสุด", p: { flowLookbackDays: 5, flowDebiasDays: 10, flowBand: 0.002, flowExitMult: 1 } },
];
const CURRENT: P = { flowLookbackDays: 5, flowDebiasDays: 120, flowBand: 0.01, flowExitMult: 0.5 };
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ══ 1) ที่ราบบน train ═══════════════════════════════════════════════════
console.log("# วัดผู้สมัครความถี่สูงให้ครบทุกด่าน\n");
console.log("## 1. ที่ราบบน train ของ BTCUSDT — เปลี่ยนทีละแกน (ค่ากลาง 15m + 30m)\n");
const trains = Object.fromEntries(["15m", "30m"].map((tf) => [tf, split(load(tf)).train]));
const trainRet = (p: P) => median(["15m", "30m"].map((tf) => {
  const w = trains[tf];
  return run(w.k, orderFlowV3(w.k, p, w.start).exposure, w.start, FEE, SLIP, FUNDING).returnPct;
}));
const AXES: { key: keyof P; vals: number[] }[] = [
  { key: "flowLookbackDays", vals: [3, 4, 5, 6, 8] },
  { key: "flowDebiasDays", vals: [5, 8, 10, 15, 20] },
  { key: "flowBand", vals: [0.001, 0.002, 0.005, 0.01] },
  { key: "flowExitMult", vals: [1, 0.5, 0, -0.5] },
];
console.log("| ผู้สมัคร | เอง | " + AXES.map((a) => a.key).join(" | ") + " | ที่ราบ |");
console.log("|---|---:|" + AXES.map(() => "---").join("|") + "|---|");
const flat: Record<string, boolean> = {};
for (const c of CANDIDATES) {
  const cells = AXES.map((a) => {
    const i = a.vals.indexOf(c.p[a.key]);
    const nb = [i - 1, i + 1].filter((j) => j >= 0 && j < a.vals.length);
    return nb.map((j) => f2(trainRet({ ...c.p, [a.key]: a.vals[j] }), 0)).join(" ");
  });
  const ok = cells.flatMap((x) => x.split(" ")).every((x) => Number(x) > 0);
  flat[c.name] = ok;
  console.log(`| ${c.name} | ${f2(trainRet(c.p), 0)} | ${cells.join(" | ")} | ${ok ? "✅" : "❌"} |`);
}

// ══ 2) test ของ BTCUSDT ═════════════════════════════════════════════════
console.log("\n## 2. BTCUSDT ครบทั้ง 5 timeframe — train / test / สัญญาณต่อวัน\n");
console.log("| ผู้สมัคร | " + ALL_TFS.join(" | ") + " |");
console.log("|---|" + ALL_TFS.map(() => "---").join("|") + "|");
const testOk: Record<string, boolean> = {};
const sigRate: Record<string, number> = {};
for (const c of [...CANDIDATES, { name: "ค่าปัจจุบัน `orderflow_v3`", p: CURRENT }]) {
  let ok = true; const sigs: number[] = [];
  const cells = ALL_TFS.map((tf) => {
    const { train, test } = split(load(tf));
    const a = run(train.k, orderFlowV3(train.k, c.p, train.start).exposure, train.start, FEE, SLIP, FUNDING);
    const r = orderFlowV3(test.k, c.p, test.start);
    const b = run(test.k, r.exposure, test.start, FEE, SLIP, FUNDING);
    const sig = r.signal.filter(Boolean).length / ((test.k.length - test.start) / PER_DAY[tf]);
    sigs.push(sig);
    if (b.returnPct <= 0) ok = false;
    return `${f2(a.returnPct, 0)}/${b.returnPct > 0 ? "**" : ""}${f2(b.returnPct, 0)}${b.returnPct > 0 ? "**" : ""}<br><sub>${f2(sig, 2)}/วัน</sub>`;
  });
  testOk[c.name] = ok; sigRate[c.name] = median(sigs);
  console.log(`| ${c.name} | ${cells.join(" | ")} |`);
}

// ══ 3) เหรียญที่ไม่เคยถูกใช้เลือกค่าเลย ══════════════════════════════════
type W = { k: KlineData[]; start: number };
function coinWindows(tf: string) {
  return fs.readdirSync(COIN_DIR).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort().map((file) => {
    const k = fs.readFileSync(path.join(COIN_DIR, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
    return { name: file.split("-")[0].replace("USDT", ""),
      before: { k: k.slice(0, k.findIndex((b) => b.openTime >= SPLIT_AT)), start: k.findIndex((b) => b.openTime >= EVAL_FROM) } as W,
      after: { k, start: k.findIndex((b) => b.openTime >= SPLIT_AT) } as W };
  });
}
function portfolio(tf: string, p: P) {
  const cs = coinWindows(tf).map((c) => ({
    before: run(c.before.k, orderFlowV3(c.before.k, p, c.before.start).exposure, c.before.start, FEE, SLIP, FUNDING),
    after: run(c.after.k, orderFlowV3(c.after.k, p, c.after.start).exposure, c.after.start, FEE, SLIP, FUNDING),
  }));
  const blend = (key: "before" | "after") => {
    const len = Math.min(...cs.map((x) => x[key].equity.length));
    let last = 0;
    for (let i = 0; i < len; i++) last = cs.reduce((s, x) => s + x[key].equity[i], 0) / cs.length;
    return last;
  };
  return { before: blend("before"), after: blend("after") };
}
console.log("\n## 3. พอร์ต ETH/SOL/BNB/XRP ที่ไม่เคยถูกใช้เลือกค่าเลย (ก่อน/หลัง 17 พ.ค.)\n");
console.log("| ผู้สมัคร | 15m | 30m | ผ่าน |");
console.log("|---|---:|---:|---|");
const coinOk: Record<string, number> = {};
for (const c of [...CANDIDATES, { name: "ค่าปัจจุบัน `orderflow_v3`", p: CURRENT }]) {
  let ok = 0;
  const cells = ["15m", "30m"].map((tf) => {
    const r = portfolio(tf, c.p);
    const pass = r.before > 0 && r.after > 0;
    if (pass) ok += 2; // นับเป็นสองช่อง (ก่อน/หลัง)
    return `${pass ? "✅ " : ""}${f2(r.before, 1)}/${f2(r.after, 1)}`;
  });
  coinOk[c.name] = ok;
  console.log(`| ${c.name} | ${cells.join(" | ")} | **${ok}/4** |`);
}

console.log("\n## 4. คำตัดสินตามเกณฑ์ที่ประกาศไว้\n");
for (const c of CANDIDATES) {
  const all = flat[c.name] && testOk[c.name] && coinOk[c.name] === 4 && sigRate[c.name] >= 1;
  console.log(`- **${c.name}** (band ${c.p.flowBand} · exit ${c.p.flowExitMult}) — ที่ราบ: ${flat[c.name] ? "ผ่าน" : "ไม่ผ่าน"} · test: ${testOk[c.name] ? "ผ่าน" : "ไม่ผ่าน"} · เหรียญอื่น: ${coinOk[c.name]}/4 · ${f2(sigRate[c.name], 2)} สัญญาณ/วัน → **${all ? "ลงทะเบียนได้" : "ไม่ครบทุกข้อ"}**`);
}
