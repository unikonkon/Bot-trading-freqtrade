import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  V3_PARAM_META, V3_STRATEGY_IDS, V3_REGISTRY, v3RuleFor, computeV3,
  detectTimeframeMinutes, isV3StrategyId,
  v3Defaults, v3Direction, v3WarmupBars, validateV3Params,
  ORDER_FLOW_V3_DEFAULTS, ORDER_FLOW_RULE_TH, orderFlowV3,
  orderFlowImbalance, removeOwnMean, tradePlanV3, flowGateV3, FLOW_GATE_V3_DEFAULTS, type V3Result,
} from '../../lib/indicators-v3';
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
    assert.ok(def.name && def.th && def.en && def.group && def.overlay);
    assert.ok(typeof def.compute === 'function' && typeof def.warmupBars === 'function' && typeof def.validate === 'function');
    assert.deepEqual(v3Direction(id), def.direction);
    assert.ok(def.direction.allowLong >= 0.5 || def.direction.allowShort >= 0.5, `${id} ต้องเปิดอย่างน้อยหนึ่งทิศ`);
    assert.equal(config.name, def.name);
    assert.equal(config.group, def.group);
    assert.equal(config.defaultOverlay, def.overlay);
  }
  // ทิศทางต้องครบทั้งสามแบบ เพื่อให้เทียบในตารางผลรอบเดียวได้ว่าฝั่งไหนสร้างผลตอบแทน
  const shapes = new Set(V3_STRATEGY_IDS.map((id) => `${v3Direction(id).allowLong}${v3Direction(id).allowShort}`));
  for (const shape of ['01', '10', '11']) assert.ok(shapes.has(shape), `ขาดรหัสที่เปิดทิศแบบ ${shape}`);
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
  // cfg.interval คือ 5m — แท่งอุ่นเครื่องต้องคิดจาก timeframe จริง ไม่ใช่ค่าคงที่เดิม 2,000
  assert.equal(warmupBars(cfg), v3WarmupBars('orderflow_v3', v3Defaults('orderflow_v3'), 5));
  assert.equal(warmupBars(cfg), 36002, '125 วันที่ 5m = 36,000 แท่ง +2 กันปัดเศษ');
  assert.ok(warmupBars(cfg) >= 300);
});

// ══ ตระกูล OrderFlow ══════════════════════════════════════════

const HOUR = 3600000;

/**
 * สร้างแท่งเทียมที่คุมทั้งราคาและสัดส่วนปริมาณฝั่งซื้อได้
 * `buyShare` = สัดส่วนของปริมาณที่ฝั่งซื้อเป็นผู้เคาะ (0.5 = สมดุล)
 */
function flowBars(prices: number[], buyShare: number[] | number, stepMs = HOUR): KlineData[] {
  const share = (i: number) => (typeof buyShare === 'number' ? buyShare : buyShare[i]);
  return prices.map((p, i) =>
    parseKline([i * stepMs, String(p), String(p + 1), String(p - 1), String(p), '100',
      (i + 1) * stepMs - 1, '1000', 10, String(100 * share(i)), '500']));
}
/** จำนวนแท่งต่อวันของ timeframe ที่ใช้ในเทสต์ */
const perDay = HOUR === 3600000 ? 24 : 0;
const flat = (n: number) => Array.from({ length: n }, () => 100);

test('OrderFlow: แรงซื้อขายสุทธิคำนวณตรงตามนิยามและใช้เฉพาะแท่งที่ปิดแล้ว', () => {
  // ฝั่งซื้อเคาะ 75% ของปริมาณ => 2*0.75 - 1 = +0.5
  const k = flowBars(flat(10), 0.75);
  const x = orderFlowImbalance(k, 4);
  assert.equal(x[2], null, 'ยังสะสมไม่ครบหน้าต่างต้องเป็น null');
  assert.ok(Math.abs((x[3] as number) - 0.5) < 1e-12);
  assert.ok(Math.abs((x[9] as number) - 0.5) < 1e-12);
  // สมดุลพอดีต้องได้ 0
  assert.ok(Math.abs((orderFlowImbalance(flowBars(flat(10), 0.5), 4)[9] as number)) < 1e-12);
  // ฝั่งขายล้วนต้องได้ -1
  assert.ok(Math.abs((orderFlowImbalance(flowBars(flat(10), 0), 4)[9] as number) + 1) < 1e-12);
});

test('OrderFlow: การลบค่าเฉลี่ยของตัวเองกำจัดอคติคงที่ทิ้งได้จริง', () => {
  // ค่าคงที่ล้วน หลังลบค่าเฉลี่ยต้องเหลือศูนย์ ไม่ว่าอคติจะใหญ่แค่ไหน
  const constant = new Array(50).fill(-0.3);
  const out = removeOwnMean(constant, 10);
  assert.equal(out[8], null, 'ก่อนครบหน้าต่างต้องเป็น null');
  for (let i = 9; i < 50; i++) assert.ok(Math.abs(out[i] as number) < 1e-12, `แท่ง ${i} ต้องเป็นศูนย์`);
  // ค่าที่สูงกว่าค่าเฉลี่ยของตัวเองต้องเป็นบวก
  const rising = Array.from({ length: 20 }, (_, i) => i / 100);
  const r = removeOwnMean(rising, 5);
  assert.ok((r[19] as number) > 0);
});

test('OrderFlow: ไม่มีสถานะจนกว่าจะสะสมข้อมูลครบ lookback + debias', () => {
  // ข้อมูลสั้นกว่าที่ต้องการ ต้องไม่เปิดสถานะเลยและต้องบอกเหตุผลไว้
  const k = flowBars(flat(300), 0.9);
  const r = orderFlowV3(k, { flowLookbackDays: 2, flowDebiasDays: 20 });
  assert.ok(r.exposure.slice(0, 20 * perDay).every((e) => e === 0), 'ช่วงสะสมต้องเป็นสถานะว่าง');
  assert.ok(r.reason[0].includes('รอสะสม'));
});

