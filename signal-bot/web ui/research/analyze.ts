/** Reproduce the comparison offline; never tunes parameters or sends orders. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { STRATEGIES } from '../../../lib/backtest';
import { smcAdaptive, SMC_ADAPTIVE_DEFAULTS } from '../../../lib/indicators';
import { parseKline, type KlineData } from '../../../lib/types/kline';
import { analyze, simulateNextOpen, type Simulation } from '../engine';
import { calculateExport } from '../export-calculations';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'smc-adaptive-results');
fs.mkdirSync(output, { recursive: true });
const names = ['signal-export-BTCUSDT-1h-2026-09-16T10-00-08-170Z', 'signal-export-BTCUSDT-1h-2026-09-16T09-57-35-100Z'];
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const f = (n: number) => n.toFixed(2);
function metrics(s: Simulation) {
  const wins = s.trades.filter(t => t.pnlPct > 0), losses = s.trades.filter(t => t.pnlPct <= 0);
  const avg = (a: typeof s.trades) => a.length ? a.reduce((v, t) => v + t.pnlPct, 0) / a.length : 0;
  return { returnPct: s.returnPct, drawdownPct: s.maxDrawdownPct, trades: s.totalTrades,
    winRate: s.winRate, profitFactor: s.profitFactor, avgWin: avg(wins), avgLoss: avg(losses),
    worstTrade: s.trades.length ? Math.min(...s.trades.map(t => t.pnlPct)) : 0,
    avgBars: s.trades.length ? s.trades.reduce((v, t) => v + t.bars, 0) / s.trades.length : 0,
    exposurePct: s.equity.length ? 100 * s.trades.reduce((v, t) => v + t.bars, 0) / s.equity.length : 0,
    buyAndHoldPct: s.buyAndHoldPct };
}
const datasets = names.map(name => {
  const dir = path.join(root, name), cfg = read(path.join(dir, 'config.json'));
  const k: KlineData[] = read(path.join(dir, 'input-klines.json'));
  const manifest = read(path.join(dir, 'manifest.json')) as { sha256: Record<string, string> };
  for (const [file, hash] of Object.entries(manifest.sha256)) {
    const target = path.resolve(dir, file);
    assert.ok(target.startsWith(dir + path.sep));
    assert.equal(sha(target), hash, `Source checksum: ${name}/${file}`);
  }
  assert.ok(k.every((b, i) => i === 0 || b.openTime - k[i - 1].openTime === 3600000));
  const rows = STRATEGIES.map(s => {
    const p = cfg.params[s.id] ?? s.params;
    const result = analyze(k, cfg.startIndex, s.id, p, cfg.fee, cfg.slippage, 'both', true);
    if (s.id !== 'smc_adaptive') {
      const saved = read(path.join(dir, `calculations/${s.id}.json`));
      // The old indicators must still reproduce both original engines/trades.
      assert.deepEqual(result.simulations, saved.simulations, `Original parity: ${s.id}`);
    }
    return { id: s.id, name: s.name, nextOpen: metrics(result.simulations[0]), legacy: metrics(result.simulations[1]) };
  });
  return { name, k, start: cfg.startIndex as number, from: new Date(k[cfg.startIndex].openTime).toISOString(), to: new Date(k.at(-1)!.closeTime).toISOString(), rows };
});
const primary = datasets[0], k = primary.k;
assert.deepEqual(k.slice(-500), datasets[1].k, 'Short export is an overlapping suffix');
const trainEnd = 300 + Math.floor((k.length - 300) * .6), valEnd = 300 + Math.floor((k.length - 300) * .8);
const splits = [['train', 300, trainEnd], ['validation', trainEnd, valEnd], ['test', valEnd, k.length]] as const;
const splitResults = splits.map(([name, start, end]) => {
  const bars = k.slice(0, end);
  return { name, start, end, from: new Date(k[start].openTime).toISOString(), to: new Date(k[end - 1].closeTime).toISOString(),
    rows: STRATEGIES.map(s => ({ id: s.id, ...metrics(analyze(bars, start, s.id, s.params, .1, .05, 'next_open', true).simulations[0]) })) };
});
const adaptive = smcAdaptive(k, {}, 300), signals = adaptive.signal.map(x => x ?? 'HOLD');
// Check every signal boundary plus regularly spaced prefixes on the real export.
const cuts = new Set([300, 301, trainEnd, valEnd, k.length]);
for (let i = 301; i <= k.length; i += 73) cuts.add(i);
for (let i = 300; i < k.length; i++) if (adaptive.signal[i]) { cuts.add(i); cuts.add(i + 1); }
for (const end of cuts) {
  const prefix = smcAdaptive(k.slice(0, end), {}, 300);
  for (const key of ['signal', 'stop', 'target', 'reason', 'regime'] as const)
    assert.deepEqual(prefix[key], adaptive[key].slice(0, end), `${key} prefix ${end}`);
}
const stress = [[.1, 0], [.1, .05], [.1, .1], [.2, .1]].map(([fee, slip]) => ({fee, slip, ...metrics(simulateNextOpen(k, signals, 300, fee, slip))}));
const fixtures = ['BTCUSDT-1h', 'ETHUSDT-4h'].map(name => {
  const raw = read(fileURLToPath(new URL(`../../../freqtrade/fixtures/${name}.json`, import.meta.url)));
  const bars: KlineData[] = raw.map(parseKline);
  return { name, from: new Date(bars[300].openTime).toISOString(), to: new Date(bars.at(-1)!.closeTime).toISOString(),
    ...metrics(analyze(bars, 300, 'smc_adaptive', SMC_ADAPTIVE_DEFAULTS, .1, .05, 'next_open', true).simulations[0]) };
});
const calc = calculateExport(k, 300, 'smc_adaptive', SMC_ADAPTIVE_DEFAULTS, .1, .05, 'both');
fs.writeFileSync(path.join(output, 'calculations.json'), JSON.stringify(calc, null, 2));
const trades = calc.simulations[0].trades.map(t => ({ ...t, entryReason: adaptive.reason[t.entryIdx - 1],
  exitReason: t.reason === 'ปิดเมื่อจบข้อมูล' ? 'end of data' : adaptive.reason[t.exitIdx - 1] }));
fs.writeFileSync(path.join(output, 'trades.json'), JSON.stringify(trades, null, 2));
const evidence = { parameters: SMC_ADAPTIVE_DEFAULTS, codeSha256: sha(fileURLToPath(new URL('../../../lib/indicators.ts', import.meta.url))),
  sourceChecksumsVerified: true, originalStrategiesExactParity: true, causalPrefixChecks: cuts.size,
  shortDataOverlaps: true, datasets: datasets.map(({ k: _, ...d }) => d), splits: splitResults, costStress: stress, fixtures };
fs.writeFileSync(path.join(output, 'analysis.json'), JSON.stringify(evidence, null, 2));
const lines = ['# ผลวิเคราะห์ SMC Adaptive — BTCUSDT 1h', '',
  'SMC Adaptive รุ่นนี้ได้ผลตอบแทนสุทธิทั้งช่วง **+2.35%** เทียบ SMC เดิม **−17.54%** และ Trendlines **−5.09%** ซึ่งดีที่สุดใน 10 ตัวเดิม แต่ยังไม่ใช่หลักฐานว่าทำกำไรสูงสุดหรือใช้ได้ทุกสภาวะตลาด', '',
  'ใช้ next_open: Long เต็มพอร์ตหนึ่งสถานะ เริ่ม 100 หน่วย ทบต้น; fee 0.10% และ adverse slippage 0.05% ต่อขา ไม่มี leverage/short/funding. BUY/SELL ประเมินเมื่อแท่งปิด และ fill เปิดแท่งถัดไป; บังคับปิดเมื่อจบแต่ละช่วง. Drawdown วัดมูลค่าพอร์ต ณ ปิดแท่ง จึงอาจต่ำกว่า drawdown ระหว่างแท่งจริง', '',
  '## ข้อมูลและความถูกต้อง', '',
  `- ชุดหลัก: ${primary.name}: ${primary.from} ถึง ${primary.to} (UTC), ${k.length - 300} แท่งทดสอบ + 300 warmup`,
  '- ชุด 09-57 จำนวน 500 แท่งตรงกับท้ายชุดหลักทุกแท่ง ไม่ใช่ข้อมูลทดสอบอิสระ',
  `- ตรวจ SHA-256 ทุกไฟล์ตาม manifest ของทั้งสอง export; คำนวณซ้ำ 10 กลยุทธ์เดิมตรงกับผลเดิมทั้งสองโหมดทุกเทรด; ตรวจ prefix ของข้อมูลจริง ${cuts.size} จุด รวมก่อน/หลังทุกสัญญาณ`, '',
  '## ผลทุก indicator', ''];
for (const d of datasets) {
  lines.push(`### ${d.name}`, '', '| Indicator | สุทธิ % | DD % | เทรด | ชนะ % | PF | เฉลี่ยกำไร % | เฉลี่ยขาดทุน % | แย่สุด % | ถือเฉลี่ยแท่ง |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of [...d.rows].sort((a,b) => b.nextOpen.returnPct-a.nextOpen.returnPct)) {
    const r = row.nextOpen;
    lines.push(`| ${row.name} | ${f(r.returnPct)} | ${f(r.drawdownPct)} | ${r.trades} | ${f(r.winRate)} | ${r.profitFactor === null ? '∞' : f(r.profitFactor)} | ${f(r.avgWin)} | ${f(r.avgLoss)} | ${f(r.worstTrade)} | ${f(r.avgBars)} |`);
  }
  lines.push('');
}
lines.push('## สิ่งที่พบและการแก้ไข', '',
  '- RSI ชนะ 65.38% ในชุดหลัก แต่เฉลี่ยแพ้ −6.30% เทียบชนะ +2.66% และเทรดแย่สุด −26.89%: win rate อย่างเดียวใช้เลือกกลยุทธ์ไม่ได้',
  '- SMC เดิมส่ง CHoCH ทันทีโดยไม่บังคับโซน และไม่มี risk exit; แพ้เฉลี่ย −1.63%, 76 เทรด. รุ่นใหม่ใช้ internal pivot 20 แท่ง, swing 30, EMA 200 และต้องปิดทะลุโครงสร้างอย่างน้อย 0.1 ATR พร้อมแท่งเขียวและ RSI < 75',
  '- CM MACD / UT Bot ทำ 265 / 341 เทรดและขาดทุนประมาณ 61% หลังต้นทุน: รุ่นใหม่ลดความถี่เหลือ 18 เทรด ด้วยโครงสร้างใหญ่, cooldown 6 แท่ง และตัวกรอง shock',
  '- โหมด liquidity reclaim ใช้ confirmed support: low กวาดใต้แล้ว close กลับเหนือ, มี RSI < 25 ใน 8 แท่งล่าสุด, อยู่ discount, แท่งเขียวและ close เพิ่ม, ไม่อยู่ downtrend; setup หมดอายุ 6 แท่ง. ค่า default ไม่ได้เข้าแบบนี้เลยในชุดหลัก จึงยังประเมินผลตอบแทนของทางเข้านี้ไม่ได้',
  '- Efficiency 20 แท่ง + ATR14/ATR50 จำแนก regime; งดเข้าเมื่อ ATR ratio > 2.5 หรือ range แท่ง > 4 ATR. Breakout ต้องเหนือ EMA ที่ไม่ลดลง; reclaim งดเมื่อ regime ลง',
  '- Stop เริ่ม 3 ATR × clamp(ATR14/ATR50, 1, 1.5); reclaim อาจใช้ swept low − 0.25 ATR เพื่อลดระยะเสี่ยง; งดเข้าถ้าระยะต่ำกว่า 0.5 ATR. Target = 3 เท่าความเสี่ยง. เมื่อกำไรจากราคาปิดสูงสุด >= initial risk จะเลื่อน stop ตาม 4 ATR และห้ามเลื่อนลง',
  '- ออกเมื่อ close ผ่าน stop/target, bearish BOS/CHoCH, reclaim RSI >= 70 หรือถือครบ 120 แท่ง. ระดับ stop/target อ้างราคาปิดแท่ง BUY ไม่ใช่ราคา fill และไม่ใช่ stop order ระหว่างแท่ง: gap/slippage อาจทำให้ขาดทุนเกินระดับที่แสดง', '',
  '## การเลือกค่าและการประเมินตามเวลา', '',
  'ทดลองต้นแบบ retest 48 + 64 ชุดพารามิเตอร์แล้วไม่ดีพอในช่วงพัฒนา จึงเปลี่ยนเป็น structure breakout และทดลองอีก 96 ชุด (รวม 208). ในรุ่นสุดท้ายจัดอันดับ train ด้วย return − 0.5×DD และหัก 20 คะแนนถ้าเทรด < 10; นำ 8 อันดับแรกไปเลือกด้วย return − 0.5×DD บน validation. บางชุดให้สัญญาณเหมือนกัน จึงไม่ใช่ 208 กลยุทธ์อิสระ', '',
  'แบ่ง 60/20/20 ตามเวลา ใช้ข้อมูลก่อนจุดเริ่มเป็น warmup และเริ่มสถานะว่างทุกช่วง. คงค่าที่เลือกไว้ก่อนเปิดผล test; ไม่ปรับค่าตาม test หลังจากนั้น. การออกแบบได้เห็นสรุปทั้ง export และชุด 500 แท่งมาก่อนแล้ว จึงเป็น temporal holdout ในงานสำรวจ ไม่ใช่ blind test ที่บริสุทธิ์หรือ forward test', '',
  '| ช่วง | UTC เริ่ม–สิ้นสุด | สุทธิ % | DD % | เทรด | Buy & hold % |', '|---|---|---:|---:|---:|---:|');
for (const s of splitResults) { const r=s.rows.find(x=>x.id==='smc_adaptive')!; lines.push(`| ${s.name} | ${s.from} – ${s.to} | ${f(r.returnPct)} | ${f(r.drawdownPct)} | ${r.trades} | ${f(r.buyAndHoldPct)} |`); }
lines.push('', 'Test มีเพียง 4 เทรด ชนะหนึ่งครั้ง (+5.91%) และแพ้สามครั้ง ผลรวมจึงเปราะบางและแพ้ Buy & hold ในช่วงนั้น. Validation ยังติดลบ. รุ่นใหม่ดีที่สุดในตารางชุดหลักที่ทดสอบนี้ แต่ไม่ใช่ตัวที่ดีที่สุดในชุด 500 แท่ง ซึ่ง RSI ชนะที่ +4.82% ขณะที่รุ่นใหม่ −1.47%', '',
  '## ความไวต่อต้นทุน', '', '| Fee ต่อขา % | Slippage ต่อขา % | ผลสุทธิ % | DD % |', '|---:|---:|---:|---:|');
for (const r of stress) lines.push(`| ${r.fee} | ${r.slip} | ${f(r.returnPct)} | ${f(r.drawdownPct)} |`);
lines.push('', '## Fixtures เพิ่มเติม (ใช้ค่าคงเดิม ไม่ปรับเพิ่ม)', '', '| ข้อมูล | UTC เริ่ม–สิ้นสุด | สุทธิ % | DD % | เทรด |', '|---|---|---:|---:|---:|');
for (const r of fixtures) lines.push(`| ${r.name} | ${r.from} – ${r.to} | ${f(r.returnPct)} | ${f(r.drawdownPct)} | ${r.trades} |`);
lines.push('', 'BTC fixture อยู่ในช่วงเวลาเดียวกับ export หลัก จึงไม่ใช่ข้อมูลอิสระ; ETH เป็นอีกสินทรัพย์/กรอบเวลาและขาดทุน. Fixtures เป็นข้อมูลเดิมใน repository ไม่รับรองความเป็นตัวแทนของตลาดอื่น. ผล 18 เทรดยังน้อย และค่าที่เลือกจากหลายการทดลองมีความเสี่ยง overfit จึงยังรับรองกำไรในอนาคตไม่ได้', '',
  '## ใช้งานและคำนวณซ้ำ', '',
  'ไฟล์คำนวณจริงอยู่ `lib/indicators.ts` ฟังก์ชัน `smcAdaptive()`; เพิ่ม strategy `smc_adaptive` ใน registry และ mapping ของเว็บ/Export แล้ว ไม่ได้เปลี่ยนสูตร SMC เดิม. การใช้กับ Python/Freqtrade ต้อง port แยก; ยังไม่ได้เพิ่ม strategy นี้ให้ Python', '',
  'จาก root ของ repository: `npm run web:ui` แล้วเปิด http://127.0.0.1:4310 เลือก **SMC Adaptive**, โหมดเปิดแท่งถัดไป. ถ้าเว็บเก่ารันอยู่ต้อง restart เพื่อโหลดโค้ด/Export snapshot ใหม่. ดู `smcAdaptive.stop`, `target`, `reason`, `regime` ในรายละเอียดรายแท่ง', '',
  '`npm run web:smc:analyze` คำนวณรายงานนี้ใหม่แบบ offline; `npm run web:smc:select` ทดลอง grid รุ่นสุดท้ายใหม่และเขียน research/selection.json โดยไม่แก้ default อัตโนมัติ. `npm run web:check` และ `npm run web:test` ตรวจการเชื่อมต่อ/เหตุและผล/ระดับ stop. ใช้ accumulated history พร้อม startIndex เดิม; rolling window 500 แท่งของบอทอาจให้ state ต่างกัน', '',
  'ผลทั้งสองโหมด, ทุกช่วงของทุก strategy และต้นทุนอยู่ `analysis.json`; รายละเอียดสัญญาณอยู่ `calculations.json`; รายการเทรดใหม่พร้อมเหตุผลอยู่ `trades.json`', '',
  'หลักการตรวจข้อมูลอนาคตอ้างอิง [Freqtrade lookahead analysis](https://www.freqtrade.io/en/stable/lookahead-analysis/) และการยืนยันแท่ง/pivot อ้างอิง [TradingView repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/). งานนี้ใช้ prefix tests ของ TypeScript ไม่ได้อ้างว่าได้รันคำสั่ง Freqtrade lookahead-analysis', '');
fs.writeFileSync(path.join(output, 'REPORT.th.md'), lines.join('\n'));
console.log(JSON.stringify({ output, realDataPrefixChecks: cuts.size, full: primary.rows.find(x=>x.id==='smc_adaptive'), costStress: stress, fixtures }, null, 2));
