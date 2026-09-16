import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { smcAdaptiveShort, SMC_ADAPTIVE_SHORT_DEFAULTS as defaults } from '../../lib/indicators';
import { parseKline, type KlineData } from '../../lib/types/kline';
import { computeSignals, STRATEGIES } from '../../lib/backtest';
import { simulateNextOpen, analyze } from './engine';
import { calculateExport } from './export-calculations';
import { validate, loadData } from './data';
const fixture:KlineData[]=JSON.parse(fs.readFileSync(new URL('../../freqtrade/fixtures/BTCUSDT-1h.json',import.meta.url),'utf8')).map(parseKline);

test('Short trade is a separate spot strategy; all entries have positive cost-adjusted target room',()=>{
  const r=smcAdaptiveShort(fixture);let held=false,lastStop=0,count=0;
  assert.equal(STRATEGIES.find(s=>s.id==='smc_adaptive_short')!.name,'SMC Adaptive Short trade');
  assert.ok(STRATEGIES.some(s=>s.id==='smc_adaptive_v2'));
  for(let i=0;i<fixture.length;i++){
    if(r.signal[i]==='BUY'){
      assert.equal(held,false);held=true;count++;
      const c=+fixture[i].close,cost=c*defaults.costPct/100,reward=r.target[i]!-c,risk=c-r.stop[i]!;
      assert.ok((reward-cost)/(risk+cost)>=defaults.minNetRewardRisk-1e-9);
      assert.ok(100*(reward-cost)/c>=defaults.minNetProfitPct-1e-9);
      assert.ok(reward<=defaults.targetAtr*r.atr[i]!+1e-8);
      assert.ok(r.stop[i]!<c&&r.target[i]!>c&&r.initialRisk[i]!>0);
      assert.notEqual(r.regime[i],'shock');assert.notEqual(r.regime[i],'downtrend');
      assert.ok(r.reason[i].startsWith('SMC liquidity sweep')||r.reason[i].startsWith('SMC bullish break'));
      lastStop=r.stop[i]!;
    }else if(held){assert.ok(r.stop[i]!>=lastStop);lastStop=r.stop[i]!;}
    if(r.signal[i]==='SELL'){assert.equal(held,true);held=false;}
  }
  assert.ok(count>0);
});

test('Short trade uses confirmed information; future OHLCV changes cannot change past signals or levels',()=>{
  const r=smcAdaptiveShort(fixture);
  const changed=fixture.map((b,i)=>i<500?b:{...b,open:String(+b.open*4),high:String(+b.high*5),low:String(+b.low*3),close:String(+b.close*4),volume:String(+b.volume*10)});
  const altered=smcAdaptiveShort(changed);
  for(const key of ['signal','reason','stop','target','support','resistance','volumeRatio','netRewardRisk'] as const){
    assert.deepEqual(altered[key].slice(0,500),r[key].slice(0,500));
    assert.deepEqual(smcAdaptiveShort(fixture.slice(0,500))[key],r[key].slice(0,500));
  }
  const i=100,prior=fixture.slice(i-defaults.volumePeriod,i).reduce((n,b)=>n+(+b.volume),0)/defaults.volumePeriod;
  assert.ok(Math.abs(r.volumeRatio[i]!-(+fixture[i].volume)/prior)<1e-10);
});

test('Short trade rejects target room below costs without inventing a wider target',()=>{
  const tiny=fixture.map(b=>({...b,...Object.fromEntries(['open','high','low','close'].map(key=>
    [key,String(100+(+b[key as keyof KlineData]-100000)*.000001)]))}));
  const r=smcAdaptiveShort(tiny);
  assert.ok(r.reason.some(x=>x==='target room insufficient after estimated costs'));
  assert.ok(r.signal.every(x=>x===null));
});

test('Short trade waits after shocks and has a bounded holding period',()=>{
  const r=smcAdaptiveShort(fixture),buy=r.signal.indexOf('BUY');assert.ok(buy>0&&buy+5<fixture.length);
  const shock=fixture.map(b=>({...b}));shock[buy].high=String(+shock[buy].high*2);
  const sh=smcAdaptiveShort(shock);
  assert.ok(sh.signal.slice(buy,buy+defaults.shockBars+1).every(s=>s!=='BUY'));
  const k=fixture.slice(0,buy+5).map(b=>({...b})),c=+k[buy].close;
  for(let i=buy+1;i<k.length;i++)Object.assign(k[i],{open:String(c),close:String(c),high:String(c*1.00001),low:String(c*.99999)});
  const limited=smcAdaptiveShort(k,{maxHoldBars:2});
  assert.equal(limited.signal[buy],'BUY');assert.equal(limited.signal[buy+2],'SELL');
  assert.equal(limited.reason[buy+2],'short-duration time exit');
  const sim=simulateNextOpen(k,limited.signal.map(x=>x??'HOLD'),0,.1,.05);
  assert.equal(sim.trades[0].bars,2);
});

