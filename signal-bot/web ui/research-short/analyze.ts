import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { smcAdaptiveShort, smcAdaptiveV2, computeAll, SMC_ADAPTIVE_SHORT_DEFAULTS } from '../../../lib/indicators';
import { computeAll as baselineAll } from './baseline-indicators';
import { computeSignals, STRATEGIES, STRATEGY_FNS } from '../../../lib/backtest';
import type { KlineData } from '../../../lib/types/kline';
import { simulateNextOpen, type Simulation } from '../engine';
import { calculateExport } from '../export-calculations';
const root=new URL('./',import.meta.url),data=new URL('data/',root),out=new URL('../smc-adaptive-short-results/',root);
fs.mkdirSync(out,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',data),'utf8'));
const selection=JSON.parse(fs.readFileSync(new URL('selection.json',root),'utf8'));
assert.deepEqual(selection.selected.params,SMC_ADAPTIVE_SHORT_DEFAULTS,'Freeze defaults before testing');
const compact=(s:Simulation)=>({netPct:s.returnPct,trades:s.totalTrades,ddPct:s.maxDrawdownPct,winRate:s.winRate,profitFactor:s.profitFactor,
  avgBars:s.trades.length?s.trades.reduce((n,t)=>n+t.bars,0)/s.trades.length:0,buyHoldPct:s.buyAndHoldPct});
let prefixChecks=0,unchangedStrategyChecks=0;
const results=[];
for(const rec of manifest.records){
  const bytes=fs.readFileSync(new URL(rec.file,data));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),rec.sha256);
  const {test:k,development}:{test:KlineData[],development:KlineData[]}=JSON.parse(bytes.toString());
  assert.equal(k.length,1000);assert.ok(development.at(-1)!.closeTime<Date.parse(manifest.developmentCutoff));
  const r=smcAdaptiveShort(k),s=r.signal.map(x=>x??'HOLD');
  assert.deepEqual(s,computeSignals(k,'smc_adaptive_short'));
  const after=computeAll(k),before={...baselineAll(k),smcAdaptiveShort:after.smcAdaptiveShort};
  for(const strategy of STRATEGIES.filter(s=>s.id!=='smc_adaptive_short')){
    assert.deepEqual(STRATEGY_FNS[strategy.id](k,after,strategy.params),STRATEGY_FNS[strategy.id](k,before,strategy.params),strategy.id);
    unchangedStrategyChecks++;
  }
  const net=simulateNextOpen(k,s,0,.1,.05),gross=simulateNextOpen(k,s,0,0,0),stress=simulateNextOpen(k,s,0,.1,.1);
  const v2=simulateNextOpen(k,smcAdaptiveV2(k).signal.map(x=>x??'HOLD'),0,.1,.05);
  const exported=calculateExport(k,0,'smc_adaptive_short',SMC_ADAPTIVE_SHORT_DEFAULTS,.1,.05,'next_open');
  assert.deepEqual(exported.records.map(x=>x.signal),s);assert.deepEqual(exported.records.map(x=>x.reason),r.reason);
  assert.deepEqual(exported.simulations[0],net);
  for(let end=0;end<=k.length;end++){
    const pr=smcAdaptiveShort(k.slice(0,end));
    for(const key of ['signal','reason','regime','stop','target','initialRisk','support','resistance','netRewardRisk','volumeRatio'] as const)
      assert.deepEqual(pr[key],r[key].slice(0,end),`${rec.interval} ${key} ${end}`);
    prefixChecks++;
  }
  const reasons:Record<string,number>={};for(const why of r.reason)reasons[why]=(reasons[why]??0)+1;
  const trades=net.trades.map(t=>({...t,entryReason:r.reason[t.entryIdx-1],exitReason:t.reason==='ปิดเมื่อจบข้อมูล'?'end of sample':r.reason[t.exitIdx-1]}));
  const row={interval:rec.interval,from:rec.testFrom,to:rec.testTo,bars:1000,updated:compact(net),v2:compact(v2),grossPct:gross.returnPct,
    stress:compact(stress),costDragPp:gross.returnPct-net.returnPct,reasons};results.push(row);
  fs.writeFileSync(new URL(`BTCUSDT-${rec.interval}.json`,out),JSON.stringify({...row,params:SMC_ADAPTIVE_SHORT_DEFAULTS,trades,records:exported.records},null,2)+'\n');
  console.log(`${rec.interval}: ${net.totalTrades} trades, net ${net.returnPct.toFixed(4)}%, gross ${gross.returnPct.toFixed(4)}%, DD ${net.maxDrawdownPct.toFixed(4)}%, avg ${compact(net).avgBars.toFixed(1)} bars; V2 ${v2.returnPct.toFixed(4)}%`);
}
const sourceFiles=['lib/indicators.ts','lib/backtest.ts','signal-bot/web ui/engine.ts','signal-bot/web ui/export-calculations.ts','signal-bot/web ui/research-short/select.ts','signal-bot/web ui/research-short/analyze.ts'];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(new URL('../../../'+file,root))).digest('hex')]));
fs.writeFileSync(new URL('analysis.json',out),JSON.stringify({createdAt:new Date().toISOString(),manifest,params:SMC_ADAPTIVE_SHORT_DEFAULTS,selectionMethod:selection.method,prefixChecks,unchangedStrategyChecks,sourceHashes,results},null,2)+'\n');
console.log(`Passed ${prefixChecks} prefix checks, ${unchangedStrategyChecks} unchanged-strategy checks`);
