/**
 * ตรวจสัญญาณแรงซื้อขายสุทธิอย่างละเอียด ก่อนนำไปเขียนเป็นกลยุทธ์
 * ประเด็นที่ต้องตัดทิ้งให้ได้: ได้กำไรเพราะ "ขายในตลาดขาลง" เฉย ๆ หรือเพราะจำนวนเทรดน้อยแล้วโชคดี
 */
import { load, split, run, f2, tstat } from "./lib";
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
const FEE = 0.05, SLIP = 0.03, BAND = 0.01, DAYS = 5;
for (const tf of ["15m", "30m"]) {
  const all = load(tf);
  const { train, test } = split(all);
  const tfm = detectTimeframeMinutes(all);
  const L = Math.round((DAYS * 1440) / tfm);
  console.log(`\n##### ${tf} · ย้อนหลัง ${DAYS} วัน (L=${L}) · band ${BAND}`);
  for (const [label, w] of [["train", train], ["test", test], ["เต็มปี", { k: all, start: 1000 }]] as const) {
    const exp = exposureOf(w.k, w.start, L, BAND);
    const s = run(w.k, exp, w.start, FEE, SLIP, 0.01);
    const bars = w.k.length - w.start;
    // สัดส่วนเวลาที่ถืออยู่แต่ละฝั่ง และผลตอบแทนแยกฝั่ง
    let longBars = 0, shortBars = 0, flatBars = 0;
    for (let i = w.start; i < w.k.length; i++) exp[i] > 0 ? longBars++ : exp[i] < 0 ? shortBars++ : flatBars++;
    const L$ = s.trades.filter(t => t.direction === "long"), S$ = s.trades.filter(t => t.direction === "short");
    const sum = (xs: typeof L$) => xs.reduce((a, t) => a + t.pnlPct, 0);
    const t = tstat(s.trades.map(x => x.pnlPct));
    // เส้นฐาน: ขายตลอดเวลา และถือซื้อตลอดเวลา ในสัดส่วนเวลาเท่ากัน
    const alwaysShort = run(w.k, new Array(w.k.length).fill(-1), w.start, FEE, SLIP, 0.01);
    console.log(`  ${label.padEnd(6)} net ${f2(s.returnPct).padStart(7)}% · B&H ${f2(s.buyAndHoldPct).padStart(7)}% · ขายตลอด ${f2(alwaysShort.returnPct).padStart(7)}%`);
    console.log(`         เทรด ${s.totalTrades} · ชนะ ${f2(s.winRate, 0)}% · pf ${f2(s.profitFactor ?? 99)} · dd ${f2(s.maxDrawdownPct)}% · t=${f2(t.t, 2)}`);
    console.log(`         เวลาถือ ซื้อ ${f2((longBars / bars) * 100, 0)}% / ขาย ${f2((shortBars / bars) * 100, 0)}% / ว่าง ${f2((flatBars / bars) * 100, 0)}%`);
    console.log(`         ผลรวมฝั่งซื้อ ${f2(sum(L$)).padStart(7)}% (${L$.length} ไม้) · ฝั่งขาย ${f2(sum(S$)).padStart(7)}% (${S$.length} ไม้)`);
  }
}
