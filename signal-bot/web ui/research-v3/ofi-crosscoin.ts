/**
 * ทดสอบข้ามเหรียญ — ค่าพารามิเตอร์ทั้งหมดถูกเลือกจาก BTCUSDT ช่วง train เท่านั้น
 * เหรียญอื่นไม่เคยถูกใช้เลือกอะไรเลย จึงเป็นการทดสอบนอกตัวอย่างข้ามสินทรัพย์
 */
import fs from "node:fs";
import path from "node:path";
import { run, f2, tstat, SPLIT_AT } from "./lib";
import type { KlineData } from "../../../lib/types/kline";

const DIR = process.argv[2];
const LOOK_DAYS = 5, DEBIAS_DAYS = 120, FEE = 0.05, SLIP = 0.03;

function ofiRaw(k: KlineData[], L: number) {
  const n = k.length, out = new Float64Array(n).fill(NaN);
  let sv = 0, tv = 0;
  const sVal = (i: number) => 2 * +k[i].takerBuyBaseVolume - +k[i].volume;
  for (let i = 0; i < n; i++) {
    sv += sVal(i); tv += +k[i].volume;
    if (i >= L) { sv -= sVal(i - L); tv -= +k[i - L].volume; }
    if (i >= L - 1 && tv > 0) out[i] = sv / tv;
  }
  return out;
}
function debias(x: Float64Array, M: number) {
  const n = x.length, out = new Float64Array(n).fill(NaN);
  let s = 0, cnt = 0; const q: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(x[i])) { s += x[i]; cnt++; q.push(x[i]); }
    while (q.length > M) { s -= q.shift()!; cnt--; }
    if (cnt >= M && Number.isFinite(x[i])) out[i] = x[i] - s / cnt;
  }
  return out;
}
function exposureOf(x: Float64Array, start: number, n: number, band: number) {
  const exp = new Array(n).fill(0); let dir = 0;
  for (let i = start; i < n; i++) {
    const v = x[i];
    if (Number.isFinite(v)) {
      if (dir === 0) { if (v > band) dir = 1; else if (v < -band) dir = -1; }
      else if (dir === 1 && v < band / 2) dir = v < -band ? -1 : 0;
      else if (dir === -1 && v > -band / 2) dir = v > band ? 1 : 0;
    }
    exp[i] = dir;
  }
  return exp;
}
const files = fs.readdirSync(DIR).filter(f => f.endsWith(".jsonl")).sort();
let cells = 0, pos = 0;
for (const file of files) {
  const k = fs.readFileSync(path.join(DIR, file), "utf8").trim().split("\n").map(l => JSON.parse(l) as KlineData);
  const tfm = (k[1].openTime - k[0].openTime) / 60000;
  const L = Math.round((LOOK_DAYS * 1440) / tfm), M = Math.round((DEBIAS_DAYS * 1440) / tfm);
  const x = debias(ofiRaw(k, L), M);
  const cut = k.findIndex(b => b.openTime >= SPLIT_AT);
  const warm = L + M;                       // แท่งแรกที่สัญญาณใช้ได้
  console.log(`\n##### ${file.replace(".jsonl", "")} — L=${L} M=${M} เริ่มใช้ได้ที่แท่ง ${warm}`);
  for (const band of [0.005, 0.01, 0.02]) {
    const parts: string[] = [];
    for (const [label, from, to] of [["ก่อน 17 พ.ค.", warm, cut], ["หลัง 17 พ.ค.", cut, k.length], ["ทั้งชุด", warm, k.length]] as const) {
      const s = run(k.slice(0, to), exposureOf(x, from, to, band), from, FEE, SLIP, 0.01);
      const t = tstat(s.trades.map(v => v.pnlPct));
      const alwaysShort = run(k.slice(0, to), new Array(to).fill(-1), from, FEE, SLIP, 0.01);
      if (label === "หลัง 17 พ.ค.") { cells++; if (s.returnPct > 0) pos++; }
      parts.push(`${label} ${f2(s.returnPct).padStart(7)}% (B&H ${f2(s.buyAndHoldPct, 0).padStart(4)}% · ขายตลอด ${f2(alwaysShort.returnPct, 0).padStart(4)}% · n=${String(s.totalTrades).padStart(3)} pf ${f2(s.profitFactor ?? 99)} t=${f2(t.t, 2)})`);
    }
    console.log(`  band ${band}\n    ${parts.join("\n    ")}`);
  }
}
console.log(`\nสรุปช่วงที่ไม่เคยถูกใช้เลือกค่าเลย (หลัง 17 พ.ค. ทุกเหรียญ ทุก band): บวก ${pos}/${cells}`);
