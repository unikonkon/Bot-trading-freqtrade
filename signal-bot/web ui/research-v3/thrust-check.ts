/**
 * ตรวจสัญญาณ "เหวี่ยงแรงแล้วไปต่อ" แบบ end-to-end พร้อมค่าธรรมเนียมจริง
 * กฎ: |ผลตอบแทน L แท่ง| > mult x ATR% x sqrt(L) แล้วเข้าตามทิศ ถือ H แท่ง
 * ทดสอบทุก timeframe เพื่อดูว่ารอดเฉพาะ 30m จริงหรือเป็นเรื่องบังเอิญ
 */
import { load, split, TFS, run, f2, tstat } from "./lib";
import { closes, atr } from "../../../lib/indicators-v2";
import type { KlineData } from "../../../lib/types/kline";

function exposureOf(k: KlineData[], start: number, L: number, mult: number, H: number, size: number) {
  const c = closes(k), a = atr(k, 14);
  const exp = new Array(k.length).fill(0);
  let until = -1, dir = 0;
  for (let i = start; i < k.length; i++) {
    if (i <= until) { exp[i] = dir * size; continue; }
    const A = a[i];
    if (A == null || A <= 0 || i < L) continue;
    const ret = ((c[i] - c[i - L]) / c[i - L]) * 100;
    const thr = mult * ((A / c[i]) * 100) * Math.sqrt(L);
    if (Math.abs(ret) > thr) { dir = ret > 0 ? 1 : -1; until = i + H; exp[i] = dir * size; }
  }
  return exp;
}
const FEE = 0.05, SLIP = 0.03;   // USDⓈ-M futures taker
for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  console.log(`\n##### ${tf}`);
  for (const [L, mult, H] of [[5, 1.5, 40], [5, 1.5, 20], [5, 2, 40], [10, 1.5, 40]] as const) {
    const line: string[] = [];
    for (const [label, w] of [["train", train], ["test", test]] as const) {
      const exp = exposureOf(w.k, w.start, L, mult, H, 1);
      const net = run(w.k, exp, w.start, FEE, SLIP, 0.01);
      const gross = run(w.k, exp, w.start, 0, 0, 0);
      const t = tstat(net.trades.map(x => x.pnlPct));
      line.push(`${label} net ${f2(net.returnPct).padStart(7)}% (gross ${f2(gross.returnPct).padStart(7)}%) n=${String(net.totalTrades).padStart(3)} win ${f2(net.winRate, 0).padStart(2)}% pf ${f2(net.profitFactor ?? 99)} dd ${f2(net.maxDrawdownPct).padStart(5)}% t=${f2(t.t, 2).padStart(5)}`);
    }
    console.log(`  L=${L} mult=${mult} hold=${H}\n    ${line[0]}\n    ${line[1]}`);
  }
}
