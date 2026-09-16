import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { smcAdaptiveV2, computeAll, SMC_ADAPTIVE_V2_DEFAULTS } from '../../../lib/indicators';
import { computeSignals, STRATEGIES, STRATEGY_FNS } from '../../../lib/backtest';
import { smcAdaptiveV2 as oldV2, computeAll as oldComputeAll } from './baseline-indicators';
import { simulateNextOpen, type Simulation } from '../engine';
import type { KlineData } from '../../../lib/types/kline';
const root = new URL('./', import.meta.url), data = new URL('data/',root);
const output = new URL('../smc-adaptive-v2-mtf-results/',root);
fs.mkdirSync(output,{recursive:true});
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json',data),'utf8'));
const selection = JSON.parse(fs.readFileSync(new URL('selection.json',root),'utf8'));
assert.deepEqual(selection.selected.params,SMC_ADAPTIVE_V2_DEFAULTS,'Freeze selected defaults before final evaluation');
const compact = (s:Simulation) => ({netPct:s.returnPct,ddPct:s.maxDrawdownPct,trades:s.totalTrades,winRate:s.winRate,profitFactor:s.profitFactor,buyHoldPct:s.buyAndHoldPct});
const results=[];
let prefixChecks=0,unchangedStrategyChecks=0;
for(const rec of manifest.records) {
  const bytes=fs.readFileSync(new URL(rec.file,data));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),rec.sha256);
  const all:KlineData[]=JSON.parse(bytes.toString()),k=all.slice(-1000);
  assert.equal(k.length,1000);
  const r=smcAdaptiveV2(k), signals=r.signal.map(s=>s??'HOLD');
  assert.deepEqual(computeSignals(k,'smc_adaptive_v2',{}, {startIndex:0}),signals,'Shared backtest path');
  const after=computeAll(k),before={...oldComputeAll(k),smcAdaptiveShort:after.smcAdaptiveShort};
  for(const strategy of STRATEGIES.filter(s=>s.id!=='smc_adaptive_v2'&&s.id!=='smc_adaptive_short')) {
    assert.deepEqual(STRATEGY_FNS[strategy.id](k,after,strategy.params),STRATEGY_FNS[strategy.id](k,before,strategy.params),`${rec.interval}: unchanged ${strategy.id}`);
    unchangedStrategyChecks++;
  }
  const net=simulateNextOpen(k,signals,0,.1,.05),gross=simulateNextOpen(k,signals,0,0,0);
  const stress=simulateNextOpen(k,signals,0,.1,.1),baseline=simulateNextOpen(k,oldV2(k).signal.map(s=>s??'HOLD'),0,.1,.05);
  const warmed=all.slice(-1500),wr=smcAdaptiveV2(warmed,{},500);
  const warmedSim=simulateNextOpen(warmed,wr.signal.map(s=>s??'HOLD'),500,.1,.05);
  // Every prefix, including each signal, verifies causal output without future bars.
  for(let end=0;end<=1000;end++) {
    const pr=smcAdaptiveV2(k.slice(0,end));
    for(const key of ['signal','reason','stop','initialRisk','regime','trendlineUpper','trendlineLower','structureTrend','adx'] as const)
      assert.deepEqual(pr[key],r[key].slice(0,end),`${rec.interval}: ${key} ${end}`);
    prefixChecks++;
  }
  const enriched=net.trades.map(t=>({...t,entryReason:r.reason[t.entryIdx-1],exitReason:t.reason==='ปิดเมื่อจบข้อมูล'?'end of sample':r.reason[t.exitIdx-1]}));
  const grouped:Record<string,{trades:number,wins:number,sumTradeNetPct:number}>={};
  for(const t of enriched) {
    const g=grouped[t.entryReason]??={trades:0,wins:0,sumTradeNetPct:0};
    g.trades++;g.wins+=Number(t.pnlPct>0);g.sumTradeNetPct+=t.pnlPct;
  }
  const atrPct=r.atr.flatMap((a,i)=>a===null?[]:[100*a/+k[i].close]).sort((a,b)=>a-b);
  const row={interval:rec.interval,from:rec.testFrom,to:rec.testTo,bars:1000,baseline:compact(baseline),updated:compact(net),grossPct:gross.returnPct,
    costDragPp:gross.returnPct-net.returnPct,stress:compact(stress),warmed:compact(warmedSim),medianAtrPct:atrPct[Math.floor(atrPct.length/2)],entryGroups:grouped,
    withoutBestTradePct:net.trades.length?100*(net.trades.map(t=>t.pnlPct).sort((a,b)=>b-a).slice(1).reduce((equity,pct)=>equity*(1+pct/100),1)-1):0};
  results.push(row);
  fs.writeFileSync(new URL(`BTCUSDT-${rec.interval}.json`,output),JSON.stringify({ ...row,params:SMC_ADAPTIVE_V2_DEFAULTS,trades:enriched,
    baselineTrades:baseline.trades,signals:k.map((b,i)=>({time:b.openTime,close:b.close,signal:signals[i],reason:r.reason[i],regime:r.regime[i],stop:r.stop[i],initialRisk:r.initialRisk[i]}))},null,2)+'\n');
  console.log(`${rec.interval}: ${baseline.totalTrades} -> ${net.totalTrades} trades; net ${net.returnPct.toFixed(4)}%, gross ${gross.returnPct.toFixed(4)}%, DD ${net.maxDrawdownPct.toFixed(4)}%`);
}
const sourceFiles=['lib/indicators.ts','lib/backtest.ts','signal-bot/web ui/engine.ts','signal-bot/web ui/research-mtf/select.ts','signal-bot/web ui/research-mtf/analyze.ts'];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(new URL('../../../'+file,root))).digest('hex')]));
fs.writeFileSync(new URL('analysis.json',output),JSON.stringify({createdAt:new Date().toISOString(),manifest,selectionMethod:selection.method,params:SMC_ADAPTIVE_V2_DEFAULTS,sourceHashes,prefixChecks,unchangedStrategyChecks,results},null,2)+'\n');
console.log(`Causal prefix checks passed: ${prefixChecks}`);
