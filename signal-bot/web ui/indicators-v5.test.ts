import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  V5_REGISTRY, V5_STRATEGY_IDS, isV5StrategyId, smcLuxAlgoV5, SMC_LUXALGO_RULE_TH, SMC_LUXALGO_V5_DEFAULTS,
  type SmcLuxAlgoV5Result, type V5StrategyId,
} from '../../lib/indicators-v5-tradingView';
import { computeV3, v3Defaults, v3WarmupBars, validateV3Params, isV3StrategyId } from '../../lib/indicators-v3';
import { parseKline, type KlineData } from '../../lib/types/kline';
import { STRATEGIES, STRATEGY_FNS } from '../../lib/backtest';
import { analyze } from './engine';

const fixture: KlineData[] = JSON.parse(
  fs.readFileSync(new URL('../../freqtrade/fixtures/BTCUSDT-1h.json', import.meta.url), 'utf8'),
).map(parseKline);
const run = (id: V5StrategyId, k = fixture, params: Record<string, number> = {}, start = 0) =>
  computeV3(id, k, params, start) as SmcLuxAlgoV5Result;

/** แท่งที่คุม OHLC เองได้ทุกค่า */
function ohlc(rows: [number, number, number, number][], stepMs = 3600000): KlineData[] {
  return rows.map(([o, h, l, c], i) =>
    parseKline([i * stepMs, String(o), String(h), String(l), String(c), '100',
      (i + 1) * stepMs - 1, '1000', 10, '50', '500']));
}

/**
 * แบบจำลอง Pine ที่เขียนตามต้นฉบับทีละบรรทัด แยกจากตัวจริงโดยตั้งใจ:
 * เก็บ `var` แยกตาม call site, อ่าน `high[size]` ตรง ๆ, หา ta.highest ด้วยการวนทั้งหน้าต่าง
 * และ ta.crossover เทียบกับระดับที่ call site นั้นเห็นเมื่อแท่งก่อน
 * ถ้าตัวจริงคลาดจากนี้แม้แท่งเดียว แปลว่าแปลงดัชนีหรือลำดับการทำงานผิด
 */