test('OrderFlow: เข้าที่เกณฑ์ ออกที่ครึ่งเกณฑ์ และกลับข้างเมื่อข้ามไปอีกฝั่ง', () => {
  const L = 1, M = 3;                                  // 1 วัน / 3 วัน = 24 / 72 แท่ง
  const n = 24 * 12;
  const share = new Array(n).fill(0.5);
  // ครึ่งหลังให้ฝั่งซื้อเคาะหนักขึ้น เพื่อให้ค่าหลังลบค่าเฉลี่ยเป็นบวกเกินเกณฑ์
  for (let i = 24 * 8; i < n; i++) share[i] = 0.9;
  const r = orderFlowV3(flowBars(flat(n), share), { flowLookbackDays: L, flowDebiasDays: M, flowBand: 0.05 });
  assert.ok(r.exposure.some((e) => e > 0), 'แรงซื้อที่ชัดเจนต้องทำให้เกิดสถานะซื้อ');
  assert.ok(r.exposure.every((e) => e >= 0), 'ไม่มีอะไรทำให้ควรเปิดฝั่งขายในกรณีนี้');
  // ฝั่งขายแบบสะท้อนกระจก
  const mirror = share.map((v) => 1 - v);
  const rs = orderFlowV3(flowBars(flat(n), mirror), { flowLookbackDays: L, flowDebiasDays: M, flowBand: 0.05 });
  assert.ok(rs.exposure.some((e) => e < 0), 'แรงขายที่ชัดเจนต้องทำให้เกิดสถานะขาย');
  assert.ok(rs.exposure.every((e) => e <= 0));
  // ทิศทางถูกปิดได้ตามรหัสกลยุทธ์
  const longOnly = orderFlowV3(flowBars(flat(n), mirror), { flowLookbackDays: L, flowDebiasDays: M, flowBand: 0.05, allowShort: 0 });
  assert.ok(longOnly.exposure.every((e) => e >= 0), 'เมื่อปิดฝั่งขายต้องไม่มีสถานะขายเลย');
});

test('OrderFlow: ทุก prefix ให้ผลเหมือนเดิม จึงไม่มีการมองอนาคต', () => {
  const n = 24 * 10;
  const share = Array.from({ length: n }, (_, i) => 0.5 + 0.35 * Math.sin(i / 17));
  const prices = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 9) * 5);
  const k = flowBars(prices, share);
  const params = { flowLookbackDays: 1, flowDebiasDays: 3, flowBand: 0.02 };
  const full = orderFlowV3(k, params);
  for (let end = 0; end <= n; end += 7) {
    const partial = orderFlowV3(k.slice(0, end), params);
    for (const key of ['exposure', 'signal', 'reason', 'direction'] as const)
      assert.deepEqual(partial[key], full[key].slice(0, end), `${key} ที่ prefix ${end}`);
  }
});

test('OrderFlow: สัญญาณกับคอลัมน์ exposure บอกเรื่องเดียวกัน และตัวจำลองรับไปใช้ได้', () => {
  const n = 24 * 12;
  const share = Array.from({ length: n }, (_, i) => (i < n / 2 ? 0.5 : 0.95));
  const prices = Array.from({ length: n }, (_, i) => 100 + i * 0.1);
  const r = orderFlowV3(flowBars(prices, share), { flowLookbackDays: 1, flowDebiasDays: 3, flowBand: 0.05 });
  for (let i = 1; i < n; i++) {
    const before = r.exposure[i - 1], now = r.exposure[i];
    if (r.signal[i] === 'BUY') assert.ok(now > 0 && before <= 0, `BUY ที่ ${i} ต้องเปลี่ยนเป็นสถานะซื้อ`);
    if (r.signal[i] === 'SHORT') assert.ok(now < 0 && before >= 0, `SHORT ที่ ${i} ต้องเปลี่ยนเป็นสถานะขาย`);
    if (r.signal[i] === 'SELL') assert.ok(now === 0 && before > 0, `SELL ที่ ${i} ต้องปิดสถานะซื้อ`);
    if (r.signal[i] === 'COVER') assert.ok(now === 0 && before < 0, `COVER ที่ ${i} ต้องปิดสถานะขาย`);
    if (r.signal[i] === null && now !== before) assert.fail(`สถานะเปลี่ยนที่ ${i} โดยไม่มีสัญญาณ`);
  }
  // ราคาขึ้นตลอดและกลยุทธ์ถือฝั่งซื้อ ผลต้องเป็นบวกเมื่อไม่มีค่าธรรมเนียม
  const sim = simulateExposure(flowBars(prices, share), r.exposure, 0, 0, 0, 0, 'next_open');
  assert.ok(sim.totalTrades > 0 && sim.returnPct > 0);
});

test('OrderFlow: ปฏิเสธค่าพารามิเตอร์ที่ขัดกันเอง', () => {
  const k = flowBars(flat(100), 0.6);
  assert.throws(() => orderFlowV3(k, { flowLookbackDays: 0 }), /positive lookback/);
  assert.throws(() => orderFlowV3(k, { flowLookbackDays: 10, flowDebiasDays: 10 }), /flowLookbackDays < flowDebiasDays/);
  assert.throws(() => orderFlowV3(k, { flowBand: 0 }), /flowBand/);
  assert.throws(() => orderFlowV3(k, { flowBand: 1.5 }), /flowBand/);
  assert.throws(() => orderFlowV3(k, { flowSizePct: 0 }), /flowSizePct/);
  assert.throws(() => orderFlowV3(k, { allowLong: 0, allowShort: 0 }), /at least one direction/);
  assert.throws(() => orderFlowV3(k, {}, -1), /startIndex/);
  assert.throws(() => orderFlowV3(k, { flowBand: NaN }), /Invalid OrderFlow V3 parameter/);
  // ข้อมูลว่างต้องไม่ทำให้พัง
  assert.equal(orderFlowV3([], {}).exposure.length, 0);
});

