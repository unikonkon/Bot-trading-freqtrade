/**
 * ทดสอบกลยุทธ์ที่ขับด้วยแรงซื้อขายสุทธิแบบ end-to-end พร้อมค่าธรรมเนียมจริง
 * สถานะ = ทิศของแรงซื้อขายสุทธิ L แท่ง ถือจนกว่าสัญญาณจะพลิก (turnover ต่ำโดยธรรมชาติ)
 * deadband กันการสลับไปมาตอนสัญญาณใกล้ศูนย์
 */
import { load, split, run, f2, tstat } from "./lib";
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
/** เข้าเมื่อ |ofi| > band, ออกเป็นสถานะว่างเมื่อ |ofi| < band/2 หรือเมื่อพลิกข้าง */
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
const COSTS = [
  { name: "fut-taker", fee: 0.05, slip: 0.03 },
  { name: "spot-taker", fee: 0.1, slip: 0.05 },
] as const;
const TFS = (process.argv[2] ?? "5m,15m,30m").split(",");
for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  console.log(`\n##### ${tf} — train / test (net%, เทรด) · ${COSTS[0].name}`);
  for (const L of [60, 120, 240, 480]) {
    const cells = [0, 0.005, 0.01, 0.02, 0.04].map(band => {
      const a = run(train.k, exposureOf(train.k, train.start, L, band), train.start, COSTS[0].fee, COSTS[0].slip, 0.01);
      const b = run(test.k, exposureOf(test.k, test.start, L, band), test.start, COSTS[0].fee, COSTS[0].slip, 0.01);
      const ok = a.returnPct > 0 && b.returnPct > 0;
      return `${ok ? "✅" : "  "}b=${band}: ${f2(a.returnPct, 0).padStart(4)}/${f2(b.returnPct, 0).padStart(4)} (${String(a.totalTrades).padStart(3)}/${String(b.totalTrades).padStart(2)})`;
    });
    console.log(`  L=${String(L).padStart(3)}  ` + cells.join("  "));
  }
}
