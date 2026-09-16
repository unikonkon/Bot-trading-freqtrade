/** Final prototype grid. Selection only; never changes library defaults. */
import fs from 'node:fs';
import { smcAdaptive, SMC_ADAPTIVE_DEFAULTS, type SMCAdaptiveParams } from '../../../lib/indicators';
import type { KlineData } from '../../../lib/types/kline';
import { simulateNextOpen, type Simulation } from '../engine';
const k: KlineData[] = JSON.parse(fs.readFileSync(new URL('../signal-export-BTCUSDT-1h-2026-09-16T10-00-08-170Z/input-klines.json', import.meta.url), 'utf8'));
const start = 300;
const trainEnd = start + Math.floor((k.length - start) * .6);
const valEnd = start + Math.floor((k.length - start) * .8);
const compact = (s: Simulation) => ({ return: s.returnPct, dd: s.maxDrawdownPct, n: s.totalTrades, pf: s.profitFactor });
function evaluate(p: SMCAdaptiveParams, begin: number, end: number) {
  const bars = k.slice(0, end);
  const signals = smcAdaptive(bars, p, begin).signal.map(x => x ?? 'HOLD');
  return simulateNextOpen(bars, signals, begin, .1, .05);
}
type Candidate = { p: SMCAdaptiveParams; train: ReturnType<typeof compact>; score: number };
const rows: Candidate[] = [];
for (const swingSize of [30, 50])
for (const internalSize of [5, 10, 20])
for (const stopAtr of [3, 5])
for (const rewardRisk of [3, 5])
for (const trendPeriod of [100, 200])
for (const rsiThreshold of [25, 35]) {
  const p = { ...SMC_ADAPTIVE_DEFAULTS, swingSize, internalSize, stopAtr, rewardRisk, trendPeriod, rsiThreshold };
  const train = evaluate(p, start, trainEnd);
  rows.push({ p, train: compact(train), score: train.returnPct - .5 * train.maxDrawdownPct - (train.totalTrades < 10 ? 20 : 0) });
}
rows.sort((a, b) => b.score - a.score);
const shortlist = rows.slice(0, 8).map(x => ({ ...x, validation: compact(evaluate(x.p, trainEnd, valEnd)) }));
shortlist.sort((a, b) => (b.validation.return - .5 * b.validation.dd) - (a.validation.return - .5 * a.validation.dd));
const result = {
  prototype: 'confirmed structure breakout + liquidity reclaim; close-only risk exits',
  selectionRule: 'Top 8 train return - 0.5 DD - 20 if trades < 10, then highest validation return - 0.5 DD; stable grid order breaks ties',
  trainEnd, valEnd, candidates: rows, shortlist, selected: shortlist[0].p,
};
fs.writeFileSync(new URL('./selection.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ candidates: rows.length, selected: result.selected, train: shortlist[0].train, validation: shortlist[0].validation }, null, 2));