test('OrderFlow: เชื่อมเข้าทะเบียน v3 ครบและไม่มีตระกูลอื่นค้างอยู่', () => {
  // ทะเบียนต้องมีแต่รหัสที่ผ่านการวัดแล้ว — กลยุทธ์ที่วัดแล้วขาดทุนต้องไม่กลับเข้ามาเงียบ ๆ
  // รายชื่อนี้เป็นบัญชีขาว: การเพิ่มรหัสใหม่ต้องแก้ที่นี่ด้วย ซึ่งบังคับให้มีคนตัดสินใจจริง
  assert.deepEqual([...V3_STRATEGY_IDS].sort(),
    ['flowgate_utbot_v3', 'orderflow_v3', 'orderflow_v3_long', 'orderflow_v3_short', 'orderflow_v3_zero']);
  assert.deepEqual(v3Direction('orderflow_v3'), { allowLong: 1, allowShort: 1 });
  assert.deepEqual(v3Direction('orderflow_v3_long'), { allowLong: 1, allowShort: 0 });
  assert.deepEqual(v3Direction('orderflow_v3_short'), { allowLong: 0, allowShort: 1 });
  const defaults = v3Defaults('orderflow_v3');
  assert.ok('flowLookbackDays' in defaults && 'flowBand' in defaults);
  assert.ok(!('stopAtr' in defaults), 'ต้องไม่ปนพารามิเตอร์ของตระกูลที่ถอดออกไปแล้ว');
  assert.ok(!('allowLong' in defaults), 'ทิศทางต้องมาจากรหัสกลยุทธ์');
  assert.equal(validateV3Params('orderflow_v3', defaults), null);
  assert.ok(validateV3Params('orderflow_v3', { ...defaults, flowLookbackDays: 999 }));
  assert.equal(v3WarmupBars('orderflow_v3'), 2000);
  // computeV3 ต้องส่งต่อไปยังอินดิเคเตอร์ที่ถูกตัว
  const k = flowBars(flat(24 * 8), 0.9);
  const viaRegistry = computeV3('orderflow_v3', k, { flowLookbackDays: 1, flowDebiasDays: 3 });
  const direct = orderFlowV3(k, { flowLookbackDays: 1, flowDebiasDays: 3, allowLong: 1, allowShort: 1 });
  assert.deepEqual(viaRegistry.exposure, direct.exposure);
  // กฎสำหรับไฟล์ Export ต้องบอกข้อจำกัดไว้ ไม่ใช่โฆษณาอย่างเดียว
  assert.ok(ORDER_FLOW_RULE_TH.includes('ยังไม่มีนัยสำคัญทางสถิติ'));
  assert.ok(ORDER_FLOW_RULE_TH.includes('ต้องกระจายหลายเหรียญ'));
  // รหัสฝั่งเดียวต้องล็อกทิศได้จริงผ่านทะเบียน ไม่ใช่แค่ประกาศไว้
  const share = Array.from({ length: 24 * 12 }, (_, i) => (i < 24 * 8 ? 0.5 : 0.05));
  const k2 = flowBars(flat(24 * 12), share);
  const small = { flowLookbackDays: 1, flowDebiasDays: 3, flowBand: 0.05 };
  assert.ok(computeV3('orderflow_v3', k2, small).exposure.some((e) => e < 0), 'สองทางต้องเปิดฝั่งขายได้');
  assert.ok(computeV3('orderflow_v3_long', k2, small).exposure.every((e) => e >= 0), 'ซื้ออย่างเดียวต้องไม่มี exposure ติดลบ');
  assert.ok(computeV3('orderflow_v3_short', k2, small).exposure.every((e) => e <= 0), 'ขายอย่างเดียวต้องไม่มี exposure เป็นบวก');
  for (const id of V3_STRATEGY_IDS) assert.equal(v3WarmupBars(id), 2000);
});

// ══ ตระกูล TradePlan ══════════════════════════════════════════

/**
 * แท่งที่คุมทั้งราคาปิดและความกว้างของแท่งได้ เพื่อคุม ATR ให้เล็กหรือใหญ่ตามต้องการ
 * `spreadPct` = ครึ่งหนึ่งของช่วง high–low คิดเป็น % ของราคา
 */
function planBars(prices: number[], spreadPct: number, stepMs = HOUR): KlineData[] {
  return prices.map((p, i) => {
    const d = (p * spreadPct) / 100;
    return parseKline([i * stepMs, String(p), String(p + d), String(p - d), String(p), '100',
      (i + 1) * stepMs - 1, '1000', 10, '50', '500']);
  });
}
/** ราคาไต่ขึ้นเป็นขั้นบันไดเพื่อให้แหล่งสัญญาณ breakout ยิงแน่นอน */
const ramp = (n: number, from = 100, step = 0.5) => Array.from({ length: n }, (_, i) => from + i * step);

test('TradePlan: ระยะเสี่ยงมีพื้นเป็นต้นทุนเสมอ ซึ่งเป็นเหตุผลทั้งหมดที่ชั้นนี้มีอยู่', () => {
  // ATR เล็กมาก (แท่งกว้าง 0.01%) พื้นต้นทุนจึงต้องเป็นตัวกำหนด: 5 x 0.16% = 0.80%
  const r = tradePlanV3(planBars(ramp(200, 100, 0.01), 0.005), 'breakout',
    { breakoutBars: 5, planStopAtr: 2, planRiskCostMult: 5, planCostPct: 0.16, planMinVolRatio: 0 });
  const entered = r.riskPct!.filter((x): x is number => x !== null);
  assert.ok(entered.length > 0, 'ต้องมีไม้เกิดขึ้นจริงจึงจะตรวจอะไรได้');
  for (const risk of entered)
    assert.ok(Math.abs(risk - 0.8) < 1e-9, `ATR เล็กกว่าพื้นต้นทุน ระยะเสี่ยงต้องเท่ากับพื้น 0.80% แต่ได้ ${risk}`);
  // ATR ใหญ่ (แท่งกว้าง 1%) ระยะเสี่ยงต้องมาจาก ATR แทน และต้องกว้างกว่าพื้นเสมอ
  const wide = tradePlanV3(planBars(ramp(200, 100, 2), 0.5), 'breakout',
    { breakoutBars: 5, planStopAtr: 2, planRiskCostMult: 5, planCostPct: 0.16, planMinVolRatio: 0 });
  for (const risk of wide.riskPct!.filter((x): x is number => x !== null))
    assert.ok(risk > 0.8, `ATR ใหญ่ ระยะเสี่ยงต้องมาจาก ATR ไม่ใช่พื้นต้นทุน แต่ได้ ${risk}`);
});

