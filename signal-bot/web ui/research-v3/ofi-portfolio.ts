/**
 * ประเมินแบบพอร์ตกระจายเหรียญ ซึ่งเป็นวิธีที่จะใช้จริง
 * แบ่งทุนเท่า ๆ กันต่อเหรียญ ไม่ย้ายทุนข้ามเหรียญ แล้วรวมเส้นทุน
 */
import fs from "node:fs";
import path from "node:path";
import { run, f2, tstat, SPLIT_AT } from "./lib";
import type { KlineData } from "../../../lib/types/kline";

const DIR = process.argv[2], TF = process.argv[3] ?? "30m";
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
const files = fs.readdirSync(DIR).filter(f => f.endsWith(`-${TF}.jsonl`)).sort();
console.log(`\n##### พอร์ต ${TF} · ${files.length} เหรียญ · ย้อนหลัง ${LOOK_DAYS} วัน · ลบอคติ ${DEBIAS_DAYS} วัน · fee ${FEE} slip ${SLIP}`);
for (const band of [0.005, 0.01, 0.02]) {
  const perCoin: { sym: string; before: number; after: number; all: number; n: number; dd: number }[] = [];
  const curves: { before: number[]; after: number[] }[] = [];
  for (const file of files) {
    const k = fs.readFileSync(path.join(DIR, file), "utf8").trim().split("\n").map(l => JSON.parse(l) as KlineData);
    const tfm = (k[1].openTime - k[0].openTime) / 60000;
    const L = Math.round((LOOK_DAYS * 1440) / tfm), M = Math.round((DEBIAS_DAYS * 1440) / tfm);
    const x = debias(ofiRaw(k, L), M);
    const cut = k.findIndex(b => b.openTime >= SPLIT_AT), warm = L + M;
    const a = run(k.slice(0, cut), exposureOf(x, warm, cut, band), warm, FEE, SLIP, 0.01);
    const b = run(k, exposureOf(x, cut, k.length, band), cut, FEE, SLIP, 0.01);
    const all = run(k, exposureOf(x, warm, k.length, band), warm, FEE, SLIP, 0.01);
    perCoin.push({ sym: file.replace(`-${TF}.jsonl`, ""), before: a.returnPct, after: b.returnPct, all: all.returnPct, n: all.totalTrades, dd: all.maxDrawdownPct });
    curves.push({ before: a.equity, after: b.equity });
  }
  // พอร์ต = ค่าเฉลี่ยของเส้นทุนรายเหรียญ (แบ่งทุนเท่ากัน ไม่ย้ายข้ามเหรียญ)
  const blend = (key: "before" | "after") => {
    const len = Math.min(...curves.map(c => c[key].length));
    const out: number[] = [];
    for (let i = 0; i < len; i++) out.push(curves.reduce((s, c) => s + c[key][i], 0) / curves.length);
    let peak = 0, dd = 0;
    for (const v of out) { peak = Math.max(peak, v); dd = Math.max(dd, peak - v); }
    return { ret: out.at(-1) ?? 0, dd };
  };
  const before = blend("before"), after = blend("after");
  const afterRets = perCoin.map(c => c.after);
  const t = tstat(afterRets);
  console.log(`\n  band ${band}`);
  console.log(`    รายเหรียญ (ก่อน / หลัง 17 พ.ค. / ทั้งชุด):`);
  for (const c of perCoin)
    console.log(`      ${c.sym.padEnd(9)} ${f2(c.before).padStart(7)}% / ${f2(c.after).padStart(7)}% / ${f2(c.all).padStart(7)}%  (เทรด ${String(c.n).padStart(3)}, dd ${f2(c.dd)}%)`);
  console.log(`    พอร์ตแบ่งทุนเท่ากัน:  ก่อน ${f2(before.ret).padStart(7)}% (dd ${f2(before.dd)}%) · หลัง ${f2(after.ret).padStart(7)}% (dd ${f2(after.dd)}%)`);
  console.log(`    ค่าเฉลี่ยผลตอบแทนรายเหรียญช่วงหลัง ${f2(t.mean)}% · t=${f2(t.t, 2)} (n=${t.n} เหรียญ)`);
}
