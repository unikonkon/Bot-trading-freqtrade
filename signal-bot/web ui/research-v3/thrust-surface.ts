/** ความไวของสัญญาณเหวี่ยงแรงต่อพารามิเตอร์: ถ้าเป็นที่ราบแปลว่าแกร่ง ถ้าเป็นยอดแหลมแปลว่าบังเอิญ */
import { load, split, run, f2 } from "./lib";
import { closes, atr } from "../../../lib/indicators-v2";
import type { KlineData } from "../../../lib/types/kline";

function exposureOf(k: KlineData[], start: number, L: number, mult: number, H: number) {
  const c = closes(k), a = atr(k, 14);
  const exp = new Array(k.length).fill(0);
  let until = -1, dir = 0;
  for (let i = start; i < k.length; i++) {
    if (i <= until) { exp[i] = dir; continue; }
    const A = a[i];
    if (A == null || A <= 0 || i < L) continue;
    const ret = ((c[i] - c[i - L]) / c[i - L]) * 100;
    if (Math.abs(ret) > mult * ((A / c[i]) * 100) * Math.sqrt(L)) { dir = ret > 0 ? 1 : -1; until = i + H; exp[i] = dir; }
  }
  return exp;
}
const TF = process.argv[2] ?? "30m";
const { train, test } = split(load(TF));
const FEE = 0.05, SLIP = 0.03;
const HOLDS = [20, 30, 40, 50, 60, 80];
console.log(`\n##### ${TF} — ตาราง: train / test (net %, fee ${FEE} slip ${SLIP})`);
for (const L of [3, 5, 8]) {
  for (const mult of [1.2, 1.5, 1.8]) {
    const cells = HOLDS.map(H => {
      const a = run(train.k, exposureOf(train.k, train.start, L, mult, H), train.start, FEE, SLIP, 0.01);
      const b = run(test.k, exposureOf(test.k, test.start, L, mult, H), test.start, FEE, SLIP, 0.01);
      const both = a.returnPct > 0 && b.returnPct > 0;
      return `${both ? "✅" : "  "}${f2(a.returnPct, 0).padStart(4)}/${f2(b.returnPct, 0).padStart(4)}`;
    });
    console.log(`  L=${L} mult=${mult}  ` + HOLDS.map((H, i) => `H${H}:${cells[i]}`).join("  "));
  }
}