function pineReference(k: KlineData[], p: typeof SMC_LUXALGO_V5_DEFAULTS) {
  const O = k.map((x) => +x.open), H = k.map((x) => +x.high), L = k.map((x) => +x.low), C = k.map((x) => +x.close);
  type Pv = { currentLevel: number | null; crossed: boolean };
  const swingHigh: Pv = { currentLevel: null, crossed: false }, swingLow: Pv = { currentLevel: null, crossed: false };
  const internalHigh: Pv = { currentLevel: null, crossed: false }, internalLow: Pv = { currentLevel: null, crossed: false };
  const swingTrend = { bias: 0 }, internalTrend = { bias: 0 };

  const legSite = () => { let legValue = 0; let prev: number | null = null; return { legValue: () => legValue, set: (v: number) => { legValue = v; }, prev: () => prev, setPrev: (v: number) => { prev = v; } }; };
  const sites = { swing: legSite(), internal: legSite() };
  function getCurrentStructure(i: number, size: number, internal: boolean) {
    const s = internal ? sites.internal : sites.swing;
    // leg(size)
    if (i >= size) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - size + 1; j <= i; j++) { hh = Math.max(hh, H[j]); ll = Math.min(ll, L[j]); }
      if (H[i - size] > hh) s.set(0);
      else if (L[i - size] < ll) s.set(1);
    }
    const cur = s.legValue(), before = s.prev();
    s.setPrev(cur);
    if (before === null) return; // ta.change แท่งแรก = na
    const change = cur - before;
    if (change !== 0) {
      if (change === 1) {
        const pv = internal ? internalLow : swingLow;
        pv.currentLevel = L[i - size]; pv.crossed = false;
      } else {
        const pv = internal ? internalHigh : swingHigh;
        pv.currentLevel = H[i - size]; pv.crossed = false;
      }
    }
  }
  // ประวัติของแต่ละ ta.crossover / ta.crossunder call site
  const hist = { iUp: null as number | null, iDn: null as number | null, sUp: null as number | null, sDn: null as number | null };
  const bars = { internal: { bull: true, bear: true }, swing: { bull: true, bear: true } };
  function displayStructure(i: number, internal: boolean, alerts: Record<string, boolean>) {
    const b = internal ? bars.internal : bars.swing;
    if (p.smcConfluenceFilter) {
      b.bull = H[i] - Math.max(C[i], O[i]) > Math.min(C[i], O[i] - L[i]);
      b.bear = H[i] - Math.max(C[i], O[i]) < Math.min(C[i], O[i] - L[i]);
    }
    const t = internal ? internalTrend : swingTrend;
    let pv = internal ? internalHigh : swingHigh;
    const neq = (a: number | null, c: number | null) => a !== null && c !== null && a !== c;
    let extra = internal ? neq(internalHigh.currentLevel, swingHigh.currentLevel) && b.bull : true;
    const upKey = internal ? 'iUp' : 'sUp', dnKey = internal ? 'iDn' : 'sDn';
    const prevUp = hist[upKey]; hist[upKey] = pv.currentLevel;
    const crossover = i > 0 && pv.currentLevel !== null && prevUp !== null && C[i] > pv.currentLevel && C[i - 1] <= prevUp;
    if (crossover && !pv.crossed && extra) {
      const tag = t.bias === -1 ? 'CHoCH' : 'BOS';
      alerts[`${internal ? 'internal' : 'swing'}Bullish${tag}`] = true;
      pv.crossed = true; t.bias = 1;
    }
    pv = internal ? internalLow : swingLow;
    extra = internal ? neq(internalLow.currentLevel, swingLow.currentLevel) && b.bear : true;
    const prevDn = hist[dnKey]; hist[dnKey] = pv.currentLevel;
    const crossunder = i > 0 && pv.currentLevel !== null && prevDn !== null && C[i] < pv.currentLevel && C[i - 1] >= prevDn;
    if (crossunder && !pv.crossed && extra) {
      const tag = t.bias === 1 ? 'CHoCH' : 'BOS';
      alerts[`${internal ? 'internal' : 'swing'}Bearish${tag}`] = true;
      pv.crossed = true; t.bias = -1;
    }
  }

  let lastSignalBar: number | null = null, lastSignalBias = 0;
  const signal: number[] = [], iBreak: number[] = [], sBreak: number[] = [];
  const useInternal = p.smcSignalStructure === 0 || p.smcSignalStructure === 2;
  const useSwing = p.smcSignalStructure === 1 || p.smcSignalStructure === 2;
  const useCHoCH = p.smcSignalTrigger === 2 || p.smcSignalTrigger === 0;
  const useBOS = p.smcSignalTrigger === 1 || p.smcSignalTrigger === 0;
  for (let i = 0; i < k.length; i++) {
    const a: Record<string, boolean> = {};
    getCurrentStructure(i, p.smcSwingLength, false);
    getCurrentStructure(i, p.smcInternalLength, true);
    displayStructure(i, true, a);
    displayStructure(i, false, a);
    const code = (pre: string) =>
      a[`${pre}BearishCHoCH`] ? -2 : a[`${pre}BearishBOS`] ? -1 : a[`${pre}BullishCHoCH`] ? 2 : a[`${pre}BullishBOS`] ? 1 : 0;
    iBreak.push(code('internal')); sBreak.push(code('swing'));
    const bullishBreak = (useInternal && ((useCHoCH && a.internalBullishCHoCH) || (useBOS && a.internalBullishBOS))) ||
      (useSwing && ((useCHoCH && a.swingBullishCHoCH) || (useBOS && a.swingBullishBOS)));
    const bearishBreak = (useInternal && ((useCHoCH && a.internalBearishCHoCH) || (useBOS && a.internalBearishBOS))) ||
      (useSwing && ((useCHoCH && a.swingBearishCHoCH) || (useBOS && a.swingBearishBOS)));
    const cooldownOver = lastSignalBar === null || i - lastSignalBar >= p.smcCooldownBars;
    const buy = !!bullishBreak && cooldownOver && (!p.smcAlternate || lastSignalBias !== 1);
    const sell = !!bearishBreak && cooldownOver && (!p.smcAlternate || lastSignalBias !== -1);
    if (buy) { lastSignalBar = i; lastSignalBias = 1; signal.push(1); }
    else if (sell) { lastSignalBar = i; lastSignalBias = -1; signal.push(-1); }
    else signal.push(0);
  }
  return { signal, iBreak, sBreak };
}

