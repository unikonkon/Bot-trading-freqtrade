/** ที่ราบของสัญญาณแรงซื้อขายสุทธิแบบลบอคติ: นับช่องที่เป็นบวกทั้ง train และ test */
import { load, split, TFS, run, f2 } from "./lib";
import { detectTimeframeMinutes } from "../../../lib/indicators-v3";
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
/** mode "roll" = ค่าเฉลี่ยเคลื่อนที่ M แท่ง · "expand" = ค่าเฉลี่ยสะสมทั้งหมดที่ผ่านมา (ต้องมีอย่างน้อย M แท่ง) */
function debias(x: Float64Array, M: number, mode: "roll" | "expand") {
  const n = x.length, out = new Float64Array(n).fill(NaN);
  let s = 0, cnt = 0; const q: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(x[i])) { s += x[i]; cnt++; if (mode === "roll") q.push(x[i]); }
    if (mode === "roll") while (q.length > M) { s -= q.shift()!; cnt--; }
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
const FEE = 0.05, SLIP = 0.03;
const BANDS = [0.005, 0.01, 0.02], LOOKS = [3, 5, 8, 12];
for (const mode of ["expand", "roll"] as const) {
  for (const Mdays of [60, 120]) {
    console.log(`\n##### ลบอคติแบบ ${mode === "expand" ? "สะสม" : "เคลื่อนที่"} ${Mdays} วัน — จำนวนช่องที่บวกทั้ง train และ test (จาก ${LOOKS.length * BANDS.length})`);
    for (const tf of TFS) {
      const all = load(tf);
      const { train, test } = split(all);
      const tfm = detectTimeframeMinutes(all);
      const M = Math.round((Mdays * 1440) / tfm);
      let ok = 0; const detail: string[] = [];
      for (const d of LOOKS) {
        const x = debias(ofiRaw(all, Math.round((d * 1440) / tfm)), M, mode);
        for (const band of BANDS) {
          const a = run(train.k, exposureOf(x, train.start, train.k.length, band), train.start, FEE, SLIP, 0.01);
          const b = run(all, exposureOf(x, test.start, all.length, band), test.start, FEE, SLIP, 0.01);
          if (a.returnPct > 0 && b.returnPct > 0) ok++;
          detail.push(`${d}ว b${band}:${a.returnPct > 0 && b.returnPct > 0 ? "✅" : "  "}${f2(a.returnPct, 0).padStart(4)}/${f2(b.returnPct, 0).padStart(4)}`);
        }
      }
      console.log(`  ${tf.padEnd(4)} ${String(ok).padStart(2)}/12`);
      for (let r = 0; r < detail.length; r += 3) console.log(`        ` + detail.slice(r, r + 3).join("  "));
    }
  }
}
