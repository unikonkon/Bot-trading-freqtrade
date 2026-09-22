import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  V3_PARAM_META, V3_STRATEGY_IDS, V3_REGISTRY, v3RuleFor, computeV3,
  detectTimeframeMinutes, isV3StrategyId,
  v3Defaults, v3Direction, v3WarmupBars, validateV3Params,
} from '../../lib/indicators-v3-core';
import { parseKline, type KlineData } from '../../lib/types/kline';
import { STRATEGIES, STRATEGY_FNS, computeSignals, computeStrategyIndicators } from '../../lib/backtest';
import { simulateExposure, analyze, INDICATOR_KEYS } from './engine';
import { RULES, INDICATOR_KEY } from './export-calculations';
import { validate, warmupBars } from './data';

const fixture: KlineData[] = JSON.parse(
  fs.readFileSync(new URL('../../freqtrade/fixtures/BTCUSDT-1h.json', import.meta.url), 'utf8'),
).map(parseKline);

/** สร้างแท่งเทียมที่คุมราคาและระยะเวลาได้ เพื่อทดสอบเลขของตัวจำลองแบบตรวจมือได้ */
function bars(prices: number[], stepMs = 3600000, startMs = 0): KlineData[] {
  return prices.map((p, i) =>
    parseKline([startMs + i * stepMs, String(p), String(p + 1), String(p - 1), String(p), '100',
      startMs + (i + 1) * stepMs - 1, '1000', 10, '50', '500']));
}

test('V3 detects the timeframe from the bars themselves', () => {
  assert.equal(detectTimeframeMinutes(bars([1, 2, 3, 4], 60000)), 1);
  assert.equal(detectTimeframeMinutes(bars([1, 2, 3, 4], 5 * 60000)), 5);
  assert.equal(detectTimeframeMinutes(bars([1, 2, 3, 4], 15 * 60000)), 15);
  // ช่องว่างของข้อมูลหนึ่งจุดต้องไม่ทำให้อ่านผิด เพราะใช้ค่ามัธยฐาน
  const gapped = bars([1, 2, 3, 4, 5, 6, 7], 60000);
  gapped[4] = { ...gapped[4], openTime: gapped[4].openTime + 10 * 60000 };
  assert.equal(detectTimeframeMinutes(gapped), 1);
  assert.equal(detectTimeframeMinutes([]), 0, 'ข้อมูลไม่พอต้องคืน 0 ไม่ใช่เดา');
});

test('V3 signals stay causal: future candles cannot change the past', () => {
  for (const id of V3_STRATEGY_IDS) {
    // ย่อหน้าต่างของ OrderFlow ให้สั้นพอที่ fixture รายชั่วโมงจะให้สัญญาณจริง
    // ไม่งั้นทุกแท่งจะเป็น HOLD แล้วเทสต์จะผ่านโดยไม่ได้ตรวจอะไร
    const params = { ...v3Defaults(id), flowLookbackDays: 0.5, flowDebiasDays: 3 };
    const full = computeSignals(fixture, id, params, { confirmedPivots: true, startIndex: 0 });
    for (const cut of [400, 700]) {
      const prefix = computeSignals(fixture.slice(0, cut), id, params, { confirmedPivots: true, startIndex: 0 });
      assert.deepEqual(prefix, full.slice(0, cut), `${id}: ข้อมูลแท่งใหม่เปลี่ยนสัญญาณของอดีต`);
    }
    assert.ok(full.some((x) => x !== 'HOLD'), `${id}: เทสต์นี้ต้องมีสัญญาณจริงจึงจะตรวจอะไรได้`);
  }
});

