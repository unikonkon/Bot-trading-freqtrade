import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  V4_REGISTRY, V4_STRATEGY_IDS, isV4StrategyId, horizonFlowV4, HORIZON_FLOW_RULE_TH,
  type HorizonFlowV4Result, type V4StrategyId,
} from '../../lib/indicators-v4-inYutube';
import { computeV3, v3Defaults, v3WarmupBars, validateV3Params, isV3StrategyId } from '../../lib/indicators-v3';
import { parseKline, type KlineData } from '../../lib/types/kline';
import { STRATEGIES } from '../../lib/backtest';
import { simulateExposure, analyze } from './engine';

const fixture: KlineData[] = JSON.parse(
  fs.readFileSync(new URL('../../freqtrade/fixtures/BTCUSDT-1h.json', import.meta.url), 'utf8'),
).map(parseKline);
const run = (id: V4StrategyId, k = fixture, params: Record<string, number> = {}) =>
  computeV3(id, k, params, 0) as HorizonFlowV4Result;

/** แท่งที่คุม OHLC เองได้ทุกค่า เพื่อทดสอบการปิดที่ระดับราคาแบบตรวจมือได้ */
function ohlc(rows: [number, number, number, number][], stepMs = 3600000): KlineData[] {
  return rows.map(([o, h, l, c], i) =>
    parseKline([i * stepMs, String(o), String(h), String(l), String(c), '100',
      (i + 1) * stepMs - 1, '1000', 10, '50', '500']));
}

test('V4: ลงทะเบียน 3 รหัสผ่านทะเบียน v3 และแสดงเป็นกลุ่มเวอร์ชัน 4', () => {
  assert.deepEqual([...V4_STRATEGY_IDS].sort(), ['horizon_flow_v4', 'horizon_flow_v4_strict', 'horizon_flow_v4_trail']);
  for (const id of V4_STRATEGY_IDS) {
    assert.ok(isV4StrategyId(id) && isV3StrategyId(id), `${id} ต้องวิ่งผ่าน pipeline ของ v3`);
    const config = STRATEGIES.find((s) => s.id === id)!;
    assert.equal(config.version, 4);
    assert.equal(config.twoWay, true);
    assert.equal(config.defaultOverlay, 'v3.trendEMA');
    assert.equal(validateV3Params(id, v3Defaults(id)), null);
    // EMA100 ต้องการราว 3 เท่าของ period — ไม่ใช่ค่าสำรอง 2,000 แท่งของตระกูลที่นับเป็นวัน
    assert.equal(v3WarmupBars(id), 322);
  }
  assert.ok(HORIZON_FLOW_RULE_TH.includes('เป็นไปไม่ได้บน 1m'), 'กฎต้องบอกข้อจำกัดเรื่องค่าธรรมเนียมไว้');
  assert.ok(!isV4StrategyId('orderflow_v3'));
});

test('V4: แต่ละรูปแบบต่างจากตัวตามคลิปเฉพาะพารามิเตอร์ที่ประกาศไว้', () => {
  const base = V4_REGISTRY.horizon_flow_v4.defaults;
  const diff = (id: V4StrategyId) =>
    Object.keys(base).filter((key) => V4_REGISTRY[id].defaults[key] !== base[key]).sort();
  // strict แตะเฉพาะจุดเข้า · trail แตะเฉพาะจุดออก — จึงเทียบผลกันได้ว่าต่างเพราะอะไร
  assert.deepEqual(diff('horizon_flow_v4_strict'), ['hfMinStopCostMult', 'hfRequireCross', 'hfSlopeBars']);
  assert.deepEqual(diff('horizon_flow_v4_trail'), ['hfBreakevenR', 'hfExitOnFlip', 'hfTargetR', 'hfTrailAtr']);
});

test('V4: ปฏิเสธพารามิเตอร์ที่ทำให้ไม่มีทางออกหรือโซนกลับด้าน', () => {
  const d = v3Defaults('horizon_flow_v4');
  assert.match(validateV3Params('horizon_flow_v4', { ...d, hfTargetR: 0 })!, /ไม่มีทางออกฝั่งกำไร/);
  assert.match(validateV3Params('horizon_flow_v4', { ...d, hfStochOversold: 60 })!, /oversold < เส้นกลาง/);
  assert.match(validateV3Params('horizon_flow_v4', { ...d, hfStopAtr: 0 })!, /ต้องมี SL/);
  assert.throws(() => horizonFlowV4(fixture, { hfTargetR: 0 }), /ไม่มีทางออกฝั่งกำไร/);
});

test('V4: ไม่ใช้ข้อมูลในอนาคต — คำนวณจากข้อมูลบางส่วนต้องได้ผลเหมือนข้อมูลเต็มทุกแท่งที่มีร่วมกัน', () => {
  for (const id of V4_STRATEGY_IDS) {
    const full = run(id);
    for (const cut of [500, 731, 900]) {
      const part = run(id, fixture.slice(0, cut));
      for (let i = 0; i < cut; i++) {
        assert.equal(part.exposure[i], full.exposure[i], `${id} แท่ง ${i} (ตัดที่ ${cut}): exposure`);
        assert.equal(part.signal[i], full.signal[i], `${id} แท่ง ${i} (ตัดที่ ${cut}): signal`);
        assert.equal(part.exitFill[i], full.exitFill[i], `${id} แท่ง ${i} (ตัดที่ ${cut}): exitFill`);
      }
    }
  }
});

