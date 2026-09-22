/** สแกนพารามิเตอร์ที่มีอยู่แล้วบนช่วง train เพื่อดูว่าการปรับค่าอย่างเดียวพอให้เป็นบวกไหม */
import { load, split, run, f2, tstat } from "./lib";
import { shortTradeV3 } from "../../../lib/indicators-v3-ShortTrade";

const TF = (process.argv[2] ?? "30m");
const all = load(TF);
const { train } = split(all);
const bars = train.k.length - train.start;

const grid = {
  stopAtr: [1.2, 2, 3, 4],
  minNetRewardRisk: [0.4, 0.75, 1.2],
  targetReachRatio: [0.3, 0.5, 0.9],
  sessionMode: [0, 1, 2],
  minVolumeRatio: [0, 0.7, 1.2],
};
type Combo = Record<string, number>;
const combos: Combo[] = [{}];
for (const [key, values] of Object.entries(grid)) {
  const next: Combo[] = [];
  for (const base of combos) for (const v of values) next.push({ ...base, [key]: v });
  combos.length = 0; combos.push(...next);
}
const rows: any[] = [];
for (const p of combos) {
  const exp = shortTradeV3(train.k, p, train.start).exposure;
  const net = run(train.k, exp, train.start, 0.1, 0.05, 0.01);
  if (net.totalTrades < 30) continue;
  const gross = run(train.k, exp, train.start, 0, 0, 0);
  const g = tstat(gross.trades.map(t => t.pnlPct));
  rows.push({ p, trades: net.totalTrades, perK: (net.totalTrades / bars) * 1000,
    net: net.returnPct, gross: gross.returnPct, grossMean: g.mean, t: g.t,
    pf: net.profitFactor ?? 99, win: net.winRate });
}
rows.sort((a, b) => b.net - a.net);
console.log(`${TF} train: ${bars} bars, ${rows.length} combos with >=30 trades`);
console.log("top 12 by net:");
for (const r of rows.slice(0, 12))
  console.log(`  net ${f2(r.net).padStart(7)}%  gross ${f2(r.gross).padStart(7)}%  t=${f2(r.t, 2).padStart(5)}  n=${String(r.trades).padStart(4)} (${f2(r.perK, 1)}/k)  win ${f2(r.win, 0)}%  ${JSON.stringify(r.p)}`);
const byT = [...rows].sort((a, b) => b.t - a.t);
console.log("top 6 by gross t-stat:");
for (const r of byT.slice(0, 6))
  console.log(`  t=${f2(r.t, 2).padStart(5)}  grossMean ${f2(r.grossMean, 4)}%  net ${f2(r.net).padStart(7)}%  n=${r.trades}  ${JSON.stringify(r.p)}`);
console.log(`positive-net combos: ${rows.filter(r => r.net > 0).length} / ${rows.length}`);
