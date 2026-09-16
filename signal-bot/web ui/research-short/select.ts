import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { smcAdaptiveShort, SMC_ADAPTIVE_SHORT_DEFAULTS, type SMCAdaptiveShortParams } from '../../../lib/indicators';
import type { KlineData } from '../../../lib/types/kline';
import { simulateNextOpen } from '../engine';
const root=new URL('./',import.meta.url),data=new URL('data/',root);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',data),'utf8'));
const samples:{interval:string,split:string,k:KlineData[]}[]=[];
for(const rec of manifest.records) {
  const bytes=fs.readFileSync(new URL(rec.file,data));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),rec.sha256);
  const {development}:{development:KlineData[]}=JSON.parse(bytes.toString());
  assert.ok(development.every(b=>b.closeTime<Date.parse(manifest.developmentCutoff)));
  for(const [split,start] of [['train',300],['validation',1300]] as const)
    samples.push({interval:rec.interval,split,k:development.slice(start,start+1000)});
}
const candidates=[];
for(const internalSize of [5,8]) for(const targetAtr of [6,10,14])
for(const stopAtr of [1.2,1.8]) for(const maxHoldBars of [24,48]) {
  const params:SMCAdaptiveShortParams={...SMC_ADAPTIVE_SHORT_DEFAULTS,internalSize,targetAtr,stopAtr,maxHoldBars};
  const results=samples.map(({interval,split,k})=>{
    const s=simulateNextOpen(k,smcAdaptiveShort(k,params).signal.map(x=>x??'HOLD'),0,.1,.05);
    return {interval,split,trades:s.totalTrades,net:s.returnPct,dd:s.maxDrawdownPct};
  });
  const score=results.reduce((sum,r)=>sum+r.net-.5*r.dd,0)/results.length;
  candidates.push({params,score,results});
}
candidates.sort((a,b)=>b.score-a.score);
const eligible=candidates.filter(c=>c.results.reduce((n,r)=>n+r.trades,0)>=4&&new Set(c.results.filter(r=>r.trades>0).map(r=>r.interval)).size>=2);
assert.ok(eligible.length,'No candidate with at least 4 development trades in >= 2 timeframes');
const output={createdAt:new Date().toISOString(),method:'24 shared candidates; mean(net - 0.5*DD) over 4 timeframes x 2 prior 1000-bar development windows. Eligibility: >=4 trades total across >=2 timeframes. All development ends before earliest final test. Validation participates in selection, not independent OOS.',
  sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL('../../../lib/indicators.ts',root))).digest('hex'),selected:eligible[0],candidates};
fs.writeFileSync(new URL('selection.json',root),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output.selected,null,2));