test('V4: สัญญาณสลับเปิด–ปิดเสมอ และเข้าเฉพาะฝั่งที่ชั้นทิศทางยืนยันแล้ว', () => {
  for (const id of V4_STRATEGY_IDS) {
    const r = run(id);
    let open: 'BUY' | 'SHORT' | null = null, entries = 0;
    r.signal.forEach((s, i) => {
      if (s === 'BUY' || s === 'SHORT') {
        assert.equal(open, null, `${id} แท่ง ${i}: เปิดซ้อนทั้งที่ยังถือไม้อยู่`);
        assert.equal(r.regimeDir[i], s === 'BUY' ? 1 : -1, `${id} แท่ง ${i}: เข้าสวนชั้นทิศทาง`);
        open = s; entries++;
      } else if (s === 'SELL' || s === 'COVER') {
        assert.equal(open, s === 'SELL' ? 'BUY' : 'SHORT', `${id} แท่ง ${i}: ปิดไม้ที่ไม่ได้ถือ`);
        open = null;
      }
    });
    assert.ok(entries >= 5, `${id} ต้องมีไม้บน fixture พอให้ตรวจ (ได้ ${entries})`);
  }
});

test('V4: ไม่หักต้นทุน ไม้ตามคลิปต้องได้ +2R หรือ −1R พอดี (ปิดที่ราคา SL/TP จริง)', () => {
  const r = run('horizon_flow_v4');
  const s = simulateExposure(fixture, r.exposure, 0, 0, 0, 0, 'next_open', { price: r.exitFill, reason: r.reason });
  assert.ok(s.trades.length >= 5);
  for (const t of s.trades) {
    if (/เปิดแท่งทะลุ|จบข้อมูล/.test(t.reason)) continue; // gap กับไม้ที่ค้างตอนจบข้อมูลไม่ได้ปิดที่ระดับ
    const R = t.pnlPct / r.riskPct![t.entryIdx]!;
    assert.ok(Math.abs(R - 2) < 1e-6 || Math.abs(R + 1) < 1e-6, `ไม้ที่แท่ง ${t.entryIdx} ได้ ${R}R (${t.reason})`);
  }
});

test('V4: แท่งเดียวแตะทั้ง SL และ TP นับว่าชน SL ก่อน', () => {
  // ไม้ซื้อเข้าที่ 100 เสี่ยง 1% → SL 99, TP 102 · ทดสอบกลไกการปิดด้วย exposure/exitFill ที่กำหนดเอง
  const k = ohlc([[100, 100, 100, 100], [100, 101, 99.5, 100.5], [100.5, 103, 98, 101], [101, 101, 101, 101]]);
  const s = simulateExposure(k, [1, 1, 0, 0], 0, 0, 0, 0, 'next_open',
    { price: [null, null, 99, null], reason: ['', '', 'ออก (ชน SL)', ''] });
  assert.equal(s.trades.length, 1);
  assert.equal(s.trades[0].exitPrice, 99);
  assert.equal(s.trades[0].reason, 'ออก (ชน SL)');
  // ตัวกลยุทธ์เองต้องเลือก SL เมื่อแท่งแตะทั้งสองระดับ — SL/TP แคบมากเพื่อให้เกิดกรณีนี้จริงบน fixture
  const r = horizonFlowV4(fixture, { hfStopAtr: 0.2, hfTargetR: 1 });
  let both = 0;
  r.exitFill.forEach((px, i) => {
    if (px === null || /เปิดแท่งทะลุ/.test(r.reason[i])) return;
    const st = r.stop![i]!, tp = r.target![i]!;
    const lo = Number(fixture[i].low), hi = Number(fixture[i].high);
    if (lo <= Math.min(st, tp) && hi >= Math.max(st, tp)) {
      both++;
      assert.equal(px, st, `แท่ง ${i} แตะทั้งคู่ต้องปิดที่ SL: ${r.reason[i]}`);
    }
  });
  assert.ok(both > 0, 'ต้องเกิดกรณีแตะทั้งคู่อย่างน้อยหนึ่งครั้ง ไม่งั้นเทสต์นี้ไม่ได้ตรวจอะไร');
});