test('TradePlan: stop กับเป้าตรึงตั้งแต่แท่งที่เข้า และเป้าห่างเป็น planTargetR เท่าของระยะเสี่ยง', () => {
  const k = planBars(ramp(200), 0.1);
  const r = tradePlanV3(k, 'breakout', { breakoutBars: 5, planTargetR: 3, planMinVolRatio: 0 });
  const entry = r.signal.findIndex((s) => s === 'BUY' || s === 'SHORT');
  assert.ok(entry > 0, 'ต้องมีจังหวะเข้าจริง');
  const side = r.signal[entry] === 'BUY' ? 1 : -1;
  const price = +k[entry].close, risk = r.riskPct![entry] as number;
  assert.ok(Math.abs((r.stop![entry] as number) - price * (1 - side * risk / 100)) < 1e-6);
  assert.ok(Math.abs((r.target![entry] as number) - price * (1 + side * 3 * risk / 100)) < 1e-6);
  // ตรึงไว้จนกว่าจะออก — ไม่มี trailing เพราะยังไม่มีหลักฐานว่ามันช่วย
  for (let i = entry; i < r.stop!.length && r.direction[i] === side; i++)
    assert.equal(r.stop![i], r.stop![entry], `stop ขยับที่แท่ง ${i} ทั้งที่ต้องตรึง`);
});

test('TradePlan: งบจำนวนไม้ต่อปีถูกบังคับเป็นระยะห่างขั้นต่ำจริง', () => {
  // แท่งรายชั่วโมง = 8,760 แท่ง/ปี · งบ 365 ไม้/ปี → ห่างกันอย่างน้อย 24 แท่ง
  const prices = Array.from({ length: 600 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.05);
  const r = tradePlanV3(planBars(prices, 0.3), 'breakout', { breakoutBars: 5, planMaxTradesPerYear: 365, planMinVolRatio: 0 });
  const entries = r.signal.flatMap((s, i) => (s === 'BUY' || s === 'SHORT' ? [i] : []));
  assert.ok(entries.length > 1, 'ต้องมีหลายไม้จึงจะตรวจระยะห่างได้');
  for (let i = 1; i < entries.length; i++)
    assert.ok(entries[i] - entries[i - 1] >= 24, `ไม้ที่ ${entries[i]} ห่างจากไม้ก่อนหน้าแค่ ${entries[i] - entries[i - 1]} แท่ง`);
  // งบที่กว้างขึ้นต้องให้ไม้มากขึ้น มิฉะนั้นด่านนี้ไม่ได้ทำงานจริง
  const loose = tradePlanV3(planBars(prices, 0.3), 'breakout', { breakoutBars: 5, planMaxTradesPerYear: 9999, planMinVolRatio: 0 });
  const looseEntries = loose.signal.filter((s) => s === 'BUY' || s === 'SHORT').length;
  assert.ok(looseEntries > entries.length, 'ปิดงบแล้วต้องเทรดถี่ขึ้น');
});

test('TradePlan: ออกเมื่อชน stop, ถึงเป้า หรือครบเวลาถือ และไม่เข้าใหม่ในแท่งที่เพิ่งออก', () => {
  // ราคาไต่ขึ้นแล้วร่วงแรง เพื่อให้ไม้ซื้อชน stop แน่นอน
  const prices = [...ramp(60), ...Array.from({ length: 40 }, (_, i) => 130 - i * 2)];
  const r = tradePlanV3(planBars(prices, 0.2), 'breakout', { breakoutBars: 5, planMaxHoldHours: 6, planMinVolRatio: 0 });
  const exits = r.reason.flatMap((t, i) => (t.startsWith('ออก (') ? [{ i, t }] : []));
  assert.ok(exits.length > 0, 'ต้องมีการออกจริง');
  assert.ok(exits.some((e) => e.t.includes('ชน stop') || e.t.includes('ถึงเป้าหมาย') || e.t.includes('ครบเวลาถือ')));
  for (const e of exits) {
    assert.equal(r.direction[e.i], 0, `แท่งที่ออก ${e.i} ต้องเป็นสถานะว่าง ไม่ใช่กลับข้างทันที`);
    assert.equal(r.exposure[e.i], 0);
  }
  // เวลาถือสูงสุด 6 ชม. บนแท่งรายชั่วโมง = 6 แท่ง ห้ามถือเกินนั้น
  for (const h of r.holdBars!.filter((x): x is number => x !== null))
    assert.ok(h <= 6, `ถือ ${h} แท่ง เกิน planMaxHoldHours`);
});

test('TradePlan: ทุก prefix ให้ผลเหมือนเดิม จึงไม่มีการมองอนาคต', () => {
  const n = 400;
  const prices = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 11) * 6 + i * 0.03);
  const share = Array.from({ length: n }, (_, i) => 0.5 + 0.35 * Math.sin(i / 19));
  for (const [source, k] of [['breakout', planBars(prices, 0.4)], ['flow', flowBars(prices, share)]] as const) {
    const params = { breakoutBars: 6, flowLookbackDays: 1, flowDebiasDays: 3, flowBand: 0.02, planMinVolRatio: 0 };
    const full = tradePlanV3(k, source, params);
    assert.ok(full.signal.some((x) => x !== null), `${source}: เทสต์นี้ต้องมีสัญญาณจริงจึงจะตรวจอะไรได้`);
    for (let end = 0; end <= n; end += 37) {
      const partial = tradePlanV3(k.slice(0, end), source, params);
      for (const key of ['exposure', 'signal', 'reason', 'direction'] as const)
        assert.deepEqual(partial[key], full[key].slice(0, end), `${source}: ${key} ที่ prefix ${end}`);
    }
  }
});

