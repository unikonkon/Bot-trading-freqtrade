import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { directionalMovement, smcAdaptiveV2, SMC_ADAPTIVE_V2_DEFAULTS, trendlinesWithBreaks } from '../../lib/indicators';
import { parseKline, type KlineData } from '../../lib/types/kline';
import { computeSignals, computeStrategyIndicators } from '../../lib/backtest';
import { calculateExport } from './export-calculations';
import { analyze, simulateNextOpen } from './engine';
import { validate, warmupBars } from './data';
const fixture: KlineData[] = JSON.parse(fs.readFileSync(new URL('../../freqtrade/fixtures/BTCUSDT-1h.json', import.meta.url), 'utf8')).map(parseKline);
function prices(values: number[]): KlineData[] {
  return values.map((p,i)=>parseKline([i*3600000,String(p),String(p+1),String(p-1),String(p),'100',(i+1)*3600000-1,'1000',10,'50','500']));
}

test('Wilder ADX: warmup, monotonic up/down, flat and equal directional moves',()=>{
  for(const sign of [1,-1]) {
    const dm=directionalMovement(prices(Array.from({length:40},(_,i)=>100+sign*i)),3);
    assert.deepEqual(dm.adx.slice(0,5),[null,null,null,null,null]);
    assert.equal(dm.adx[5],100); assert.equal(dm.adx[39],100);
    assert.ok((sign===1?dm.plusDI:dm.minusDI).slice(3).every(v=>v===50));
    assert.ok((sign===1?dm.minusDI:dm.plusDI).slice(3).every(v=>v===0));
  }
  const flat=directionalMovement(prices(new Array(40).fill(100)),3);
  assert.ok(flat.adx.slice(5).every(v=>v===0));
  const outside=prices(new Array(40).fill(100)).map((b,i)=>({...b,high:String(101+i),low:String(99-i)}));
  const ties=directionalMovement(outside,3);
  assert.ok(ties.plusDI.slice(3).every(v=>v===0)); assert.ok(ties.minusDI.slice(3).every(v=>v===0));
  assert.throws(()=>directionalMovement([],0));
  const mixed=directionalMovement(prices([100,102,101,104,103,105]),2);
  assert.ok(Math.abs(mixed.plusDI[2]!-40)<1e-10);
  assert.ok(Math.abs(mixed.minusDI[2]!-20)<1e-10);
  assert.ok(Math.abs(mixed.adx[3]!-55.55555555555556)<1e-10);
  assert.ok(Math.abs(mixed.adx[4]!-39.31623931623932)<1e-10);
});

test('V2 every prefix preserves signals, confirmed lines, ADX and risk state',()=>{
  const full=smcAdaptiveV2(fixture);
  for(let end=0;end<=fixture.length;end++) {
    const prefix=smcAdaptiveV2(fixture.slice(0,end));
    for(const key of ['signal','reason','stop','initialRisk','regime','adx','plusDI','minusDI','trendlineUpper','trendlineLower','structureTrend'] as const)
      assert.deepEqual(prefix[key],full[key].slice(0,end),`${key}: ${end}`);
  }
});

test('V2 future candles cannot affect earlier output; initial zero trendline is unavailable',()=>{
  const full=smcAdaptiveV2(fixture);
  const modified=fixture.map((b,i)=>i<500?b:{...b,open:String(+b.open*10),high:String(+b.high*10),low:String(+b.low*10),close:String(+b.close*10)});
  const altered=smcAdaptiveV2(modified);
  assert.deepEqual(altered.signal.slice(0,500),full.signal.slice(0,500));
  assert.deepEqual(altered.stop.slice(0,500),full.stop.slice(0,500));
  const mono=prices(Array.from({length:300},(_,i)=>100+i));
  assert.ok(trendlinesWithBreaks(mono).breakUp.some(Boolean));
  assert.ok(smcAdaptiveV2(mono).trendlineUpper.every(v=>v===null));
  assert.ok(smcAdaptiveV2(mono).signal.every(v=>v===null));
});

test('V2 entries keep confirmed SMC/Trendlines and trend filters; stop never widens',()=>{
  const r=smcAdaptiveV2(fixture),p=SMC_ADAPTIVE_V2_DEFAULTS;
  const tl=trendlinesWithBreaks(fixture,p.trendLength,p.trendMult,'Atr',true);
  let held=false,stop=-Infinity,count=0;
  for(let i=0;i<fixture.length;i++) {
    if(r.signal[i]==='BUY') {
      assert.equal(held,false);held=true;count++;stop=r.stop[i]!;
      assert.equal(r.structureTrend[i],'bullish');
      if(r.reason[i].startsWith('Trendlines breakout'))
        assert.ok(tl.breakUp.slice(Math.max(0,i-p.confluenceBars),i+1).some(Boolean));
      else if(r.reason[i].startsWith('SMC structure breakout'))
        assert.ok(r.structures.some(e=>e.index===i&&e.bias==='bullish'));
      else {
        assert.ok(r.reason[i].startsWith('EMA pullback reclaim'));
        assert.ok(+fixture[i-1].close<=r.fastEMA[i-1]! && +fixture[i].close>r.fastEMA[i]!);
      }
      assert.ok(r.trendlineUpper[i]!==null && +fixture[i].close>r.trendlineUpper[i]!);
      assert.ok(r.adx[i]!>=p.adxThreshold && r.plusDI[i]!>r.minusDI[i]!);
      assert.ok(r.trendEMA[i]!>r.trendEMA[i-p.trendSlopeBars]!);
      assert.ok(r.initialRisk[i]!>=+fixture[i].close*p.minStopPct/100);
      assert.ok(r.stop[i]!<+fixture[i].close && r.initialRisk[i]!>0);
    } else if(held) {assert.ok(r.stop[i]!>=stop);stop=r.stop[i]!;}
    if(r.signal[i]==='SELL') {assert.ok(held);held=false;}
    if(r.regime[i]==='shock') assert.notEqual(r.signal[i],'BUY');
  }
  assert.ok(count>0);
});