test('V3 two-way simulator: long and short arithmetic, sizing and funding', () => {
  // exposure[i] = การตัดสินใจ ณ ปิดแท่ง i ซึ่งไปลงมือที่ราคาเปิดแท่ง i+1
  // ขาขึ้น 100 → 110 ถือครึ่งพอร์ต ไม่มีค่าธรรมเนียม กำไรต้องเป็นครึ่งหนึ่งของ 10%
  const up = bars([100, 100, 110, 110]);
  const longSim = simulateExposure(up, [0.5, 0.5, 0, 0], 0, 0, 0, 0, 'next_open');
  assert.equal(longSim.totalTrades, 1);
  assert.ok(Math.abs(longSim.returnPct - 5) < 1e-9, `ซื้อครึ่งพอร์ตในขาขึ้น 10% ต้องได้ 5% แต่ได้ ${longSim.returnPct}`);
  assert.equal(longSim.trades[0].direction, 'long');
  assert.equal(longSim.trades[0].size, 0.5);
  // ขาลง 100 → 90 ฝั่งขายต้องได้กำไร ซึ่งเอนจิน Spot เดิมทำไม่ได้
  const down = bars([100, 100, 90, 90]);
  const shortSim = simulateExposure(down, [-1, -1, 0, 0], 0, 0, 0, 0, 'next_open');
  assert.equal(shortSim.totalTrades, 1);
  assert.equal(shortSim.trades[0].direction, 'short');
  assert.ok(Math.abs(shortSim.returnPct - 10) < 1e-9, `ขายเต็มพอร์ตในขาลง 10% ต้องได้ 10% แต่ได้ ${shortSim.returnPct}`);
  // ค่าธรรมเนียมหักสองขา: เข้า 100 ออก 100 ต้องขาดทุนเท่ากับ fee ไป-กลับ
  const flat = bars([100, 100, 100, 100]);
  const fees = simulateExposure(flat, [1, 1, 0, 0], 0, 0.1, 0, 0, 'next_open');
  assert.ok(Math.abs(fees.returnPct + 0.2) < 1e-6, `fee 0.1% สองขาต้องเสีย 0.2% แต่ได้ ${fees.returnPct}`);
  // funding: ราคานิ่งสนิท ไม่มี fee/slippage ผลต่างจึงมาจากต้นทุนการถืออย่างเดียว
  // ถือข้ามเวลา 08:00 UTC หนึ่งครั้ง (แท่งเริ่ม 01:00 ถือจากแท่ง 1 ถึงแท่ง 11)
  const held = bars(new Array(14).fill(100), 3600000, Date.UTC(2026, 0, 1, 1));
  const exposureHeld = held.map((_, i) => (i <= 10 ? -1 : 0));
  const noFunding = simulateExposure(held, exposureHeld, 0, 0, 0, 0, 'next_open');
  const withFunding = simulateExposure(held, exposureHeld, 0, 0, 0, 0.01, 'next_open');
  assert.ok(Math.abs(noFunding.returnPct) < 1e-9, 'ตั้ง funding เป็น 0 และราคานิ่ง ต้องไม่กำไรไม่ขาดทุน');
  assert.ok(withFunding.returnPct < noFunding.returnPct, 'ถือข้ามเวลา funding ต้องเสียต้นทุนเพิ่ม');
});

test('V3 simulator closes an open position at the end and never exceeds full exposure', () => {
  const k = bars([100, 100, 105, 110, 115]);
  const sim = simulateExposure(k, [0, 1, 1, 1, 1], 0, 0, 0, 0, 'next_open');
  assert.equal(sim.totalTrades, 1);
  assert.equal(sim.trades[0].reason, 'ปิดเมื่อจบข้อมูล');
  assert.equal(sim.equity.length, k.length);
  // exposure ที่เกิน 1 ต้องถูกตัดเหลือ 1 ไม่ใช่เปิด leverage
  const capped = simulateExposure(bars([100, 100, 110, 110]), [5, 5, 0, 0], 0, 0, 0, 0, 'next_open');
  assert.ok(Math.abs(capped.returnPct - 10) < 1e-9, 'exposure > 1 ต้องถูกจำกัดที่เต็มพอร์ต');
});

test('V3 respects warmup: no position is carried across startIndex', () => {
  const start = 300;
  const flow = computeV3('orderflow_v3', fixture, { flowLookbackDays: 0.5, flowDebiasDays: 3 }, start);
  assert.ok(flow.exposure.slice(0, start).every((e) => e === 0), 'OrderFlow ต้องไม่มีสถานะก่อน startIndex');
  const a = analyze(fixture, start, 'orderflow_v3', v3Defaults('orderflow_v3'), 0.1, 0.05, 'both', true, false, 0.01);
  for (const sim of a.simulations) {
    assert.equal(sim.equity.length, fixture.length - start);
    assert.ok(sim.trades.every((t) => t.entryIdx >= start));
  }
  assert.equal(a.simulations.length, 2, 'โหมด both ต้องได้ทั้ง next_open และ legacy');
});

