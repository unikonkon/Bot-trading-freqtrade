/**
 * ตรวจสัญญาณแรงซื้อขายสุทธิ (order-flow imbalance) อย่างเข้มงวด
 *
 * 1) IC แบบไม่ซ้อนทับ — สุ่มตัวอย่างทุก H แท่ง เพราะผลตอบแทนล่วงหน้าที่ซ้อนกัน
 *    ทำให้ t-stat ใหญ่เกินจริงราว sqrt(H) เท่า
 * 2) ทิศทางตลาดของแต่ละช่วง เพื่อกันการเข้าใจผิดว่าสัญญาณทำนายได้
 *    ทั้งที่เป็นเพียงตัวแทนของเทรนด์ใหญ่
 */
import { load, split, f2 } from "./lib";
import type { KlineData } from "../../../lib/types/kline";

const TFS = (process.argv[2] ?? "5m,15m,30m").split(",");

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
function icStride(x: Float64Array, c: Float64Array, from: number, to: number, H: number, stride: number) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = from; i + H < to; i += stride) {
    const a = x[i]; if (!Number.isFinite(a)) continue;
    const b = (c[i + H] - c[i]) / c[i];
    n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
  }
  if (n < 30) return { n, r: 0, t: 0 };
  const cov = sxy / n - (sx / n) * (sy / n);
  const sd = Math.sqrt(Math.max(1e-18, (sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2)));
  const r = cov / sd;
  return { n, r, t: r * Math.sqrt(Math.max(0, n - 2) / Math.max(1e-12, 1 - r * r)) };
}

for (const tf of TFS) {
  const all = load(tf);
  const { test } = split(all);
  const cut = test.start, n = all.length;
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) c[i] = +all[i].close;
  const bh = (a: number, b: number) => ((c[b - 1] / c[a] - 1) * 100);
  console.log(`\n##### ${tf} · Buy&Hold: train ${f2(bh(1000, cut))}% · test ${f2(bh(cut, n))}%`);
  console.log(`  ${"L".padStart(3)} ${"H".padStart(4)}  ${"IC train (ไม่ซ้อน)".padStart(22)}  ${"IC test (ไม่ซ้อน)".padStart(22)}`);
  for (const L of [20, 60, 120, 240]) {
    const x = ofiSeries(all, L);
    for (const H of [20, 40, 80, 160]) {
      const a = icStride(x, c, 1000, cut, H, H), b = icStride(x, c, cut, n, H, H);
      const mark = Math.sign(a.r) === Math.sign(b.r) && a.t > 1.5 && b.t > 1.5 ? " ✅" : "";
      console.log(`  ${String(L).padStart(3)} ${String(H).padStart(4)}   r=${f2(a.r, 3).padStart(6)} t=${f2(a.t, 2).padStart(5)} n=${String(a.n).padStart(4)}   r=${f2(b.r, 3).padStart(6)} t=${f2(b.t, 2).padStart(5)} n=${String(b.n).padStart(4)}${mark}`);
    }
  }
}
