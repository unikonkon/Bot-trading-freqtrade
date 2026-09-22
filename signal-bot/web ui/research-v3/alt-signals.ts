/**
 * มีสัญญาณชนิดใดในข้อมูลชุดนี้ที่มีความได้เปรียบเชิงทิศทางซึ่งอยู่รอดข้าม train→test บ้าง
 * เงื่อนไขผ่าน: เครื่องหมายตรงกันทั้งสองช่วง และ |ค่าเฉลี่ย| บน test เกินต้นทุนไป–กลับ 0.16%
 */
import { load, split, f2, tstat } from "./lib";
import { closes, highs, lows, volumes, atr, ema, sma, rsiV2 } from "../../../lib/indicators-v2";
import type { KlineData } from "../../../lib/types/kline";

const COST = 0.16;
type Cand = { name: string; side: number; i: number };

function candidates(k: KlineData[], start: number): Cand[] {
  const c = closes(k), h = highs(k), l = lows(k), v = volumes(k);
  const a = atr(k, 14), e21 = ema(c, 21), e55 = ema(c, 55);
  const rsi = rsiV2(k, { rsiLength: 14 }).rsi, vMean = sma(v, 20);
  const out: Cand[] = [];
  for (let i = start; i < k.length; i++) {
    const A = a[i], E21 = e21[i], E55 = e55[i], R = rsi[i], VM = vMean[i - 1];
    if (A == null || A <= 0 || E21 == null || E55 == null || R == null || VM == null || VM <= 0) continue;
    const hour = new Date(k[i].openTime).getUTCHours();
    const ret5 = (c[i] - c[i - 5]) / c[i - 5] * 100;
    const vr = v[i] / VM;
    // 1) กลับตัวระยะสั้น: ราคาเหวี่ยงแรงใน 5 แท่ง แล้วเข้าสวน
    if (ret5 > 1.5 * (A / c[i] * 100) * Math.sqrt(5)) out.push({ name: "reversal-5", side: -1, i });
    if (ret5 < -1.5 * (A / c[i] * 100) * Math.sqrt(5)) out.push({ name: "reversal-5", side: 1, i });
    // 2) โมเมนตัมตามแรง: ราคาเหวี่ยงแรงแล้วเข้าตาม
    if (ret5 > 1.5 * (A / c[i] * 100) * Math.sqrt(5)) out.push({ name: "momentum-5", side: 1, i });
    if (ret5 < -1.5 * (A / c[i] * 100) * Math.sqrt(5)) out.push({ name: "momentum-5", side: -1, i });
    // 3) RSI สุดขั้วแล้วเข้าสวน
    if (R > 75) out.push({ name: "rsi-fade", side: -1, i });
    if (R < 25) out.push({ name: "rsi-fade", side: 1, i });
    // 4) ตามเทรนด์ EMA
    out.push({ name: "ema-trend", side: E21 > E55 ? 1 : -1, i });
    // 5) ทะลุกรอบ 20 แท่งพร้อมปริมาณ
    let hi = -Infinity, lo = Infinity;
    for (let j = i - 20; j < i; j++) { if (h[j] > hi) hi = h[j]; if (l[j] < lo) lo = l[j]; }
    if (c[i] > hi && vr > 1.5) out.push({ name: "breakout-vol", side: 1, i });
    if (c[i] < lo && vr > 1.5) out.push({ name: "breakout-vol", side: -1, i });
    // 6) ช่วงเวลา: ถือตามทิศของแท่งแรกของชั่วโมงที่ตลาดสหรัฐเปิด
    if (hour === 13) out.push({ name: "us-open-mom", side: c[i] > c[i - 1] ? 1 : -1, i });
    // 7) แท่งกลืนกิน
    if (c[i] > c[i - 1] && c[i - 1] < c[i - 2] && vr > 1.2) out.push({ name: "engulf", side: 1, i });
    if (c[i] < c[i - 1] && c[i - 1] > c[i - 2] && vr > 1.2) out.push({ name: "engulf", side: -1, i });
  }
  return out;
}

for (const tf of ["5m", "15m", "30m"]) {
  const all = load(tf);
  const { train, test } = split(all);
  console.log(`\n##### ${tf}`);
  const res: Record<string, Record<string, { mean: number; t: number; n: number }>> = {};
  for (const [label, w] of [["train", train], ["test", test]] as const) {
    const c = closes(w.k);
    const cands = candidates(w.k, w.start);
    for (const N of [20, 40]) {
      const byName: Record<string, number[]> = {};
      for (const cd of cands) {
        if (cd.i + N >= c.length) continue;
        (byName[`${cd.name}@${N}`] ??= []).push((cd.side * (c[cd.i + N] - c[cd.i]) / c[cd.i]) * 100);
      }
      for (const [key, xs] of Object.entries(byName)) {
        const s = tstat(xs);
        (res[key] ??= {})[label] = { mean: s.mean, t: s.t, n: s.n };
      }
    }
  }
  for (const [key, r] of Object.entries(res)) {
    if (!r.train || !r.test) continue;
    const survives = Math.sign(r.train.mean) === Math.sign(r.test.mean) && Math.abs(r.test.mean) > COST;
    console.log(`  ${survives ? "✅" : "  "} ${key.padEnd(18)} train ${f2(r.train.mean, 4).padStart(8)}% (t=${f2(r.train.t, 2).padStart(5)}, n=${String(r.train.n).padStart(5)})  test ${f2(r.test.mean, 4).padStart(8)}% (t=${f2(r.test.t, 2).padStart(5)}, n=${String(r.test.n).padStart(5)})`);
  }
}