test('V2 warmup resets positions and all signal, export and simulation paths agree',()=>{
  const p={...SMC_ADAPTIVE_V2_DEFAULTS,confluenceBars:24,maxExtensionAtr:4};
  const full=smcAdaptiveV2(fixture,p);
  const start=full.position.findIndex((v,i)=>i>300&&v&&full.signal[i]!=='BUY');
  assert.ok(start>300);
  const r=smcAdaptiveV2(fixture,p,start);
  assert.ok(r.signal.slice(0,start).every(x=>x===null));
  assert.ok(r.position.slice(0,start).every(x=>!x));
  const first=r.signal.slice(start).find(x=>x!==null);
  assert.ok(first===undefined||first==='BUY');
  const a=analyze(fixture,start,'smc_adaptive_v2',p,.1,.05,'both',true);
  const e=calculateExport(fixture,start,'smc_adaptive_v2',p,.1,.05,'both');
  assert.deepEqual(a.signals,computeSignals(fixture,'smc_adaptive_v2',p,{startIndex:start}).slice(start));
  assert.deepEqual(e.records.map(x=>x.signal),a.signals);
  assert.deepEqual(e.simulations,a.simulations);
  assert.deepEqual(e.records.map(x=>x.reason),r.reason.slice(start));
  assert.notDeepEqual(computeStrategyIndicators(fixture,'smc_adaptive_v2',{adxPeriod:3}).smcAdaptiveV2.adx,full.adx);
});

test('V2 closed-price stop bears adverse next-open gaps and never fills at a touched level',()=>{
  const r=smcAdaptiveV2(fixture),buy=r.signal.indexOf('BUY');
  assert.ok(buy>0 && buy+3<fixture.length);
  const k=fixture.slice(0,buy+4).map(b=>({...b})),stop=r.stop[buy]!;
  k[buy+1].low=String(stop*.8);k[buy+1].close=k[buy].close;
  k[buy+1].high=String(Math.max(+k[buy+1].open,+k[buy+1].close)*1.01);
  assert.notEqual(smcAdaptiveV2(k.slice(0,buy+2)).signal[buy+1],'SELL');
  k[buy+2].close=String(stop*.9);k[buy+2].low=String(stop*.89);
  k[buy+2].high=String(Math.max(+k[buy+2].open,+k[buy+2].close)*1.01);
  k[buy+3].open=String(stop*.7);k[buy+3].low=String(stop*.69);
  const s=smcAdaptiveV2(k);
  assert.equal(s.signal[buy+2],'SELL');
  const sim=simulateNextOpen(k,s.signal.map(x=>x??'HOLD'),0,.1,.05);
  assert.equal(sim.trades.at(-1)!.exitPrice,stop*.7*.9995);
});

test('V2 low-ATR profit protection waits until the buffer has actually been earned',()=>{
  // Compress real OHLC moves to reproduce the small-ATR / large-cost-buffer case.
  const k=fixture.map(b=>({...b,...Object.fromEntries(['open','high','low','close'].map(key=>
    [key,String(100+(+b[key as keyof KlineData]-100000)*.00001)]))}));
  const buy=smcAdaptiveV2(k).signal.indexOf('BUY');
  assert.ok(buy>0&&buy+2<k.length);
  const entry=+k[buy].close;
  for(const [offset,gain] of [[1,.001],[2,.005]]) {
    const b=k[buy+offset];b.open=k[buy+offset-1].close;b.close=String(entry*(1+gain));
    b.high=String(+b.close*1.00001);b.low=String(+b.open*.99999);
  }
  const r=smcAdaptiveV2(k.slice(0,buy+3));
  assert.equal(r.signal[buy+1],null,'A +0.1% move cannot protect +0.35%');
  assert.ok(r.stop[buy+1]!<entry);
  assert.ok(r.stop[buy+2]!>=entry*(1+SMC_ADAPTIVE_V2_DEFAULTS.breakEvenBufferPct/100));
});

test('V2 validates parameters and flat/empty inputs; confirmed mode cannot be disabled',()=>{
  assert.deepEqual(smcAdaptiveV2([]).signal,[]);
  assert.ok(smcAdaptiveV2(prices(new Array(300).fill(100))).signal.every(x=>x===null));
  assert.ok(smcAdaptiveV2(fixture,{},fixture.length).signal.every(x=>x===null));
  for(const p of [{adxPeriod:1},{adxThreshold:NaN},{adxThreshold:101},{confluenceBars:2.5},{trailAtr:0},{fastPeriod:200}])
    assert.throws(()=>smcAdaptiveV2(fixture,p));
  assert.throws(()=>smcAdaptiveV2(fixture,{},-1));
  assert.deepEqual(computeSignals(fixture,'smc_adaptive_v2',{}, {confirmedPivots:false}),computeSignals(fixture,'smc_adaptive_v2'));
  const request={symbol:'BTCUSDT',interval:'1h',source:'latest',mode:'both',strategy:'smc_adaptive_v2',selected:'smc_adaptive_v2',fee:.1,slippage:.05};
  assert.equal(warmupBars(validate(request)),1000);
  assert.throws(()=>validate({...request,params:{smc_adaptive_v2:{fastPeriod:200}}}));
});
