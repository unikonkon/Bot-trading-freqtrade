import fs from 'node:fs';
import { smcAdaptiveV2 } from './baseline-indicators';
import { simulateNextOpen } from '../engine';
import type { KlineData } from '../../../lib/types/kline';
const root = new URL('./data/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
const results = manifest.records.map((record: {interval:string,file:string}) => {
  const k: KlineData[] = JSON.parse(fs.readFileSync(new URL(record.file, root), 'utf8')).slice(-1000);
  const r = smcAdaptiveV2(k), s = r.signal.map(x => x ?? 'HOLD');
  const net = simulateNextOpen(k,s,0,.1,.05), gross = simulateNextOpen(k,s,0,0,0);
  const atrPct = r.atr.flatMap((a,i)=>a===null?[]:[100*a/+k[i].close]).sort((a,b)=>a-b);
  return { interval:record.interval,trades:net.totalTrades,net:net.returnPct,gross:gross.returnPct,dd:net.maxDrawdownPct,buyHold:net.buyAndHoldPct,medianAtrPct:atrPct[Math.floor(atrPct.length/2)] };
});
fs.writeFileSync(new URL('./baseline.json', import.meta.url), JSON.stringify(results,null,2)+'\n');
console.table(results);