test('Short trade close stops do not fill on wick touches and bear adverse next-open gaps',()=>{
  const r=smcAdaptiveShort(fixture),buy=r.signal.indexOf('BUY');assert.ok(buy>0&&buy+3<fixture.length);
  const k=fixture.slice(0,buy+4).map(b=>({...b})),stop=r.stop[buy]!;
  k[buy+1].open=k[buy].close;k[buy+1].close=k[buy].close;
  k[buy+1].low=String(stop*.8);k[buy+1].high=String(+k[buy].close*1.0001);
  assert.notEqual(smcAdaptiveShort(k.slice(0,buy+2)).signal[buy+1],'SELL');
  k[buy+2].open=k[buy].close;k[buy+2].close=String(stop*.9);k[buy+2].low=String(stop*.89);k[buy+2].high=k[buy].close;
  k[buy+3].open=String(stop*.7);k[buy+3].low=String(stop*.69);
  const s=smcAdaptiveShort(k);assert.equal(s.signal[buy+2],'SELL');
  const sim=simulateNextOpen(k,s.signal.map(x=>x??'HOLD'),0,.1,.05);
  assert.equal(sim.trades.at(-1)!.exitPrice,stop*.7*.9995);
});

test('Short trade starts flat after warmup and agrees with signal, web and export paths',()=>{
  const full=smcAdaptiveShort(fixture),start=full.position.findIndex((v,i)=>i>100&&v&&full.signal[i]!=='BUY');assert.ok(start>100);
  const r=smcAdaptiveShort(fixture,{},start),p={...defaults};
  assert.ok(r.signal.slice(0,start).every(x=>x===null));assert.ok(r.position.slice(0,start).every(x=>!x));
  assert.equal(r.signal.slice(start).find(x=>x!==null),'BUY');
  const a=analyze(fixture,start,'smc_adaptive_short',p,.1,.05,'both',true),e=calculateExport(fixture,start,'smc_adaptive_short',p,.1,.05,'both');
  assert.deepEqual(a.signals,computeSignals(fixture,'smc_adaptive_short',p,{startIndex:start}).slice(start));
  assert.deepEqual(e.records.map(x=>x.reason),r.reason.slice(start));assert.deepEqual(e.simulations,a.simulations);
});

test('Short trade validates parameters, empty/flat input and cannot disable confirmed pivots',()=>{
  assert.deepEqual(smcAdaptiveShort([]).signal,[]);
  const flat=fixture.map(b=>({...b,open:'100',high:'100',low:'100',close:'100',volume:'0'}));
  assert.ok(smcAdaptiveShort(flat).signal.every(x=>x===null));
  for(const p of [{internalSize:20},{fastPeriod:55},{adxThreshold:101},{rsiThreshold:100},{volumePeriod:2.2},{costPct:NaN},{stopAtr:0}])
    assert.throws(()=>smcAdaptiveShort(fixture,p));
  assert.throws(()=>smcAdaptiveShort(fixture,{},-1));
  assert.deepEqual(computeSignals(fixture,'smc_adaptive_short',{}, {confirmedPivots:false}),computeSignals(fixture,'smc_adaptive_short'));
  const request={symbol:'BTCUSDT',interval:'1m',source:'latest',mode:'next_open',strategy:'smc_adaptive_short',selected:'smc_adaptive_short',fee:.1,slippage:.05};
  assert.equal(validate(request).params.smc_adaptive_short.targetAtr,defaults.targetAtr);
  assert.throws(()=>validate({...request,params:{smc_adaptive_short:{fastPeriod:55}}}));
});

test('Short trade warns when configured cost allowance understates the simulation costs',async()=>{
  const request={symbol:'BTCUSDT',interval:'1m',source:'latest',limit:300,mode:'next_open',strategy:'smc_adaptive_short',selected:'smc_adaptive_short',fee:.2,slippage:.2};
  const cfg=validate(request),r=await loadData(cfg,async()=>fixture.slice(0,300));
  assert.ok(r.warnings.some(w=>w.includes('costPct')&&w.includes('0.803%')));
});
