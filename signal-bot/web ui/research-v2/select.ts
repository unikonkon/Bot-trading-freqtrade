import fs from 'node:fs';
import { smcAdaptiveV2, SMC_ADAPTIVE_V2_DEFAULTS, type SMCAdaptiveV2Params } from '../../../lib/indicators';
import { simulateNextOpen, type Simulation } from '../engine';
import type { KlineData } from '../../../lib/types/kline';
const k: KlineData[] = JSON.parse(fs.readFileSync(new URL('../../signal-export-BTCUSDT-1h-2026-09-16T10-36-11-055Z/input-klines.json', import.meta.url), 'utf8'));
const start = 1000, trainEnd = start + Math.floor((k.length-start)*.6), valEnd = start + Math.floor((k.length-start)*.8);
const compact = (r: Simulation) => ({ return: r.returnPct, dd: r.maxDrawdownPct, trades: r.totalTrades, pf: r.profitFactor });
function evaluate(p: SMCAdaptiveV2Params, begin: number, end: number) {
 const bars = k.slice(0,end);
 return simulateNextOpen(bars, smcAdaptiveV2(bars,p,begin).signal.map(s=>s??'HOLD'),begin,.1,.05);
}
const rows: {p: SMCAdaptiveV2Params; train: ReturnType<typeof compact>; score: number}[]=[];
for(const internalSize of [10,20]) for(const trendLength of [14,28]) for(const adxThreshold of [15,25])
for(const trailAtr of [2,4]) for(const maxExtensionAtr of [2,4]) for(const confluenceBars of [6,24]) {
 const p={...SMC_ADAPTIVE_V2_DEFAULTS,internalSize,trendLength,adxThreshold,trailAtr,maxExtensionAtr,confluenceBars};
 const train=compact(evaluate(p,start,trainEnd));
 rows.push({p,train,score:train.return-.5*train.dd-Math.max(0,12-train.trades)});
}
rows.sort((a,b)=>b.score-a.score);
const shortlist=rows.slice(0,8).map(r=>({...r,validation:compact(evaluate(r.p,trainEnd,valEnd))}));
shortlist.sort((a,b)=>(b.validation.return-.5*b.validation.dd)-(a.validation.return-.5*a.validation.dd));
const result={trainEnd,valEnd,candidates:rows,shortlist,selected:shortlist[0].p};
fs.writeFileSync(new URL('./selection.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({trainEnd,valEnd,count:rows.length,shortlist:shortlist.slice(0,3)},null,2));
