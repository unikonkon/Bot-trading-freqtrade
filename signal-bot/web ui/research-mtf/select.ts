import fs from 'node:fs';
import crypto from 'node:crypto';
import { smcAdaptiveV2, SMC_ADAPTIVE_V2_DEFAULTS, type SMCAdaptiveV2Params } from '../../../lib/indicators';
import { smcAdaptiveV2 as oldV2 } from './baseline-indicators';
import { simulateNextOpen } from '../engine';
import type { KlineData } from '../../../lib/types/kline';
const root = new URL('./', import.meta.url), data = new URL('data/',root);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', data),'utf8'));
const samples: {interval:string,split:string,k:KlineData[],oldTrades:number}[] = [];
for (const rec of manifest.records) {
  const bytes = fs.readFileSync(new URL(rec.file,data));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== rec.sha256) throw Error('Input checksum mismatch');
  const all:KlineData[] = JSON.parse(bytes.toString());
  for (const [split,start] of [['train',300],['validation',1300]] as const) {
    // The final 1,000 bars are deliberately never passed to the selector.
    const k = all.slice(start,start+1000);
    samples.push({interval:rec.interval,split,k,oldTrades:simulateNextOpen(k,oldV2(k).signal.map(x=>x??'HOLD'),0,.1,.05).totalTrades});
  }
}
const profiles = [
  {internalSize:7,trendLength:10,fastPeriod:21,trendPeriod:100,trendSlopeBars:6},
  {internalSize:10,trendLength:14,fastPeriod:21,trendPeriod:100,trendSlopeBars:6},
  {internalSize:10,trendLength:14,fastPeriod:34,trendPeriod:144,trendSlopeBars:6},
  {internalSize:20,trendLength:14,fastPeriod:50,trendPeriod:200,trendSlopeBars:6},
];
type Candidate = {params:SMCAdaptiveV2Params,score:number,positive:number,results:{interval:string,split:string,oldTrades:number,trades:number,net:number,dd:number}[]};
const candidates:Candidate[] = [];
for (const profile of profiles) for (const adxThreshold of [15,25])
  for (const trailAtr of [4,6]) for (const minStopPct of [.35,.6]) {
    const params:SMCAdaptiveV2Params = {...SMC_ADAPTIVE_V2_DEFAULTS,...profile,adxThreshold,trailAtr,minStopPct};
    const results = samples.map(({interval,split,k,oldTrades})=>{
      const s = simulateNextOpen(k,smcAdaptiveV2(k,params).signal.map(x=>x??'HOLD'),0,.1,.05);
      return {interval,split,oldTrades,trades:s.totalTrades,net:s.returnPct,dd:s.maxDrawdownPct};
    });
    // Predeclared score: risk-adjusted net return, penalize underactivity vs old V2.
    // Every timeframe/split gets equal weight. Zero trades cannot win via zero DD.
    const score = results.reduce((sum,r)=>sum + r.net - .25*r.dd -
      .5*Math.max(0,Math.max(3,r.oldTrades+1)-r.trades),0)/results.length;
    candidates.push({params,score,positive:results.filter(r=>r.net>0).length,results});
  }
// Faster profiles in phase 1 lost to fees/chop. Test 32 slower profiles using
// the same objective, then select across all 68; retain every attempted result.
const phase1=JSON.parse(fs.readFileSync(new URL('phase-1.json',root),'utf8'));
candidates.push(...phase1.candidates);
candidates.sort((a,b)=>b.score-a.score);
const eligible=candidates.filter(c=>manifest.records.every((rec:{interval:string})=>{
  const rows=c.results.filter(r=>r.interval===rec.interval);
  return rows.reduce((sum,r)=>sum+r.trades,0)>=Math.max(4,1+rows.reduce((sum,r)=>sum+r.oldTrades,0));
}));
if(!eligible.length) throw Error('No candidate met activity requirement');
const output={createdAt:new Date().toISOString(),method:'68 global candidates (36 faster + 32 slower); equal-weight train/validation net - 0.25*DD - 0.5*trade shortfall below max(3, old+1). Added activity eligibility before opening final test: pooled train/validation trades >= max(4, old+1) in every timeframe. Final 1000 bars excluded. Phase 2 motivated by phase 1 fee/chop losses; validation participates in selection and is not held out.',
  sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL('../../../lib/indicators.ts',root))).digest('hex'),
  eligibleCandidates:eligible.length,selected:eligible[0],unconstrainedBest:candidates[0],candidates};
fs.writeFileSync(new URL('selection.json',root),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output.selected,null,2));
console.table(candidates.slice(0,8).map(c=>({score:c.score,positive:c.positive,fast:c.params.fastPeriod,adx:c.params.adxThreshold,trail:c.params.trailAtr,floor:c.params.minStopPct})));