test('TradePlan: ทิศทางถูกล็อกได้ และปฏิเสธค่าที่ขัดกันเอง', () => {
  const prices = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 8);
  const k = planBars(prices, 0.3);
  const opts = { breakoutBars: 5, planMaxTradesPerYear: 9999, planMinVolRatio: 0 };
  assert.ok(tradePlanV3(k, 'breakout', opts).exposure.some((e) => e < 0), 'เทสต์นี้ต้องมีฝั่งขายเกิดขึ้นจริง มิฉะนั้นการล็อกทิศจะผ่านแบบว่างเปล่า');
  assert.ok(tradePlanV3(k, 'breakout', opts).exposure.some((e) => e > 0));
  assert.ok(tradePlanV3(k, 'breakout', { ...opts, allowShort: 0 }).exposure.some((e) => e > 0));
  assert.ok(tradePlanV3(k, 'breakout', { ...opts, allowShort: 0 }).exposure.every((e) => e >= 0));
  assert.ok(tradePlanV3(k, 'breakout', { ...opts, allowLong: 0 }).exposure.every((e) => e <= 0));
  assert.throws(() => tradePlanV3(k, 'breakout', { allowLong: 0, allowShort: 0 }), /at least one direction/);
  assert.throws(() => tradePlanV3(k, 'breakout', { planCostPct: 0 }), /planCostPct/);
  assert.throws(() => tradePlanV3(k, 'breakout', { planTargetR: 0 }), /planTargetR/);
  assert.throws(() => tradePlanV3(k, 'breakout', { planStopAtr: 0, planRiskCostMult: 0 }), /requires a stop/);
  assert.throws(() => tradePlanV3(k, 'breakout', { planMaxTradesPerYear: 0 }), /planMaxTradesPerYear/);
  assert.throws(() => tradePlanV3(k, 'breakout', { planSizePct: 0 }), /planSizePct/);
  assert.throws(() => tradePlanV3(k, 'flow', { flowLookbackDays: 10, flowDebiasDays: 10 }), /flowLookbackDays < flowDebiasDays/);
  assert.throws(() => tradePlanV3(k, 'breakout', {}, -1), /startIndex/);
  assert.equal(tradePlanV3([], 'breakout', {}).exposure.length, 0);
});

test('TradePlan: ยังไม่ถูกลงทะเบียน เพราะวัดแล้วไม่ผ่านด่านจังหวะเข้า', () => {
  // ด่านนี้เป็นเจตนา ไม่ใช่งานค้าง: ผลวัดอยู่ใน trade-planning-1m-30m-th.md หัวข้อ 9
  // ถ้าวันหนึ่งมีหลักฐานว่าผ่าน ให้ลบเทสต์นี้พร้อมกับตอนที่เพิ่มรหัสเข้าทะเบียน
  assert.ok(V3_STRATEGY_IDS.every((id) => !id.startsWith('tradeplan')),
    'TradePlan ต้องไม่อยู่ในทะเบียนจนกว่าจะมีหลักฐานว่าจังหวะเข้ามีข้อมูลเชิงทิศทาง');
  // ช่องของการจัดการไม้ต้องเป็นช่องทางเลือกจริง กลยุทธ์ที่ไม่มี stop ตามราคาต้องไม่สร้างคอลัมน์ว่าง
  const flow = orderFlowV3(flowBars(flat(200), 0.7), { flowLookbackDays: 1, flowDebiasDays: 3 });
  for (const key of ['stop', 'target', 'riskPct', 'holdBars', 'volRatio'] as const)
    assert.equal(flow[key], undefined, `OrderFlow ไม่มี ${key} จริง จึงต้องไม่ใส่ช่องนั้นเลย`);
});

test('TradePlan: ด่านความผันผวนกันไม้ตอนตลาดเงียบได้จริง', () => {
  // ครึ่งแรกแท่งกว้าง 0.6% ครึ่งหลังแคบลงเหลือ 0.05% — ช่วงหลังต้องถูกด่านนี้กันไว้
  const prices = Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 5) * 4);
  const loud = planBars(prices.slice(0, 200), 0.6);
  const quiet = planBars(prices.slice(200), 0.05).map((b, i) =>
    parseKline([(200 + i) * HOUR, b.open, b.high, b.low, b.close, b.volume,
      (201 + i) * HOUR - 1, b.quoteAssetVolume, b.numberOfTrades, b.takerBuyBaseVolume, b.takerBuyQuoteVolume]));
  const k = [...loud, ...quiet];
  const opts = { breakoutBars: 5, planMaxTradesPerYear: 9999, planVolWindowDays: 2 };
  const gated = tradePlanV3(k, 'breakout', { ...opts, planMinVolRatio: 1 });
  const open = tradePlanV3(k, 'breakout', { ...opts, planMinVolRatio: 0 });
  const after = (r: typeof gated) => r.signal.slice(260).filter((x) => x === 'BUY' || x === 'SHORT').length;
  assert.ok(after(open) > 0, 'เทสต์นี้ต้องมีไม้ในช่วงเงียบเมื่อปิดด่าน มิฉะนั้นไม่ได้ตรวจอะไร');
  assert.ok(after(gated) < after(open), 'เปิดด่านแล้วต้องเข้าน้อยลงในช่วงที่ความผันผวนต่ำกว่าค่าปกติ');
  assert.ok(gated.reason.some((t) => t.includes('ความผันผวนต่ำกว่าเกณฑ์')), 'ต้องบอกเหตุผลที่ข้ามไว้ในคอลัมน์เหตุผล');
});

