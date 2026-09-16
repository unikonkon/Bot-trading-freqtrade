import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchPage } from '../data';
import type { KlineData } from '../../../lib/types/kline';
const intervals=['1m','3m','5m','15m'] as const;
async function closed(interval:string,count:number,end:number):Promise<KlineData[]> {
  let k:KlineData[]=[];
  while(k.length<count) {
    const page=(await fetchPage({symbol:'BTCUSDT',interval,limit:String(Math.min(1000,count-k.length)),endTime:String(end)})).filter(b=>b.closeTime<=end);
    assert.ok(page.length,'No closed data'); k=[...page,...k];end=page[0].openTime-1;
  }
  const ms=Number(interval.slice(0,-1))*60000;
  assert.equal(k.length,count);
  assert.ok(k.every((b,i)=>b.closeTime-b.openTime+1===ms&&(!i||b.openTime===k[i-1].closeTime+1)));
  return k;
}
async function main(){
  const root=new URL('./data/',import.meta.url),asOf=Date.now();
  if(fs.existsSync(new URL('manifest.json',root))) throw Error('Frozen data exists; preserve it.');
  const tests:Record<string,KlineData[]>={};
  for(let i=0;i<intervals.length;i+=2) await Promise.all(intervals.slice(i,i+2).map(async tf=>{tests[tf]=await closed(tf,1000,asOf-1);}));
  // ALL development candles end before the first test candle in ANY timeframe.
  const cutoff=Math.min(...Object.values(tests).map(k=>k[0].openTime));
  const records:{interval:string,file:string,sha256:string,testFrom:string,testTo:string}[]=[];
  for(const interval of intervals) {
    const development=await closed(interval,2300,cutoff-1),test=tests[interval];
    assert.ok(development.at(-1)!.closeTime<cutoff);
    const file=`BTCUSDT-${interval}.json`,raw=JSON.stringify({development,test});
    fs.writeFileSync(new URL(file,root),raw);
    records.push({interval,file,sha256:createHash('sha256').update(raw).digest('hex'),testFrom:new Date(test[0].openTime).toISOString(),testTo:new Date(test.at(-1)!.closeTime).toISOString()});
    console.log(`${interval}: development 2300; final test 1000; test ends ${records.at(-1)!.testTo}`);
  }
  fs.writeFileSync(new URL('manifest.json',root),JSON.stringify({symbol:'BTCUSDT',asOf:new Date(asOf).toISOString(),developmentCutoff:new Date(cutoff).toISOString(),feePct:.1,slippagePct:.05,source:'Binance Spot /api/v3/klines',records},null,2)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