test('V5: ลงทะเบียนสองรหัสผ่านทะเบียน v3 และแสดงเป็นกลุ่มเวอร์ชัน 5', () => {
  assert.deepEqual([...V5_STRATEGY_IDS], ['smc_luxalgo_v5', 'smc_luxalgo_v5_long']);
  for (const id of V5_STRATEGY_IDS) {
    assert.ok(isV5StrategyId(id) && isV3StrategyId(id), `${id} ต้องวิ่งผ่าน pipeline ของ v3`);
    const config = STRATEGIES.find((s) => s.id === id)!;
    assert.equal(config.version, 5);
    assert.equal(config.twoWay, true);
    assert.equal(config.defaultOverlay, 'v3.internalHigh');
    assert.equal(validateV3Params(id, v3Defaults(id)), null);
    assert.equal(v3WarmupBars(id), 300);
    assert.ok(!('allowLong' in v3Defaults(id)), 'ทิศทางต้องมาจากรหัสกลยุทธ์');
  }
  assert.deepEqual(V5_REGISTRY.smc_luxalgo_v5.direction, { allowLong: 1, allowShort: 1 });
  assert.deepEqual(V5_REGISTRY.smc_luxalgo_v5_long.direction, { allowLong: 1, allowShort: 0 });
  // ค่าตั้งต้นต้องตรงกับ input ของ Pine
  assert.equal(SMC_LUXALGO_V5_DEFAULTS.smcSwingLength, 50);
  assert.equal(SMC_LUXALGO_V5_DEFAULTS.smcInternalLength, 5);
  assert.equal(SMC_LUXALGO_V5_DEFAULTS.smcSignalStructure, 0, 'Pine ค่าตั้งต้น Internal');
  assert.equal(SMC_LUXALGO_V5_DEFAULTS.smcSignalTrigger, 2, 'Pine ค่าตั้งต้น CHoCH');
  assert.equal(SMC_LUXALGO_V5_DEFAULTS.smcCooldownBars, 5);
  assert.equal(SMC_LUXALGO_V5_DEFAULTS.smcAlternate, 1);
  assert.ok(SMC_LUXALGO_RULE_TH.includes('ไม่ได้ผ่านการวัดความได้เปรียบ'), 'กฎต้องบอกข้อจำกัดไว้');
  assert.ok(!isV5StrategyId('horizon_flow_v4_strict'));
});

test('V5: ปฏิเสธพารามิเตอร์ที่อยู่นอกตัวเลือกของ Pine', () => {
  const d = v3Defaults('smc_luxalgo_v5');
  assert.match(validateV3Params('smc_luxalgo_v5', { ...d, smcSwingLength: 5 })!, /อย่างน้อย 10/);
  assert.match(validateV3Params('smc_luxalgo_v5', { ...d, smcSignalStructure: 3 })!, /Internal/);
  assert.match(validateV3Params('smc_luxalgo_v5', { ...d, smcSignalTrigger: 1.5 })!, /CHoCH/);
  assert.match(validateV3Params('smc_luxalgo_v5', { ...d, smcSizePct: 0 })!, /ขนาดไม้/);
  assert.throws(() => smcLuxAlgoV5(fixture, { smcInternalLength: 1 }), /internal/);
  assert.throws(() => smcLuxAlgoV5(fixture, {}, -1), /startIndex/);
  assert.equal(smcLuxAlgoV5([], {}).exposure.length, 0);
});

test('V5: pivot รู้ช้า size แท่งพอดี และ pivot high แรกต้องมาหลัง pivot low (legValue เริ่มที่ขาลง)', () => {
  // ขึ้น 10 แท่ง (ยอดที่แท่ง 9) แล้วลง 10 แท่ง · internal size 3
  const rows: [number, number, number, number][] = [];
  for (let i = 0; i < 10; i++) rows.push([100 + i, 101 + i, 99 + i, 100.5 + i]);
  for (let i = 0; i < 10; i++) rows.push([109 - i, 110 - i - 1.5, 108 - i - 1.5, 108.5 - i - 1.5]);
  const k = ohlc(rows);
  const r = smcLuxAlgoV5(k, { smcInternalLength: 3, smcSwingLength: 10 });
  // แท่ง 3: low[0] ต่ำกว่า 3 แท่งหลัง → leg ขาขึ้น → pivot low = low ของแท่ง 0
  assert.equal(r.internalLow[2], null);
  assert.equal(r.internalLow[3], 99);
  // ยอดที่แท่ง 9 ต้องรู้ที่แท่ง 12 ไม่ใช่ก่อนหน้านั้น
  assert.equal(r.internalHigh[11], null);
  assert.equal(r.internalHigh[12], 110);
});