test('OrderFlow: กฎการออกเป็นพารามิเตอร์ต่อเนื่องค่าเดียว และรหัส zero ต่างจากรหัสหลักแค่ค่านั้น', () => {
  // รหัสใหม่ต้องต่างจากรหัสหลักที่ flowExitMult เพียงค่าเดียว ไม่ใช่กลยุทธ์คนละตัวที่ใช้ชื่อคล้ายกัน
  const base = v3Defaults('orderflow_v3'), zero = v3Defaults('orderflow_v3_zero');
  assert.equal(zero.flowExitMult, 0);
  assert.equal(base.flowExitMult, 0.5, 'รหัสหลักต้องคงกฎเดิมไว้ ไม่งั้นหลักฐานที่วัดไว้ทั้งหมดจะไม่ตรงกับโค้ด');
  for (const key of Object.keys(base))
    if (key !== 'flowExitMult') assert.equal(zero[key], base[key], `${key} ต้องเหมือนกันทั้งสองรหัส`);
  assert.deepEqual(v3Direction('orderflow_v3_zero'), { allowLong: 1, allowShort: 1 });

  // ค่าที่ต่างกันต้องเปลี่ยนพฤติกรรมจริง: ออกช้ากว่าย่อมถือนานกว่าและเทรดน้อยกว่า
  const n = 24 * 20;
  const share = Array.from({ length: n }, (_, i) => 0.5 + 0.4 * Math.sin(i / 23));
  const k = flowBars(flat(n), share);
  const opts = { flowLookbackDays: 1, flowDebiasDays: 3, flowBand: 0.05 };
  const held = (m: number) => orderFlowV3(k, { ...opts, flowExitMult: m }).exposure.filter((e) => e !== 0).length;
  assert.ok(held(0) > held(0.5), 'ออกที่ศูนย์ต้องถือรวมนานกว่าออกที่ครึ่งเกณฑ์');
  assert.ok(held(-1) >= held(0), 'ไม่ออกเลยต้องถือรวมนานที่สุด');
  assert.ok(held(1) < held(0.5), 'ออกทันทีที่หลุดเกณฑ์ต้องถือสั้นที่สุด');

  // −1 คือ "ไม่ออกเป็นสถานะว่างเลย" จึงต้องไม่มีการกลับไปว่างหลังเข้าไม้แรก
  const flip = orderFlowV3(k, { ...opts, flowExitMult: -1 });
  const first = flip.exposure.findIndex((e) => e !== 0);
  assert.ok(first > 0);
  assert.ok(flip.exposure.slice(first).every((e) => e !== 0), 'ที่ −1 ต้องไม่กลับไปเป็นสถานะว่างอีก');
  assert.ok(flip.signal.slice(first).every((x) => x !== 'SELL' && x !== 'COVER'), 'ที่ −1 ต้องไม่มีสัญญาณปิดเป็นสถานะว่าง');

  assert.throws(() => orderFlowV3(k, { flowExitMult: 1.5 }), /flowExitMult/);
  assert.throws(() => orderFlowV3(k, { flowExitMult: -2 }), /flowExitMult/);
  // กฎในไฟล์ Export ของรหัสใหม่ต้องบอกข้อจำกัดของตัวเอง ไม่ใช่โฆษณาอย่างเดียว
  assert.ok(v3RuleFor('orderflow_v3_zero').includes('2 จาก 6'), 'ต้องระบุช่องที่มันแพ้กฎเดิมไว้ด้วย');
});

test('V3: computeV3 ที่ไม่ส่งพารามิเตอร์ ต้องใช้ค่าตั้งต้นของรหัสกลยุทธ์ ไม่ใช่ของอินดิเคเตอร์', () => {
  // รหัสสองตัวใช้ฟังก์ชันเดียวกันแต่ต่างที่ค่าตั้งต้น ถ้า computeV3 ไม่เติมค่าตั้งต้นของทะเบียน
  // ผู้เรียกที่ส่ง {} จะได้ผลเหมือนกันทั้งสองรหัสโดยไม่มีอะไรฟ้อง
  const n = 24 * 20;
  const share = Array.from({ length: n }, (_, i) => 0.5 + 0.4 * Math.sin(i / 23));
  const k = flowBars(flat(n), share);
  for (const id of V3_STRATEGY_IDS) {
    const bare = computeV3(id, k, {}, 0);
    const explicit = computeV3(id, k, v3Defaults(id), 0);
    assert.deepEqual(bare.exposure, explicit.exposure, `${id}: computeV3 ต้องเติมค่าตั้งต้นของทะเบียนให้เอง`);
  }
  // และค่าตั้งต้นที่ต่างกันต้องให้ผลต่างกันจริง ไม่งั้นเทสต์ข้างบนผ่านแบบว่างเปล่า
  const a = computeV3('orderflow_v3', k, { flowLookbackDays: 1, flowDebiasDays: 3, flowBand: 0.05 }, 0);
  const b = computeV3('orderflow_v3_zero', k, { flowLookbackDays: 1, flowDebiasDays: 3, flowBand: 0.05 }, 0);
  assert.notDeepEqual(a.exposure, b.exposure, 'สองรหัสต้องให้ผลต่างกันเมื่อส่งพารามิเตอร์ร่วมชุดเดียวกัน');
});

// ══ ตระกูล FlowGate ═══════════════════════════════════════════

/** แท่งที่คุมทั้งราคาและสัดส่วนปริมาณฝั่งซื้อ เพื่อคุมทั้งชั้นจังหวะและชั้นทิศทางพร้อมกัน */
function gateBars(prices: number[], buyShare: number[] | number): KlineData[] {
  const share = (i: number) => (typeof buyShare === 'number' ? buyShare : buyShare[i]);
  return prices.map((p, i) =>
    parseKline([i * HOUR, String(p), String(p * 1.002), String(p * 0.998), String(p), '100',
      (i + 1) * HOUR - 1, '1000', 10, String(100 * share(i)), '500']));
}
/** ราคาลงยาวแล้วกลับขึ้นยาว เพื่อให้ EMA Cross ยิงซื้อจริงกลางทาง */
const vShape = (n: number) => Array.from({ length: n },
  (_, i) => (i < n / 2 ? 100 - i * 0.2 : 100 - (n / 2) * 0.2 + (i - n / 2) * 0.4));
const gateOpts = { flowLookbackDays: 1, flowDebiasDays: 3, flowBand: 0.05, emaFastLength: 10, emaSlowLength: 30 };

test('FlowGate: เข้าเมื่อชั้นจังหวะยิงและชั้นทิศทางเห็นด้วย และข้ามเมื่อไม่เห็นด้วย', () => {
  const n = 24 * 14;
  const prices = vShape(n);
  // ชั้นทิศทางหนุนฝั่งซื้อในครึ่งหลัง ซึ่งเป็นช่วงที่ EMA Cross ยิงซื้อพอดี
  const bull = Array.from({ length: n }, (_, i) => (i < n / 2 ? 0.5 : 0.95));
  const agree = flowGateV3(gateBars(prices, bull), 'ema', gateOpts);
  assert.ok(agree.exposure.some((e) => e > 0), 'เมื่อสองชั้นเห็นตรงกันต้องมีสถานะซื้อเกิดขึ้น');
  assert.ok(agree.signal.some((s) => s === 'BUY'));

  // ชั้นจังหวะเหมือนเดิมเป๊ะ แต่ชั้นทิศทางชี้ลง — ต้องไม่มีไม้ซื้อเลย และต้องบอกเหตุผลไว้
  const bear = Array.from({ length: n }, (_, i) => (i < n / 2 ? 0.5 : 0.05));
  const blocked = flowGateV3(gateBars(prices, bear), 'ema', { ...gateOpts, allowShort: 0 });
  assert.ok(blocked.exposure.every((e) => e <= 0), 'ชั้นทิศทางค้านแล้วต้องไม่เปิดสถานะซื้อ');
  assert.ok(blocked.reason.some((t) => t.includes('ไม่เห็นด้วย')), 'ต้องบอกว่าถูกประตูทิศทางกันไว้');
  // ชั้นจังหวะต้องยิงจริงในทั้งสองกรณี มิฉะนั้นเทสต์ผ่านแบบว่างเปล่า
  assert.ok(blocked.triggerDir!.some((d) => d === 1), 'ตัวเร็วต้องยิงซื้อจริงในกรณีที่ถูกกัน');
});