test('V4: เปิดแท่งกระโดดข้าม SL ปิดที่ราคาเปิด ไม่ใช่ที่ SL (ขาดทุนเกิน 1R ได้เหมือนตลาดจริง)', () => {
  // ขาขึ้น → ย่อ 2 แท่งจน Stoch < 20 (ยังไม่ครบ 3 แท่งจึงไม่เปลี่ยนฝั่ง) → แท่งกลืนกิน → เปิดไม้ → gap ลง
  const rows: [number, number, number, number][] = [];
  for (let i = 0; i < 10; i++) rows.push([100 + i, 101.5 + i, 99.5 + i, 101 + i]);
  rows.push([110, 110.2, 106, 106.5], [106.5, 106.8, 104, 104.2]);
  rows.push([104.1, 107, 103.9, 106.8]);
  rows.push([106.9, 107.5, 106, 107]);
  rows.push([100, 100.5, 99, 100]);
  rows.push([100, 101, 99.5, 100.5]);
  const k = ohlc(rows);
  const r = horizonFlowV4(k, { hfEmaPeriod: 5, hfStochLength: 5, hfStochSmoothK: 1, hfStochSmoothD: 1, hfAtrPeriod: 3, hfStopAtr: 1 });
  assert.equal(r.signal[12], 'BUY', r.reason[12]);
  assert.match(r.reason[12], /แท่งกลืนกินขาขึ้น/);
  assert.equal(r.regimeDir[11], 1, 'ย่อแค่ 2 แท่งต้องยังค้างฝั่งซื้อ');
  assert.equal(r.signal[14], 'SELL');
  assert.equal(r.exitFill[14], 100, 'ต้องปิดที่ราคาเปิดของแท่งที่กระโดดข้าม SL');
  assert.ok(r.stop![14]! > 100);
  assert.match(r.reason[14], /เปิดแท่งทะลุ SL/);
  const s = simulateExposure(k, r.exposure, 0, 0, 0, 0, 'next_open', { price: r.exitFill, reason: r.reason });
  assert.equal(s.trades.length, 1);
  assert.equal(s.trades[0].entryPrice, 106.9);
  assert.equal(s.trades[0].exitPrice, 100);
});

test('V4 engine: levelExit เป็น opt-in — ไม่ส่งมาต้องได้ผลเหมือนเดิมทุกตัวเลข และหัก slippage เหมือนการปิดทั่วไป', () => {
  const r = run('horizon_flow_v4');
  for (const mode of ['next_open', 'legacy'] as const) {
    const before = simulateExposure(fixture, r.exposure, 0, 0.1, 0.05, 0.01, mode);
    const undef = simulateExposure(fixture, r.exposure, 0, 0.1, 0.05, 0.01, mode, undefined);
    assert.deepEqual(undef, before);
  }
  const k = ohlc([[100, 100, 100, 100], [100, 101, 99.5, 100.5], [100.5, 102.5, 100, 101], [101, 101, 101, 101]]);
  const s = simulateExposure(k, [1, 1, 0, 0], 0, 0, 1, 0, 'next_open',
    { price: [null, null, 102, null], reason: ['', '', 'ถึง TP', ''] });
  assert.equal(s.trades[0].exitPrice, 102 * 0.99, 'ปิดฝั่งขายต้องหัก slippage 1%');
  // legacy: การแตะระดับเกิดก่อนคำสั่งที่ราคาปิดของแท่งเดียวกัน
  const legacy = simulateExposure(k, [1, 1, 0, 0], 0, 0, 0, 0, 'legacy',
    { price: [null, null, 102, null], reason: ['', '', 'ถึง TP', ''] });
  assert.equal(legacy.trades[0].exitPrice, 102);
  assert.equal(legacy.trades[0].reason, 'ถึง TP');
});

test('V4 trail: ไม่มี TP ตายตัว และ SL ขยับได้ทางเดียวคือทางที่ล็อกกำไร', () => {
  const r = run('horizon_flow_v4_trail');
  let prev: number | null = null, dir = 0, checked = 0;
  for (let i = 0; i < fixture.length; i++) {
    const st = r.stop![i];
    if (r.signal[i] === 'BUY' || r.signal[i] === 'SHORT') { prev = null; dir = 0; continue; }
    if (st === null) { prev = null; continue; }
    assert.equal(r.target![i], null, `แท่ง ${i}: trail ต้องไม่มี TP`);
    dir = r.direction[i] !== 0 ? r.direction[i] : dir;
    if (prev !== null && dir !== 0) { assert.ok(dir * (st - prev) >= 0, `แท่ง ${i}: SL ถอยหลัง ${prev} → ${st}`); checked++; }
    prev = st;
  }
  assert.ok(checked > 20, 'ต้องมีแท่งที่ถือไม้พอให้ตรวจ');
});

test('V4: วิ่งผ่าน analyze ของเว็บได้ครบ และไม้ที่ปิดที่ระดับใช้เหตุผลของกลยุทธ์', () => {
  for (const id of V4_STRATEGY_IDS) {
    const out = analyze(fixture, 350, id, v3Defaults(id), 0.05, 0.03, 'both', true, true, 0.01);
    assert.equal(out.simulations.length, 2);
    const trades = out.simulations[0].trades;
    assert.ok(trades.length > 0, `${id} ต้องมีไม้ใน backtest`);
    assert.ok(trades.some((t) => t.reason.startsWith('ออก (')), `${id}: ไม้ที่ชน SL/TP ต้องใช้เหตุผลจากกลยุทธ์`);
    assert.ok('v3.stochK' in out.indicators && 'v3.trendEMA' in out.indicators, 'ต้องส่งคอลัมน์ Stoch และ EMA ให้กราฟ/Export');
  }
});
