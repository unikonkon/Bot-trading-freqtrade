/**
 * ความเสี่ยงที่ใหญ่ที่สุดของสัญญาณนี้: ถ้าค่าเฉลี่ยของแรงซื้อขายสุทธิไม่ใช่ศูนย์
 * ตัวสัญญาณจะมีอคติไปข้างเดียวถาวร แล้วบังเอิญได้กำไรเพราะปีนี้เป็นขาลง
 * แก้ด้วยการเทียบกับค่าเฉลี่ยระยะยาวของตัวมันเอง (ยังใช้เฉพาะข้อมูลในอดีต)
 */
import { load, split, run, f2, tstat } from "./lib";
import { detectTimeframeMinutes } from "../../../lib/indicators-v3-core";
import type { KlineData } from "../../../lib/types/kline";

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
/** ลบค่าเฉลี่ยเคลื่อนที่ของตัวเอง M แท่ง (M=0 คือไม่ลบ) */
function demean(x: Float64Array, M: number) {
  if (M <= 0) return x;
  const n = x.length, out = new Float64Array(n).fill(NaN);
  let s = 0, cnt = 0;
  const q: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(x[i])) { q.push(x[i]); s += x[i]; cnt++; }
    while (q.length > M) { s -= q.shift()!; cnt--; }
    if (cnt >= M && Number.isFinite(x[i])) out[i] = x[i] - s / cnt;
  }
  return out;
}
function exposureOf(x: Float64Array, start: number, n: number, band: number) {
  const exp = new Array(n).fill(0);
  let dir = 0;
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
const FEE = 0.05, SLIP = 0.03;
for (const tf of ["15m", "30m"]) {
  const all = load(tf);
  const { train, test } = split(all);
  const tfm = detectTimeframeMinutes(all);
  const L = Math.round((5 * 1440) / tfm);
  const raw = ofiRaw(all, L);
  let s = 0, c = 0;
  for (let i = 1000; i < all.length; i++) if (Number.isFinite(raw[i])) { s += raw[i]; c++; }
  console.log(`\n##### ${tf} · L=${L} (5 วัน) · ค่าเฉลี่ยของแรงซื้อขายสุทธิตลอดปี = ${f2(s / c, 4)}`);
  for (const Mdays of [0, 30, 60, 120]) {
    const M = Mdays === 0 ? 0 : Math.round((Mdays * 1440) / tfm);
    const x = demean(raw, M);
    const cells = [0.005, 0.01, 0.02].map(band => {
      const ea = exposureOf(x, train.start, train.k.length, band);
      const a = run(train.k, ea, train.start, FEE, SLIP, 0.01);
      const eb = exposureOf(x, test.start, all.length, band);
      const b = run(all, eb, test.start, FEE, SLIP, 0.01);
      let sb = 0, lb = 0;
      for (let i = test.start; i < all.length; i++) eb[i] > 0 ? lb++ : eb[i] < 0 ? sb++ : 0;
      const ok = a.returnPct > 0 && b.returnPct > 0;
      return `${ok ? "✅" : "  "}b=${band}: ${f2(a.returnPct, 0).padStart(4)}/${f2(b.returnPct, 0).padStart(4)} (ซื้อ${f2((lb / (all.length - test.start)) * 100, 0)}%/ขาย${f2((sb / (all.length - test.start)) * 100, 0)}%)`;
    });
    console.log(`  ลบค่าเฉลี่ย ${String(Mdays).padStart(3)} วัน  ` + cells.join("  "));
  }
}