test('FlowGate: ออกเมื่อชั้นทิศทางเลิกหนุน และตัวเร็วสั่งออกได้เฉพาะเมื่อเปิดสวิตช์', () => {
  const n = 24 * 20;
  const prices = vShape(n);
  // หนุนซื้อช่วงกลาง แล้วกลับเป็นกลางช่วงท้าย — สถานะต้องถูกปิดเมื่อแรงหนุนหาย
  const share = Array.from({ length: n }, (_, i) => (i < n / 2 ? 0.5 : i < n * 0.8 ? 0.95 : 0.5));
  const r = flowGateV3(gateBars(prices, share), 'ema', gateOpts);
  const opened = r.signal.findIndex((s) => s === 'BUY');
  assert.ok(opened > 0, 'ต้องมีไม้เปิดจริงก่อนจึงจะตรวจการออกได้');
  assert.ok(r.signal.slice(opened).some((s) => s === 'SELL'), 'แรงหนุนหายแล้วต้องมีการปิดสถานะ');
  assert.ok(r.reason.some((t) => t.includes('แรงซื้อขายสุทธิเลิกหนุน')));

  // สวิตช์ออกตามตัวเร็ว: ค่าตั้งต้นคือปิด (เลือกจากช่วง train) เปิดแล้วต้องเทรดถี่ขึ้น
  const bars = gateBars(prices, share);
  const calm = flowGateV3(bars, 'utbot', { ...gateOpts, gateExitOnFlip: 0 });
  const busy = flowGateV3(bars, 'utbot', { ...gateOpts, gateExitOnFlip: 1 });
  const entries = (x: V3Result) => x.signal.filter((s) => s === 'BUY' || s === 'SHORT').length;
  assert.ok(entries(busy) >= entries(calm), 'เปิดสวิตช์ออกตามตัวเร็วต้องไม่ทำให้เทรดน้อยลง');
});

test('FlowGate: ทุก prefix ให้ผลเหมือนเดิม จึงไม่มีการมองอนาคต', () => {
  // ใช้แท่งจริงจาก fixture เพราะชั้นจังหวะแบบ emaFiltered มีตัวกรอง ADX/ความชัน/ความผันผวน
  // ซึ่งปฏิเสธข้อมูลสังเคราะห์รูปคลื่นทั้งหมดอย่างถูกต้อง แล้วจะทำให้เทสต์ผ่านแบบว่างเปล่า
  const k = fixture;
  const n = k.length;
  for (const trigger of ['trendlines', 'ema', 'emaFiltered', 'utbot', 'confluence'] as const) {
    const full = flowGateV3(k, trigger, gateOpts);
    assert.ok(full.triggerDir!.some((d) => d !== 0), `${trigger}: ต้องมีการยิงจริงจึงจะตรวจอะไรได้`);
    for (let end = 0; end <= n; end += 41) {
      const partial = flowGateV3(k.slice(0, end), trigger, gateOpts);
      for (const key of ['exposure', 'signal', 'direction'] as const)
        assert.deepEqual(partial[key], full[key].slice(0, end), `${trigger}: ${key} ที่ prefix ${end}`);
    }
  }
});

test('FlowGate: ทิศทางล็อกได้ และปฏิเสธค่าที่ขัดกันเอง', () => {
  const n = 24 * 12;
  const k = gateBars(vShape(n), Array.from({ length: n }, (_, i) => (i < n / 2 ? 0.05 : 0.95)));
  assert.ok(flowGateV3(k, 'ema', { ...gateOpts, allowShort: 0 }).exposure.every((e) => e >= 0));
  assert.ok(flowGateV3(k, 'ema', { ...gateOpts, allowLong: 0 }).exposure.every((e) => e <= 0));
  assert.throws(() => flowGateV3(k, 'ema', { allowLong: 0, allowShort: 0 }), /at least one direction/);
  assert.throws(() => flowGateV3(k, 'ema', { emaFastLength: 50, emaSlowLength: 20 }), /emaFastLength < emaSlowLength/);
  assert.throws(() => flowGateV3(k, 'ema', { flowLookbackDays: 10, flowDebiasDays: 10 }), /flowLookbackDays < flowDebiasDays/);
  assert.throws(() => flowGateV3(k, 'ema', { flowBand: 0 }), /flowBand/);
  assert.throws(() => flowGateV3(k, 'ema', { gateSizePct: 0 }), /gateSizePct/);
  assert.throws(() => flowGateV3(k, 'ema', {}, -1), /startIndex/);
  assert.equal(flowGateV3([], 'ema', {}).exposure.length, 0);
});

