/**
 * สมมติฐาน: ความได้เปรียบอยู่ที่ "เวลาจริง" ไม่ใช่ "จำนวนแท่ง"
 * ถ้าจริง ผลที่หน่วยนาทีเดียวกันต้องสอดคล้องกันข้าม timeframe
 */
import { load, split, TFS, run, f2, tstat } from "./lib";
import { closes, atr } from "../../../lib/indicators-v2";
import { detectTimeframeMinutes } from "../../../lib/indicators-v3-core";
import type { KlineData } from "../../../lib/types/kline";

function exposureOf(k: KlineData[], start: number, Lbars: number, mult: number, Hbars: number) {
  const c = closes(k), a = atr(k, 14);
  const exp = new Array(k.length).fill(0);
  let until = -1, dir = 0;
  for (let i = start; i < k.length; i++) {
    if (i <= until) { exp[i] = dir; continue; }
    const A = a[i];
    if (A == null || A <= 0 || i < Lbars) continue;
    const ret = ((c[i] - c[i - Lbars]) / c[i - Lbars]) * 100;
    if (Math.abs(ret) > mult * ((A / c[i]) * 100) * Math.sqrt(Lbars)) { dir = ret > 0 ? 1 : -1; until = i + Hbars; exp[i] = dir; }
  }
  return exp;
}
const FEE = 0.05, SLIP = 0.03;
const HOLD_MIN = [300, 600, 1200, 1800, 2400];
const LOOK_MIN = 150, MULT = 1.6;
console.log(`เหวี่ยงแรง ${LOOK_MIN} นาที (mult ${MULT}) · ถือตามเวลาจริง · fee ${FEE} slip ${SLIP} · train / test net%`);
for (const tf of TFS) {
  const k = load(tf);
  const { train, test } = split(k);
  const tfm = detectTimeframeMinutes(k);
  const L = Math.max(2, Math.round(LOOK_MIN / tfm));
  const cells = HOLD_MIN.map(hm => {
    const H = Math.max(2, Math.round(hm / tfm));
    const a = run(train.k, exposureOf(train.k, train.start, L, MULT, H), train.start, FEE, SLIP, 0.01);
    const b = run(test.k, exposureOf(test.k, test.start, L, MULT, H), test.start, FEE, SLIP, 0.01);
    const t = tstat(b.trades.map(x => x.pnlPct));
    return `${a.returnPct > 0 && b.returnPct > 0 ? "✅" : "  "}${f2(a.returnPct, 0).padStart(4)}/${f2(b.returnPct, 0).padStart(4)} (n${String(b.totalTrades).padStart(3)} t${f2(t.t, 1).padStart(5)})`;
  });
  console.log(`  ${tf.padEnd(4)} L=${String(L).padStart(3)} แท่ง  ` + HOLD_MIN.map((hm, i) => `${hm}นาที:${cells[i]}`).join("  "));
}
