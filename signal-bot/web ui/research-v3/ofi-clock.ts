/**
 * สมมติฐาน: ความได้เปรียบของแรงซื้อขายสุทธิอยู่ที่ "ช่วงย้อนหลังเป็นเวลาจริง"
 * ถ้าจริง ผลต้องสอดคล้องกันข้าม timeframe เมื่อตั้งช่วงย้อนหลังเป็นจำนวนวันเท่ากัน
 */
import { load, split, TFS, run, f2, tstat } from "./lib";
import { detectTimeframeMinutes } from "../../../lib/indicators-v3";
import type { KlineData } from "../../../lib/types/kline";

function ofiSeries(k: KlineData[], L: number) {
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
function exposureOf(k: KlineData[], start: number, L: number, band: number) {
  const x = ofiSeries(k, L), exp = new Array(k.length).fill(0);
  let dir = 0;
  for (let i = start; i < k.length; i++) {
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
const FEE = 0.05, SLIP = 0.03, DAYS = [2, 3, 5, 8, 12];
const BAND = Number(process.argv[2] ?? 0.01);
console.log(`ช่วงย้อนหลังเป็นวัน · band ${BAND} · fee ${FEE} slip ${SLIP} · train / test (net%, เทรด)`);
for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  const tfm = detectTimeframeMinutes(all);
  const cells = DAYS.map(d => {
    const L = Math.round((d * 1440) / tfm);
    if (L < 4 || L > 20000) return `${d}ว: -`;
    const a = run(train.k, exposureOf(train.k, train.start, L, BAND), train.start, FEE, SLIP, 0.01);
    const b = run(test.k, exposureOf(test.k, test.start, L, BAND), test.start, FEE, SLIP, 0.01);
    const ok = a.returnPct > 0 && b.returnPct > 0;
    return `${ok ? "✅" : "  "}${d}ว(L${L}): ${f2(a.returnPct, 0).padStart(4)}/${f2(b.returnPct, 0).padStart(4)} (${String(a.totalTrades).padStart(3)}/${String(b.totalTrades).padStart(2)})`;
  });
  console.log(`  ${tf.padEnd(4)} ` + cells.join("  "));
}