test('V5: ป้าย BUY/SELL และโครงสร้างตรงกับแบบจำลอง Pine ทุกแท่งในทุกชุดตัวเลือก', () => {
  let labels = 0;
  const base = { ...SMC_LUXALGO_V5_DEFAULTS };
  const combos: (typeof base)[] = [];
  for (const smcSignalStructure of [0, 1, 2])
    for (const smcSignalTrigger of [0, 1, 2])
      for (const smcConfluenceFilter of [0, 1])
        for (const smcAlternate of [0, 1])
          for (const smcCooldownBars of [0, 5])
            combos.push({ ...base, smcSignalStructure, smcSignalTrigger, smcConfluenceFilter, smcAlternate, smcCooldownBars });
  combos.push({ ...base, smcSwingLength: 10, smcInternalLength: 3 }, { ...base, smcSwingLength: 20, smcInternalLength: 2, smcSignalTrigger: 0 });
  for (const p of combos) {
    const ref = pineReference(fixture, p);
    const r = smcLuxAlgoV5(fixture, p);
    const tag = JSON.stringify(p);
    assert.deepEqual(r.internalBreak, ref.iBreak, `internal structure ${tag}`);
    assert.deepEqual(r.swingBreak, ref.sBreak, `swing structure ${tag}`);
    assert.deepEqual(r.smcSignal, ref.signal, `ป้าย BUY/SELL ${tag}`);
    labels += ref.signal.filter((x) => x !== 0).length;
  }
  assert.ok(labels > 500, `ต้องมีป้ายพอให้การเทียบมีความหมาย (ได้ ${labels})`);
});

test('V5: โครงสร้างเกิดจากการตัดระดับจริง ป้ายเคารพ trigger/cooldown/สลับฝั่ง', () => {
  const r = smcLuxAlgoV5(fixture);
  const c = fixture.map((x) => +x.close);
  let lastSignal: number | null = null, lastBias = 0, checked = 0;
  for (let i = 1; i < fixture.length; i++) {
    const b = r.internalBreak[i];
    if (b > 0) {
      assert.ok(c[i] > r.internalHigh[i]! && c[i - 1] <= r.internalHigh[i - 1]!, `แท่ง ${i}: ขาขึ้นต้องปิดตัดเหนือ pivot high`);
      assert.equal(b === 2, r.internalTrend[i - 1] === -1, `แท่ง ${i}: CHoCH ↔ เทรนด์เดิมเป็นขาลง`);
      checked++;
    } else if (b < 0) {
      assert.ok(c[i] < r.internalLow[i]! && c[i - 1] >= r.internalLow[i - 1]!, `แท่ง ${i}: ขาลงต้องปิดตัดใต้ pivot low`);
      assert.equal(b === -2, r.internalTrend[i - 1] === 1, `แท่ง ${i}: CHoCH ↔ เทรนด์เดิมเป็นขาขึ้น`);
      checked++;
    }
    const s = r.smcSignal[i];
    if (s !== 0) {
      assert.equal(r.internalBreak[i], s * 2, `แท่ง ${i}: ค่าตั้งต้นยิงเฉพาะ internal CHoCH`);
      if (lastSignal !== null) assert.ok(i - lastSignal >= 5, `แท่ง ${i}: ป้ายห่างกันน้อยกว่า cooldown`);
      assert.notEqual(s, lastBias, `แท่ง ${i}: ป้ายซ้ำฝั่ง`);
      lastSignal = i; lastBias = s;
    }
  }
  assert.ok(checked > 20, `ต้องมีโครงสร้างพอให้ตรวจ (ได้ ${checked})`);
  // pivot เดิมตัดได้ครั้งเดียว: โครงสร้างขาขึ้นสองครั้งต้องมี pivot high ใหม่คั่น
  let lastUpLevel: number | null = null;
  r.internalBreak.forEach((b, i) => {
    if (b <= 0) return;
    assert.notEqual(r.internalHigh[i], lastUpLevel, `แท่ง ${i}: ตัด pivot เดิมซ้ำ`);
    lastUpLevel = r.internalHigh[i];
  });
});