test('V3 is wired into every registry the web UI depends on', () => {
  assert.equal(STRATEGIES.filter((s) => s.version === 3).length, V3_STRATEGY_IDS.length);
  for (const id of V3_STRATEGY_IDS) {
    assert.ok(isV3StrategyId(id));
    const config = STRATEGIES.find((s) => s.id === id);
    assert.ok(config, `${id} ต้องอยู่ใน STRATEGIES`);
    assert.equal(config.version, 3);
    assert.equal(config.twoWay, true, 'ต้องประกาศว่าเป็นกลยุทธ์สองทาง ไม่งั้นจะถูกจำลองด้วยเอนจิน Spot');
    assert.ok(STRATEGY_FNS[id] && config.paramMeta && config.defaultOverlay);
    assert.equal(INDICATOR_KEYS[id], 'v3');
    assert.equal(INDICATOR_KEY[id], 'v3');
    assert.equal(RULES[id], v3RuleFor(id), `${id} ต้องมีกฎของตัวเองในไฟล์ Export`);
    assert.ok(RULES[id].length > 200, `${id} ต้องมีกฎที่อธิบายได้จริง`);
    // ทุกพารามิเตอร์ต้องมีป้ายและขอบเขต และค่าเริ่มต้นต้องอยู่ในขอบเขตของตัวเอง
    for (const [key, value] of Object.entries(v3Defaults(id))) {
      const meta = V3_PARAM_META[key];
      assert.ok(meta, `ขาด V3_PARAM_META สำหรับ ${key}`);
      assert.ok(value >= meta.min && value <= meta.max, `${key} = ${value} อยู่นอก ${meta.min}–${meta.max}`);
      if (meta.integer) assert.ok(Number.isInteger(value), `${key} ต้องเป็นจำนวนเต็ม`);
    }
    assert.equal(validateV3Params(id, v3Defaults(id)), null);
    assert.ok(!('allowLong' in v3Defaults(id)), 'ทิศทางต้องมาจากรหัสกลยุทธ์ ไม่ใช่พารามิเตอร์ที่ผู้ใช้แก้ได้');
    // ทุกช่องของ V3Definition ต้องถูกกรอก เพราะทะเบียนนี้เป็นจุดต่อขยายเดียว
    const def = V3_REGISTRY[id];
    assert.ok(def.family && def.name && def.th && def.en && def.group && def.overlay);
    assert.ok(typeof def.compute === 'function' && typeof def.warmupBars === 'function' && typeof def.validate === 'function');
    assert.deepEqual(v3Direction(id), def.direction);
    assert.ok(def.direction.allowLong >= 0.5 || def.direction.allowShort >= 0.5, `${id} ต้องเปิดอย่างน้อยหนึ่งทิศ`);
    assert.equal(config.name, def.name);
    assert.equal(config.group, def.group);
    assert.equal(config.defaultOverlay, def.overlay);
  }
  // ทิศทางต้องครบทั้งสามแบบ เพื่อให้เทียบในตารางผลรอบเดียวได้ว่าฝั่งไหนสร้างผลตอบแทน
  const shapes = V3_STRATEGY_IDS.map((id) => `${v3Direction(id).allowLong}${v3Direction(id).allowShort}`);
  assert.deepEqual([...shapes].sort(), ['01', '10', '11']);
  // อินดิเคเตอร์ v3 ต้องถูกคำนวณเฉพาะเมื่อเลือกกลยุทธ์ v3
  assert.ok(computeStrategyIndicators(fixture, 'orderflow_v3', {}, { lazyIndicators: true }).v3);
  assert.equal(computeStrategyIndicators(fixture, 'rsi', { period: 14 }, { lazyIndicators: true }).v3, undefined);
});

test('V3 request validation covers funding, bounds and relationships', () => {
  const base = {
    symbol: 'BTCUSDT', interval: '5m', intervals: ['5m'], source: 'latest', limit: 500,
    strategies: ['orderflow_v3'], selected: 'orderflow_v3', fee: 0.1, slippage: 0.05, mode: 'next_open',
  };
  assert.equal(validate({ ...base, params: {} }).funding, 0.01, 'ค่า funding เริ่มต้นต้องถูกตั้งให้เอง');
  assert.equal(validate({ ...base, funding: 0, params: {} }).funding, 0);
  assert.throws(() => validate({ ...base, funding: 5, params: {} }), /Funding/);
  assert.equal(validate({ ...base, params: { orderflow_v3: { flowBand: 0.02 } } }).params.orderflow_v3.flowBand, 0.02);
  assert.throws(() => validate({ ...base, params: { orderflow_v3: { fastPeriod: 80, trendPeriod: 55 } } }), /EMA/);
  // ความสัมพันธ์ระหว่างพารามิเตอร์ (ตรวจใน validateV3Params)
  assert.throws(() => validate({ ...base, params: { orderflow_v3: { flowLookbackDays: 50, flowDebiasDays: 20 } } }), /ช่วงสะสม/);
  // ขอบเขตของค่าเดี่ยว (ตรวจจาก V3_PARAM_META ก่อนถึง validateV3Params)
  assert.throws(() => validate({ ...base, params: { orderflow_v3: { flowBand: 5 } } }), /flowBand/);
  assert.throws(() => validate({ ...base, params: { orderflow_v3: { flowLookbackDays: 200 } } }), /flowLookbackDays/);
  const cfg = validate({ ...base, params: {} });
  assert.equal(warmupBars(cfg), v3WarmupBars('orderflow_v3', v3Defaults('orderflow_v3')));
  assert.ok(warmupBars(cfg) >= 300);
});
