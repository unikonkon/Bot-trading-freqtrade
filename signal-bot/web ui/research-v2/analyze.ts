/** Offline audit, comparison, cost stress and portable export for the frozen V2. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { STRATEGIES } from '../../../lib/backtest';
import { smcAdaptiveV2, SMC_ADAPTIVE_V2_DEFAULTS } from '../../../lib/indicators';
import { parseKline, type KlineData } from '../../../lib/types/kline';
import { analyze, simulateNextOpen, type Simulation } from '../engine';
import { calculateExport } from '../export-calculations';
import { captureExportSources, createExport } from '../export';
import { validate } from '../data';

async function main() {
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=fileURLToPath(new URL('../../signal-export-BTCUSDT-1h-2026-09-16T10-36-11-055Z/',import.meta.url));
const output=path.join(root,'smc-adaptive-v2-results');fs.mkdirSync(output,{recursive:true});
const read=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const config=read(path.join(dir,'config.json'));
const k:KlineData[]=read(path.join(dir,'input-klines.json'));
const manifest=read(path.join(dir,'manifest.json')) as {sha256:Record<string,string>};
for(const [file,hash] of Object.entries(manifest.sha256)) {
 const target=path.resolve(dir,file);assert.ok(target.startsWith(path.resolve(dir)+path.sep));
 assert.equal(sha(target),hash,`checksum: ${file}`);
}
assert.equal(k.length,9399);
assert.ok(k.every((b,i)=>i===0||b.openTime-k[i-1].openTime===3600000));
const p=SMC_ADAPTIVE_V2_DEFAULTS;
assert.deepEqual(read(fileURLToPath(new URL('./selection.json',import.meta.url))).selected,p,'Frozen defaults match pre-test selection');
const start=config.startIndex as number,trainEnd=start+Math.floor((k.length-start)*.6),valEnd=start+Math.floor((k.length-start)*.8);
function stats(s:Simulation) {
 const avg=(a:typeof s.trades)=>a.length?a.reduce((v,t)=>v+t.pnlPct,0)/a.length:0;
 return {returnPct:s.returnPct,drawdownPct:s.maxDrawdownPct,trades:s.totalTrades,winRate:s.winRate,profitFactor:s.profitFactor,
  avgWin:avg(s.trades.filter(t=>t.pnlPct>0)),avgLoss:avg(s.trades.filter(t=>t.pnlPct<=0)),
  worstTrade:s.totalTrades?Math.min(...s.trades.map(t=>t.pnlPct)):0,
  exposurePct:100*s.trades.reduce((sum,t)=>sum+t.bars,0)/s.equity.length,buyAndHoldPct:s.buyAndHoldPct};
}
const ids=['smc_adaptive','trendlines','smc_adaptive_v2'] as const;
const baselineCalculations = {smc_adaptive:read(path.join(dir,'calculations/smc_adaptive.json')),trendlines:read(path.join(dir,'calculations/trendlines.json'))};
const byId=(id:typeof ids[number])=>STRATEGIES.find(s=>s.id===id)!;
const simulations=ids.map(id=>{
 const s=byId(id),params=config.params[id]??s.params;
 const r=analyze(k,start,id,params,.1,.05,'both',true);
 if(id!=='smc_adaptive_v2') assert.deepEqual(r.simulations,baselineCalculations[id].simulations,`baseline parity ${id}`);
 return {id,name:s.name,nextOpen:stats(r.simulations[0]),legacy:stats(r.simulations[1]),simulations:r.simulations};
});
const splits=([['train',start,trainEnd],['validation',trainEnd,valEnd],['test',valEnd,k.length]] as const).map(([name,begin,end])=>({
 name,begin,end,from:new Date(k[begin].openTime).toISOString(),to:new Date(k[end-1].closeTime).toISOString(),
 rows:ids.map(id=>({id,...stats(analyze(k.slice(0,end),begin,id,byId(id).params,.1,.05,'next_open',true).simulations[0])})),
}));
const result=smcAdaptiveV2(k,{},start),signals=result.signal.map(x=>x??'HOLD');
const cuts=new Set([start,trainEnd,valEnd,k.length]);
for(let i=start+1;i<k.length;i+=97) cuts.add(i);
for(let i=start;i<k.length;i++) if(result.signal[i]) {cuts.add(i);cuts.add(i+1);}
for(const cut of cuts) {
 const prefix=smcAdaptiveV2(k.slice(0,cut),{},start);
 for(const key of ['signal','stop','initialRisk','regime','reason','adx','plusDI','minusDI','trendlineUpper','trendlineLower'] as const)
  assert.deepEqual(prefix[key],result[key].slice(0,cut),`${key} prefix ${cut}`);
}
const stress=([[.1,0],[.1,.05],[.1,.1],[.2,.1]] as const).map(([fee,slip])=>({fee,slip,...stats(simulateNextOpen(k,signals,start,fee,slip))}));
const testStress=([[.1,.05],[.1,.1],[.2,.1]] as const).map(([fee,slip])=>({fee,slip,...stats(simulateNextOpen(k,smcAdaptiveV2(k,{},valEnd).signal.map(x=>x??'HOLD'),valEnd,fee,slip))}));
const latest=stats(analyze(k.slice(-500),0,'smc_adaptive_v2',p,.1,.05,'next_open',true).simulations[0]);
const fixtures=['BTCUSDT-1h','ETHUSDT-4h'].map(name=>{
 const bars:KlineData[]=read(fileURLToPath(new URL(`../../../freqtrade/fixtures/${name}.json`,import.meta.url))).map(parseKline);
 return {name,from:new Date(bars[300].openTime).toISOString(),to:new Date(bars.at(-1)!.closeTime).toISOString(),...stats(analyze(bars,300,'smc_adaptive_v2',p,.1,.05,'next_open',true).simulations[0])};
});
// Forensics only: exclude the exit candle's high/low when its open is the fill.
const diagnostics=simulations.map(s=>({id:s.id,trades:s.simulations[0].trades.map(t=>{
 const held=k.slice(t.entryIdx,t.reason==='ปิดเมื่อจบข้อมูล'?t.exitIdx+1:t.exitIdx);
 const max=held.length?Math.max(t.entryPrice,...held.map(b=>+b.high)):t.entryPrice;
 const min=held.length?Math.min(t.entryPrice,...held.map(b=>+b.low)):t.entryPrice;
 const entryReason=s.id==='smc_adaptive_v2'?result.reason[t.entryIdx-1]:baselineCalculations[s.id].records[t.entryIdx-1-start].reason;
 return {...t,entryReason,mfePct:100*(max/t.entryPrice-1),maePct:100*(min/t.entryPrice-1)};
})}));
const full=simulations.find(s=>s.id==='smc_adaptive_v2')!;
const calc=calculateExport(k,start,'smc_adaptive_v2',p,.1,.05,'both');
const trades=full.simulations[0].trades.map(t=>({...t,entryReason:result.reason[t.entryIdx-1],exitReason:t.reason==='ปิดเมื่อจบข้อมูล'?'end of data':result.reason[t.exitIdx-1]}));
fs.writeFileSync(path.join(output,'trades.json'),JSON.stringify(trades,null,2));
const evidence={source:dir,inputSha256:sha(path.join(dir,'input-klines.json')),codeSha256:sha(fileURLToPath(new URL('../../../lib/indicators.ts',import.meta.url))),
 sourceChecksumVerified:true,baselineExactParity:true,causalPrefixes:cuts.size,parameters:p,
 periods:{from:new Date(k[start].openTime).toISOString(),to:new Date(k.at(-1)!.closeTime).toISOString(),warmup:start,bars:k.length-start},
 comparisons:simulations.map(({simulations:_,...s})=>s),splits,costStress:stress,testCostStress:testStress,latest500:latest,fixtures,diagnostics};
fs.writeFileSync(path.join(output,'analysis.json'),JSON.stringify(evidence,null,2));
fs.writeFileSync(path.join(output,'signals.json'),JSON.stringify({startIndex:start,records:calc.records}));
const f=(n:number)=>n.toFixed(2);
const lines=['# SMC Adaptive V2 — ผลวิเคราะห์ BTCUSDT 1h','',
 `V2 ให้กำไรสุทธิ **${f(full.nextOpen.returnPct)}%**, drawdown **${f(full.nextOpen.drawdownPct)}%**, ${full.nextOpen.trades} เทรด ใน export นี้ หลัง fee 0.10% + slippage 0.05% ต่อขา. V1 −8.84%, Trendlines −14.38%, Buy & hold −34.93%. ผลที่ดีขึ้นยังไม่ใช่การรับรองกำไรสูงสุดในอนาคต`, '',
 '## ข้อมูลและวิธีเปรียบเทียบ','',
 `- แหล่งข้อมูล: ${path.basename(dir)}; ${evidence.periods.from} ถึง ${evidence.periods.to} (UTC); 8,399 แท่งทดสอบ + 1,000 warmup`,
 `- ตรวจ checksum ทุกไฟล์ตาม manifest; คำนวณ V1/Trendlines ซ้ำตรง export ทั้ง 2 โหมดทุกเทรด; ตรวจความเป็นเหตุเป็นผลของ V2 ด้วย prefix ${cuts.size} จุด รวมก่อน/หลังทุกสัญญาณ`,
 '- เปรียบเทียบหลักแบบ next_open: Long เต็มพอร์ตครั้งละหนึ่งสถานะ เริ่ม 100 ทบต้น ไม่มี short/leverage. ทุกสัญญาณใช้ข้อมูลถึงราคาปิดและ fill เปิดแท่งถัดไปพร้อมต้นทุน. Stop เป็น close trigger ไม่ใช่คำสั่ง stop ระหว่างแท่ง; gap อาจทำให้แพ้เกิน stop',
 '- ทุกช่วงเริ่มสถานะว่าง แต่ใช้ข้อมูลก่อนหน้าเป็น warmup; สิ้นช่วงบังคับปิดสถานะค้าง. Drawdown วัด ณ ปิดแท่ง ไม่ใช่ drawdown สูงสุดระหว่างแท่ง', '',
 '| กลยุทธ์ | สุทธิ % | DD % | เทรด | ชนะ % | PF | แย่สุด % | เวลาถือ % |','|---|---:|---:|---:|---:|---:|---:|---:|'];
for(const s of simulations) {const r=s.nextOpen;lines.push(`| ${s.name} | ${f(r.returnPct)} | ${f(r.drawdownPct)} | ${r.trades} | ${f(r.winRate)} | ${r.profitFactor===null?'∞':f(r.profitFactor)} | ${f(r.worstTrade)} | ${f(r.exposurePct)} |`);}
lines.push('','## วิเคราะห์เทรดเดิม','',
 '- V1 ออกด้วย ATR close stop 19 จาก 24 เทรด ออกตาม target 4 และ timeout 1. การเลื่อน stop ของ V1 เริ่มเมื่อกำไรถึง initial risk และใช้ระยะ 4 ATR จึงอาจคืนกำไรระหว่างรอ',
 '- Trendlines เข้าได้เร็วกว่าแต่ไม่มีตัวกรอง SMC/ADX และไม่มี risk exit ของตนเอง จึงเสี่ยงเข้าออกในตลาดแกว่ง. เปรียบเทียบกับ V2 ที่รอโครงสร้าง bullish และเส้นที่ยืนยันแล้วพร้อมกัน',
 ...diagnostics.map(d=>`- ${d.id}: ${d.trades.filter(t=>t.pnlPct<0&&t.mfePct>1).length} เทรดเคยมี high สูงกว่าราคาเข้า >1% แต่ปิดขาดทุน. MFE/MAE ใช้เพื่ออธิบายหลังจบเทรดเท่านั้น ไม่ถูกนำไปสร้างสัญญาณ; ไม่นับ high/low ของแท่งออกหลัง fill ที่ open`), '',
 '## ความรู้เพิ่มเติมและสิ่งที่นำมาใช้','',
 '- [Fidelity DMI/ADX](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/DMI): ADX วัดแรงเทรนด์ ส่วน DI ช่วยแยกทิศ; V2 ใช้ Wilder smoothing และ +DI > −DI. Fidelity ยก 25 เป็นเกณฑ์เทรนด์แข็งแรงทั่วไป ส่วนค่า 15 ของ V2 มาจากการทดลองชุดข้อมูลนี้และต้องใช้ร่วมกับ SMC/EMA/Trendlines ไม่ใช่การอ้างว่า 15 เป็นเกณฑ์มาตรฐาน',
 '- [CME Trend vs. Anti-Trend](https://www.cmegroup.com/education/courses/trading-and-analysis/trend-vs-anti-trend): สัญญาณตามเทรนด์มีความล่าช้าและเจอสัญญาณหลอกในตลาดแกว่งได้. V2 จึงจำกัดอายุ breakout 6 แท่ง รอ EMA200 เพิ่มจาก 24 แท่งก่อน และไม่ซื้อไกล EMA50 เกิน 2 ATR; ตัวเลขเหล่านี้เป็นสมมติฐานของ implementation ไม่ใช่สูตรที่ CME รับรอง',
 '- [CME Utilizing Stop Orders](https://www.cmegroup.com/education/courses/master-the-trade-futures/take-your-trade-plan-to-the-next-level/master-the-trade-utilizing-stop-orders.hideSubnav.educationIframe.html?hideAddThisExt=y&hideFooter=y&hideHeader=y&hideRightRail=y): สภาพราคา/ความผันผวนมีผลต่อระยะ stop และความเสี่ยง. V2 ใช้ ATR และงดเข้าเมื่อเกิด shock; อย่างไรก็ตามเครื่องมือนี้จำลอง close-stop และยังลงเต็มพอร์ต ไม่ได้ทำ volatility-target position sizing',
 '- [AQR Time Series Momentum](https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum): เป็นบริบทของการตามแนวโน้มในหลายตลาด; ไม่ได้เป็นหลักฐานว่า SMC+Trendlines หรือ BTC 1h สูตรนี้จะได้ผล จึงตรวจต้นทุนและช่วงเวลาต่าง ๆ แยกในรายงาน', '',
 '## สูตร V2 ที่ใช้งานจริง','',
 '1. confirmed internal pivot 20 → SMC structure trend; Trendlines confirmed pivot 14 และ slope ATR×1. ไม่ใช้ upper=0 ช่วง bootstrap และไม่อ่านสถานะ OB/FVG ในอนาคต',
 '2. BUY เมื่อ Trendlines breakUp อายุไม่เกิน 6 แท่ง, SMC bullish, close เหนือเส้น upper และ EMA200, EMA50 > EMA200 และไม่ลดลงจาก 5 แท่งก่อน, EMA200 เพิ่มจาก 24 แท่งก่อน, ADX14 >=15, +DI>−DI, แท่งเขียว, ระยะเหนือ EMA50 <=2 ATR',
 '3. งดเข้าเมื่อ ATR14/ATR50 >2.5 หรือ range แท่ง >4 ATR หรืออยู่ใน cooldown 6 แท่ง. ราคา gap ยังมีผลต่อ fill และตัวกรองไม่ได้รับประกันหลบทุก shock',
 '4. Stop เริ่ม 3×ATR×clamp(ATR14/ATR50,1,1.5), อ้างราคาปิดแท่ง BUY. ทุกแท่งเลื่อนขึ้นตาม peak CLOSE−2 ATR; เมื่อ peak close เพิ่ม >=1.5×ATR ณ เข้า จะยก stop อย่างน้อยราคาเข้าอ้างอิง +0.35%. Stop ห้ามเลื่อนลงและไม่มี fixed profit target',
 '5. SELL เมื่อ close <= stop รวมกรณีเพิ่งเลื่อน stop ในแท่งปิดนั้น, bearish SMC/Trendlines breakdown พร้อม close < EMA50 หรือครบ 200 แท่ง. การคำนวณ stop จาก close ปัจจุบันเพื่อ fill open ถัดไปไม่ใช่การ fill ย้อนหลัง. Buffer 0.35% ไม่รับประกัน break-even หลัง gap/fee/slippage', '',
 '## การเลือกค่าและข้อจำกัดของข้อมูล','',
 'ทดลองต้นแบบแรก 64 ชุดแล้ว validation ยังขาดทุน จากนั้นเพิ่มเงื่อนไข EMA200 ต้องเพิ่มจาก 24 แท่งก่อนและทดลอง grid อีก 64 ชุด. จัดอันดับ train ด้วย return−0.5×DD−max(0,12−จำนวนเทรด), นำ 8 อันดับแรกไปเรียง validation ด้วย return−0.5×DD; เสมอใช้ลำดับ train. รวม 128 ชุด บางชุดให้สัญญาณเหมือนกัน ไม่ใช่กลยุทธ์อิสระทั้งหมด', '',
 'ค่า default ถูกเลือกก่อนเปิดผล test ของ V2 และไม่ปรับตาม test หลังจากนั้น. แต่ข้อมูลช่วงท้ายซ้ำกับช่วงที่ใช้พัฒนา V1 และเราได้เห็นผลสรุป export นี้ก่อนออกแบบ จึงไม่ใช่ blind out-of-sample และยังไม่มี forward test. Validation ไม่มีเทรด จึงไม่มีหลักฐานยืนยันความสามารถทำกำไรในช่วงนั้น การไม่เข้าเทรดช่วยหลีกเลี่ยงการขาดทุนในชุดนี้เท่านั้น', '',
 '| ช่วง | UTC เริ่ม–สิ้นสุด | V2 สุทธิ % | DD % | เทรด | Buy & hold % |','|---|---|---:|---:|---:|---:|');
for(const s of splits) {const r=s.rows.find(x=>x.id==='smc_adaptive_v2')!;lines.push(`| ${s.name} | ${s.from} – ${s.to} | ${f(r.returnPct)} | ${f(r.drawdownPct)} | ${r.trades} | ${f(r.buyAndHoldPct)} |`);}
lines.push('', 'กำไรทั้งชุดกระจุกในช่วง train; test มีเพียง 4 เทรดและผลตอบแทนต่ำกว่า Buy & hold มาก. สูตรนี้จึงยังเป็นต้นแบบเพื่อทดลอง ไม่ใช่ผลพิสูจน์ว่าดีที่สุดทุกช่วงเวลา', '',
 '## ผลเมื่อเพิ่มต้นทุน','', '| Fee ต่อขา % | Slippage ต่อขา % | ทั้งช่วงสุทธิ % | DD % |','|---:|---:|---:|---:|');
for(const r of stress) lines.push(`| ${r.fee} | ${r.slip} | ${f(r.returnPct)} | ${f(r.drawdownPct)} |`);
lines.push('', '| Fee ต่อขา % | Slippage ต่อขา % | test สุทธิ % |','|---:|---:|---:|');
for(const r of testStress) lines.push(`| ${r.fee} | ${r.slip} | ${f(r.returnPct)} |`);
lines.push('',`ล่าสุด 500 แท่งของ export: ${f(latest.returnPct)}%, ${latest.trades} เทรด (ข้อมูลซ้ำ ไม่ใช่ชุดอิสระ).`,'',
 '## Fixtures เพิ่มเติมด้วยค่าเดิม','', '| Fixture | UTC เริ่ม–สิ้นสุด | สุทธิ % | DD % | เทรด |','|---|---|---:|---:|---:|');
for(const r of fixtures) lines.push(`| ${r.name} | ${r.from} – ${r.to} | ${f(r.returnPct)} | ${f(r.drawdownPct)} | ${r.trades} |`);
lines.push('', 'BTC fixture ซ้ำช่วง export; ETH เป็นอีกคู่/กรอบเวลา แต่จำนวนเทรดน้อย ไม่ใช่การรับรองการใช้ข้ามตลาด. ค่า default ไม่ถูกปรับจากผล fixtures', '',
 '## ไฟล์และวิธีรัน','',
 '- โค้ดหลัก `lib/indicators.ts`: `directionalMovement()`, `smcAdaptiveV2()` และ `SMC_ADAPTIVE_V2_DEFAULTS`. เว็บและ Export เชื่อมด้วย ID `smc_adaptive_v2`; V1 และ Trendlines เดิมคงสูตรเดิม',
 '- จาก repository root รัน `npm run web:ui` และเลือก **SMC Adaptive V2**; server เดิมต้อง restart เพื่อโหลดโค้ดและ export snapshot ใหม่. เลือกช่วงวันที่และ next_open สำหรับเทียบรายงานนี้ ไม่ใช้ข้อมูล 500 แท่งล่าสุดแทนทั้งช่วง',
 '- `npm run web:smc:v2:analyze` สร้าง analysis.json, signals.json, trades.json, รายงานและ `SMC-Adaptive-V2.zip` ใหม่จาก export เดิมแบบ offline. `npm run web:smc:v2:select` ทำ grid รุ่นสุดท้ายซ้ำและเขียน selection.json โดยไม่แก้ default อัตโนมัติ',
 '- ZIP มีโค้ด, input เดิมรวม warmup, calculations, signals และ trades. แตกไฟล์แล้ว `npm ci && npm run replay` เพื่อตรวจคำนวณซ้ำโดยไม่เรียก Binance; ZIP เป็นแพ็กเกจ replay ไม่ใช่เว็บ server ทั้งแอป',
 '- `npm run web:check` / `npm run web:test` ตรวจ TypeScript, browser script, ADX, prefix, warmup, confluence, stop และ next-open gaps. ยังไม่มี Python/Freqtrade port และไม่ได้รันเงินจริง',
 '- ไม่ได้ใช้ rolling-window replay ของบอท. Indicator ที่มีสถานะควรใช้ประวัติสะสมและ startIndex คงเดิม; การเลื่อนหน้าต่าง 500 แท่งอาจเปลี่ยนจุดเริ่ม EMA/structure/state. กำไรอดีตและ prefix tests ไม่รับรองกำไรในอนาคต', '');
fs.writeFileSync(path.join(output,'REPORT.th.md'),lines.join('\n'));
const cfg=validate({symbol:config.symbol,interval:config.interval,source:config.source,from:config.requested.from,to:config.requested.to,limit:config.requested.limit,
 strategy:'smc_adaptive_v2',selected:'smc_adaptive_v2',mode:'both',fee:.1,slippage:.05,params:{...config.params,smc_adaptive_v2:p}});
const sources=await captureExportSources();
const archive=createExport('smc-adaptive-v2-offline-analysis',{at:Date.now(),cfg,datasets:{[cfg.interval]:{klines:k,start,warnings:['Offline replay using the original 10-36 export candles and frozen SMC Adaptive V2 parameters']}}},['smc_adaptive_v2'],sources);
fs.writeFileSync(path.join(output,'SMC-Adaptive-V2.zip'),archive);
console.log(JSON.stringify({output,full:full.nextOpen,test:splits[2].rows.find(x=>x.id==='smc_adaptive_v2'),stress,testStress,latest,fixtures,causalPrefixes:cuts.size,archiveBytes:archive.length},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