test('V5: ไม่ใช้ข้อมูลในอนาคต — คำนวณจากข้อมูลบางส่วนต้องได้ผลเหมือนข้อมูลเต็มทุกแท่งที่มีร่วมกัน', () => {
  for (const id of V5_STRATEGY_IDS) {
    const full = run(id);
    for (const cut of [300, 517, 801]) {
      const part = run(id, fixture.slice(0, cut));
      for (let i = 0; i < cut; i++) {
        assert.equal(part.exposure[i], full.exposure[i], `${id} แท่ง ${i} (ตัดที่ ${cut}): exposure`);
        assert.equal(part.signal[i], full.signal[i], `${id} แท่ง ${i} (ตัดที่ ${cut}): signal`);
        assert.equal(part.smcSignal[i], full.smcSignal[i], `${id} แท่ง ${i} (ตัดที่ ${cut}): smcSignal`);
      }
    }
  }
});

test('V5: สถานะตามป้าย — สองทางกลับข้างทุกป้าย ซื้ออย่างเดียวไม่เคยถือขาย และเริ่มว่างที่ startIndex', () => {
  const start = 400;
  const two = run('smc_luxalgo_v5', fixture, {}, start);
  const long = run('smc_luxalgo_v5_long', fixture, {}, start);
  // ป้ายของอินดิเคเตอร์เป็นอิสระจากรหัสและจุดเริ่ม (เหมือน TradingView)
  assert.deepEqual(two.smcSignal, run('smc_luxalgo_v5').smcSignal);
  assert.deepEqual(long.smcSignal, two.smcSignal);
  let last = 0, flips = 0;
  for (let i = 0; i < fixture.length; i++) {
    if (i < start) {
      assert.equal(two.exposure[i], 0); assert.equal(long.exposure[i], 0);
      assert.equal(two.signal[i], null);
      continue;
    }
    if (two.smcSignal[i] !== 0) last = two.smcSignal[i];
    assert.equal(two.exposure[i], last, `แท่ง ${i}: สองทางต้องถือตามป้ายล่าสุด`);
    assert.equal(long.exposure[i], last === 1 ? 1 : 0, `แท่ง ${i}: ซื้ออย่างเดียวถือเฉพาะหลัง BUY`);
    if (two.signal[i] === 'SHORT' || (two.signal[i] === 'BUY' && two.exposure[i - 1] === -1)) flips++;
  }
  assert.ok(flips >= 5, `ต้องมีการกลับข้างพอให้ตรวจ (ได้ ${flips})`);
  assert.ok(long.signal.every((s) => s !== 'SHORT' && s !== 'COVER'), 'ซื้ออย่างเดียวต้องไม่มีสัญญาณฝั่งขาย');
  // สตรีมสัญญาณที่เว็บ/บอทเห็นต้องไม่ถูกกฎสลับเปิด–ปิดตัดทิ้ง (ตรงกับ exposure ที่จำลองจริง)
  for (const [id, r] of [['smc_luxalgo_v5', two], ['smc_luxalgo_v5_long', long]] as const) {
    const shown = STRATEGY_FNS[id](fixture, { v3: r } as never, v3Defaults(id));
    assert.deepEqual(shown, r.signal.map((s) => s ?? 'HOLD'), `${id}: สัญญาณที่แสดงต้องตรงกับที่ลงมือ`);
  }
});

test('V5: วิ่งผ่าน analyze ของเว็บได้ครบ และส่งคอลัมน์โครงสร้างให้กราฟ/Export', () => {
  for (const id of V5_STRATEGY_IDS) {
    const out = analyze(fixture, 350, id, v3Defaults(id), 0.05, 0.03, 'both', true, true, 0.01);
    assert.equal(out.simulations.length, 2);
    assert.ok(out.simulations[0].trades.length > 0, `${id} ต้องมีไม้ใน backtest`);
    for (const col of ['v3.internalHigh', 'v3.internalLow', 'v3.swingHigh', 'v3.swingLow', 'v3.smcSignal', 'v3.internalBreak'])
      assert.ok(col in out.indicators, `${id}: ขาดคอลัมน์ ${col}`);
  }
  const long = analyze(fixture, 350, 'smc_luxalgo_v5_long', v3Defaults('smc_luxalgo_v5_long'), 0.1, 0.05, 'next_open', true, true, 0);
  assert.ok(long.simulations[0].trades.every((t) => (t.direction ?? 'long') === 'long'), 'ซื้ออย่างเดียวต้องไม่มีดีลขาย');
});