test('FlowGate: ระดับการออกเป็นครอบครัวต่อเนื่อง และค่า 1 ต้องเท่ากับพฤติกรรมเดิมทุกประการ', () => {
  const n = 24 * 20;
  const prices = vShape(n);
  // แรงหนุนแกว่งกลับเข้ามาที่ระดับกลาง ๆ — ช่วงที่กฎออกแต่ละแบบให้ผลต่างกัน
  const share = Array.from({ length: n }, (_, i) =>
    (i < n / 2 ? 0.5 : i < n * 0.7 ? 0.95 : i < n * 0.85 ? 0.58 : 0.5));
  const k = gateBars(prices, share);
  const at = (gateExitMult: number) => flowGateV3(k, 'ema', { ...gateOpts, gateExitMult });
  const held = (x: V3Result) => x.exposure.filter((e) => e !== 0).length;

  // ค่า 1 คือค่าตั้งต้นของตระกูล จึงต้องเหมือนการไม่ส่งค่ามาเลย — กันการเปลี่ยนพฤติกรรมเงียบ ๆ
  assert.deepEqual(at(1).exposure, flowGateV3(k, 'ema', gateOpts).exposure);
  assert.ok(held(at(1)) > 0, 'ต้องมีสถานะเปิดจริงจึงจะเทียบกฎการออกได้');
  // ยิ่งระดับออกต่ำ ยิ่งถือได้ยาว: 1 → 0 → −1 ต้องไม่ลดลง
  assert.ok(held(at(0)) >= held(at(1)), 'ออกที่ศูนย์ต้องถือได้ไม่สั้นกว่าออกที่ขอบ band');
  assert.ok(held(at(-1)) >= held(at(0)), 'ออกเมื่อกลับข้างเต็มเกณฑ์ต้องถือได้ไม่สั้นกว่าออกที่ศูนย์');
  assert.ok(held(at(0)) > held(at(1)), 'ชุดข้อมูลนี้ต้องแยกสองกฎออกจากกันได้จริง');
  assert.throws(() => flowGateV3(k, 'ema', { gateExitMult: 1.5 }), /gateExitMult/);
  assert.throws(() => flowGateV3(k, 'ema', { gateExitMult: -2 }), /gateExitMult/);
});

test('FlowGate: ลงทะเบียนเฉพาะ utbot ตัวเดียว และค่าตั้งต้นของรหัสต้องเป็นกฎออกที่ศูนย์', () => {
  // ผลวัดอยู่ใน trade-planning-1m-30m-th.md หัวข้อ 11 — อีกสี่ตัวยังตกด่านตรวจข้ามเหรียญ
  assert.deepEqual(V3_STRATEGY_IDS.filter((id) => id.startsWith('flowgate')), ['flowgate_utbot_v3']);
  const def = V3_REGISTRY.flowgate_utbot_v3;
  assert.equal(def.defaults.gateExitMult, 0, 'ค่าที่เลือกจาก train คือ 0 ไม่ใช่ค่าตั้งต้นเดิมของตระกูล');
  assert.equal(FLOW_GATE_V3_DEFAULTS.gateExitMult, 1, 'ค่าตั้งต้นของตระกูลต้องคงเดิม เพื่อให้ผลในหัวข้อ 11 รันซ้ำได้');
  assert.ok(!('allowLong' in def.defaults) && !('allowShort' in def.defaults), 'ทิศทางต้องมาจากรหัส ไม่ใช่พารามิเตอร์');

  // รหัสนี้ต้องใช้ UT Bot เป็นชั้นจังหวะจริง ไม่ใช่ตัวเร็วตัวอื่น
  const n = 24 * 20;
  const k = gateBars(vShape(n), Array.from({ length: n }, (_, i) => (i < n / 2 ? 0.5 : 0.95)));
  const viaRegistry = computeV3('flowgate_utbot_v3', k, gateOpts);
  assert.deepEqual(viaRegistry.exposure,
    flowGateV3(k, 'utbot', { ...gateOpts, gateExitMult: 0 }).exposure);
  assert.notDeepEqual(viaRegistry.exposure, flowGateV3(k, 'ema', { ...gateOpts, gateExitMult: 0 }).exposure);
  // เรียกแบบไม่ส่งพารามิเตอร์ต้องได้ค่าตั้งต้นของรหัส ไม่ใช่ของตระกูล
  assert.deepEqual(computeV3('flowgate_utbot_v3', k).exposure, flowGateV3(k, 'utbot', { gateExitMult: 0 }).exposure);
});

test('V3 insight: บอกระดับที่จะออกเป็นตัวเลข และบอกเมื่อข้อมูลยังไม่พอ', async () => {
  const { v3BarInsight } = await import('../../lib/indicators-v3');
  const { insightLines } = await import('../format');
  const id = 'orderflow_v3' as const;
  const params = { ...v3Defaults(id), flowLookbackDays: 0.5, flowDebiasDays: 3 };
  const r = computeV3(id, fixture, params, 0);

  const early = v3BarInsight(id, fixture.slice(0, 1), r, 0, params);
  assert.equal(early.ready, false, 'แท่งแรกยังสะสมไม่ครบ ต้องไม่ถือว่าพร้อม');
  assert.match(insightLines({ insight: early } as never)[0], /ข้อมูลยังไม่พอ/);

  let checked = 0;
  for (let i = 0; i < fixture.length; i++) {
    const x = v3BarInsight(id, fixture, r, i, params);
    if (!x.ready) continue;
    if (x.direction === 0) { assert.equal(x.exitLevel, null); continue; }
    // ถือซื้อ: ออกเมื่อต่ำกว่า +band*mult · ถือขาย: ออกเมื่อสูงกว่า −band*mult
    assert.equal(x.exitLevel, x.direction * params.flowBand * params.flowExitMult);
    // ระหว่างที่ยังถืออยู่ ค่าสัญญาณต้องยังไม่ข้ามระดับออก มิฉะนั้นตัวเลขที่แจ้งผู้ใช้ผิด
    assert.ok(x.direction * (x.flow! - x.exitLevel!) >= 0, `แท่ง ${i}: ถืออยู่ทั้งที่ข้ามระดับออกแล้ว`);
    checked++;
  }
  assert.ok(checked > 50, 'ต้องมีแท่งที่ถือสถานะมากพอจึงจะตรวจอะไรได้');
});

test('signal-bot: BOTS รับหลายเหรียญในรายการเดียวด้วย + และไม่สร้างบอทซ้ำ', async () => {
  const { parseBots } = await import('../env');
  const bots = parseBots('BTCUSDT+ethusdt+SOLUSDT:30m:orderflow_v3,BTCUSDT:30m:orderflow_v3', {});
  assert.deepEqual(bots.map((b) => b.id), [
    'BTCUSDT:30m:orderflow_v3', 'ETHUSDT:30m:orderflow_v3', 'SOLUSDT:30m:orderflow_v3',
  ]);
  assert.deepEqual(bots[1].params, v3Defaults('orderflow_v3'));
});
