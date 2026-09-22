/** แยกดูว่าความได้เปรียบ (ก่อนหักต้นทุน) ซ่อนอยู่ในกลุ่มย่อยไหนบ้าง — เฉพาะช่วง train */
import { load, split, TFS, run, tstat, f2 } from "./lib";
import { shortTradeV3 } from "../../../lib/indicators-v3-ShortTrade";

const groups: Record<string, Record<string, number[]>> = {};
const add = (dim: string, key: string, v: number) => {
  (groups[dim] ??= {})[key] ??= [];
  groups[dim][key].push(v);
};

for (const tf of TFS) {
  const all = load(tf);
  const { train } = split(all);
  const r = shortTradeV3(train.k, {}, train.start);
  const gross = run(train.k, r.exposure, train.start, 0, 0, 0);
  for (const t of gross.trades) {
    // ตัดสินใจที่แท่งก่อนเข้า (next-open fill) จึงอ่านคุณลักษณะจากแท่งนั้น
    const d = t.entryIdx - 1;
    const p = t.pnlPct;
    add("tf", tf, p);
    add(`setup:${tf}`, r.setup[d] ?? "?", p);
    add(`side:${tf}`, t.direction ?? "?", p);
    add(`regime:${tf}`, r.regime[d], p);
    add(`hour:${tf}`, String(Math.floor((r.utcHour[d] ?? 0) / 4) * 4).padStart(2, "0"), p);
    const adx = r.adx[d] ?? 0;
    add(`adx:${tf}`, adx < 15 ? "<15" : adx < 25 ? "15-25" : adx < 35 ? "25-35" : ">=35", p);
    const conf = r.confidence[d] ?? 0;
    add(`conf:${tf}`, conf < 0.4 ? "<.40" : conf < 0.5 ? ".40-.50" : conf < 0.6 ? ".50-.60" : ">=.60", p);
    const rr = r.netRewardRisk[d] ?? 0;
    add(`netRR:${tf}`, rr < 1 ? "<1" : rr < 2 ? "1-2" : rr < 4 ? "2-4" : ">=4", p);
    add(`bars:${tf}`, t.bars <= 3 ? "1-3" : t.bars <= 8 ? "4-8" : t.bars <= 20 ? "9-20" : ">20", p);
    const vr = r.volumeRatio[d] ?? 0;
    add(`vol:${tf}`, vr < 1 ? "<1" : vr < 1.5 ? "1-1.5" : ">=1.5", p);
  }
}
const out: string[] = [];
for (const [dim, buckets] of Object.entries(groups)) {
  const rows = Object.entries(buckets).map(([key, xs]) => ({ key, ...tstat(xs) }))
    .filter(x => x.n >= 15).sort((a, b) => b.mean - a.mean);
  if (!rows.length) continue;
  out.push(`\n=== ${dim} ===`);
  for (const x of rows) out.push(`  ${x.key.padEnd(10)} n=${String(x.n).padStart(4)}  mean=${f2(x.mean, 4).padStart(9)}%  t=${f2(x.t, 2).padStart(6)}`);
}
console.log(out.join("\n"));
