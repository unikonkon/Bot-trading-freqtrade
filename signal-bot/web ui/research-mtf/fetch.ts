import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchPage } from '../data';
import type { KlineData } from '../../../lib/types/kline';
const intervals=['1m','3m','5m','15m','30m','1h','2h','4h'] as const;
async function main(){
 const asOf=Date.now(),root=new URL('./data/',import.meta.url);
 if(fs.existsSync(new URL('manifest.json',root))) throw new Error('Frozen data already exists. Preserve it; use a new directory for a new run.');
 const records:{interval:typeof intervals[number],file:string,bars:number,testBars:number,testFrom:string,testTo:string,sha256:string}[]=[];
 // At most two independent requests at a time. Page each series backwards.
 for(let group=0;group<intervals.length;group+=2){
  await Promise.all(intervals.slice(group,group+2).map(async interval=>{
   let k:KlineData[]=[],end=asOf-1;
   while(k.length<3300){
    const page=(await fetchPage({symbol:'BTCUSDT',interval,limit:String(Math.min(1000,3300-k.length)),endTime:String(end)})).filter(b=>b.closeTime<asOf);
    if(!page.length) throw new Error(`Not enough bars: ${interval}`);
    k=[...page,...k];end=page[0].openTime-1;
   }
   k=k.slice(-3300);
   const minutes=Number(interval.slice(0,-1))*(interval.endsWith('h')?60:1),ms=minutes*60000;
   assert.equal(k.length,3300);
   assert.ok(k.every((b,i)=>b.closeTime-b.openTime+1===ms&&(i===0||b.openTime-k[i-1].openTime===ms)));
   const raw=JSON.stringify(k),file=`BTCUSDT-${interval}.json`;
   fs.writeFileSync(new URL(file,root),raw);
   records.push({interval,file,bars:k.length,testBars:1000,testFrom:new Date(k[2300].openTime).toISOString(),testTo:new Date(k.at(-1)!.closeTime).toISOString(),sha256:createHash('sha256').update(raw).digest('hex')});
   console.log(`${interval}: ${k.length} closed bars; last1000 ${new Date(k[2300].openTime).toISOString()} -> ${new Date(k.at(-1)!.closeTime).toISOString()}`);
  }));
 }
 fs.writeFileSync(new URL('manifest.json',root),JSON.stringify({symbol:'BTCUSDT',asOf:new Date(asOf).toISOString(),source:'Binance Spot GET /api/v3/klines',feePct:.1,slippagePct:.05,records:records.sort((a,b)=>intervals.indexOf(a.interval)-intervals.indexOf(b.interval))},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
