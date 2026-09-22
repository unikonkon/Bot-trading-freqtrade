/**
 * คัดกรองที่มาของสัญญาณใหม่ ก่อนจะเขียนกฎการเข้า–ออกใด ๆ
 *
 * วัดด้วย Information Coefficient = สหสัมพันธ์ระหว่างค่าทำนายกับผลตอบแทนล่วงหน้า
 * เกณฑ์ผ่าน: IC มีเครื่องหมายเดียวกันทั้ง train และ test และไม่เล็กจนไร้ความหมาย
 * ทุกค่าทำนายใช้ข้อมูลถึงแท่ง i เท่านั้น จึงไม่มีการมองอนาคต
 */
import { load, split, f2 } from "./lib";
import type { KlineData } from "../../../lib/types/kline";

const TFS = (process.argv[2] ?? "5m,15m,30m").split(",");
const HORIZONS = [20, 40, 80];

function features(k: KlineData[]) {
  const n = k.length;
  const c = new Float64Array(n), v = new Float64Array(n), tb = new Float64Array(n), qv = new Float64Array(n), nt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    c[i] = +k[i].close; v[i] = +k[i].volume; tb[i] = +k[i].takerBuyBaseVolume;
    qv[i] = +k[i].quoteAssetVolume; nt[i] = k[i].numberOfTrades;
  }
  // ปริมาณฝั่งซื้อสุทธิรายแท่ง: +1 = ซื้อล้วน, −1 = ขายล้วน
  const signed = new Float64Array(n);
  for (let i = 0; i < n; i++) signed[i] = v[i] > 0 ? (2 * tb[i] - v[i]) / v[i] : 0;
  const signedVol = new Float64Array(n);
  for (let i = 0; i < n; i++) signedVol[i] = 2 * tb[i] - v[i];
  const avgSize = new Float64Array(n);
  for (let i = 0; i < n; i++) avgSize[i] = nt[i] > 0 ? qv[i] / nt[i] : 0;

  const roll = (src: Float64Array, L: number) => {
    const out = new Float64Array(n).fill(NaN);
    let s = 0;
    for (let i = 0; i < n; i++) { s += src[i]; if (i >= L) s -= src[i - L]; if (i >= L - 1) out[i] = s; }
    return out;
  };
  const zscore = (src: Float64Array, L: number) => {
    const out = new Float64Array(n).fill(NaN);
    let s = 0, s2 = 0;
    for (let i = 0; i < n; i++) {
      s += src[i]; s2 += src[i] * src[i];
      if (i >= L) { s -= src[i - L]; s2 -= src[i - L] * src[i - L]; }
      if (i >= L - 1) { const m = s / L, sd = Math.sqrt(Math.max(1e-12, s2 / L - m * m)); out[i] = (src[i] - m) / sd; }
    }
    return out;
  };
  const ret = (L: number) => {
    const out = new Float64Array(n).fill(NaN);
    for (let i = L; i < n; i++) out[i] = (c[i] - c[i - L]) / c[i - L];
    return out;
  };

  const F: Record<string, Float64Array> = {};
  for (const L of [5, 20, 60]) {
    const sv = roll(signedVol, L), tv = roll(v, L);
    // 1) แรงซื้อขายสุทธิสะสม L แท่ง เทียบปริมาณรวม
    const ofi = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) if (tv[i] > 0) ofi[i] = sv[i] / tv[i];
    F[`ofi${L}`] = ofi;
    // 2) แรงซื้อขายสุทธิที่ยังไม่สะท้อนในราคา (divergence)
    const r = ret(L), zo = zscore(ofi, 200), zr = zscore(r, 200);
    const div = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) div[i] = zo[i] - zr[i];
    F[`ofiDiv${L}`] = div;
    // 3) โมเมนตัมราคาล้วน ใช้เป็นเส้นเปรียบเทียบ
    F[`ret${L}`] = r;
    // 4) ขนาดไม้เฉลี่ย (ตัวแทนของรายใหญ่) คูณทิศของแรงซื้อขาย
    const zs = zscore(avgSize, 200);
    const big = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) big[i] = zs[i] * ofi[i];
    F[`bigFlow${L}`] = big;
  }
  return { F, c };
}

function ic(x: Float64Array, y: Float64Array, from: number, to: number) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = from; i < to; i++) {
    const a = x[i], b = y[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
  }
  if (n < 100) return { n, r: 0, t: 0 };
  const cov = sxy / n - (sx / n) * (sy / n);
  const sd = Math.sqrt(Math.max(1e-18, (sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2)));
  const r = cov / sd;
  return { n, r, t: r * Math.sqrt(Math.max(0, n - 2) / Math.max(1e-12, 1 - r * r)) };
}

for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  const { F, c } = features(all);
  const cut = test.start;
  const n = all.length;
  console.log(`\n##### ${tf} — train [1000,${cut}) · test [${cut},${n})`);
  console.log(`  ${"ค่าทำนาย".padEnd(12)} ${"N".padStart(3)}  ${"IC train".padStart(9)} ${"t".padStart(7)}   ${"IC test".padStart(9)} ${"t".padStart(7)}   ผ่าน`);
  for (const [name, x] of Object.entries(F)) {
    for (const H of HORIZONS) {
      const fwd = new Float64Array(n).fill(NaN);
      for (let i = 0; i + H < n; i++) fwd[i] = (c[i + H] - c[i]) / c[i];
      const a = ic(x, fwd, 1000, cut), b = ic(x, fwd, cut, n);
      // ผ่านเมื่อเครื่องหมายตรงกัน และมีนัยสำคัญทั้งสองช่วง
      const pass = Math.sign(a.r) === Math.sign(b.r) && Math.abs(a.t) > 3 && Math.abs(b.t) > 3;
      if (pass || Math.abs(b.t) > 4)
        console.log(`  ${name.padEnd(12)} ${String(H).padStart(3)}  ${f2(a.r, 4).padStart(9)} ${f2(a.t, 1).padStart(7)}   ${f2(b.r, 4).padStart(9)} ${f2(b.t, 1).padStart(7)}   ${pass ? "✅" : ""}`);
    }
  }
}
