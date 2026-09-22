import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_FLOW_V3_DEFAULTS, ORDER_FLOW_RULE_TH, orderFlowV3,
  orderFlowImbalance, removeOwnMean, orderFlowWarmupDays,
} from '../../lib/indicators-v3-OrderFlow';
import {
  computeV3, v3Defaults, validateV3Params, v3WarmupBars, v3Direction,
  V3_REGISTRY, V3_STRATEGY_IDS,
} from '../../lib/indicators-v3-core';
import { parseKline, type KlineData } from '../../lib/types/kline';
import { simulateExposure } from './engine';

const HOUR = 3600000;

/**
 * สร้างแท่งเทียมที่คุมทั้งราคาและสัดส่วนปริมาณฝั่งซื้อได้
 * `buyShare` = สัดส่วนของปริมาณที่ฝั่งซื้อเป็นผู้เคาะ (0.5 = สมดุล)
 */
function bars(prices: number[], buyShare: number[] | number, stepMs = HOUR): KlineData[] {
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
  const k = bars(flat(10), 0.75);
  const x = orderFlowImbalance(k, 4);
  assert.equal(x[2], null, 'ยังสะสมไม่ครบหน้าต่างต้องเป็น null');
  assert.ok(Math.abs((x[3] as number) - 0.5) < 1e-12);
  assert.ok(Math.abs((x[9] as number) - 0.5) < 1e-12);
  // สมดุลพอดีต้องได้ 0
  assert.ok(Math.abs((orderFlowImbalance(bars(flat(10), 0.5), 4)[9] as number)) < 1e-12);
  // ฝั่งขายล้วนต้องได้ -1
  assert.ok(Math.abs((orderFlowImbalance(bars(flat(10), 0), 4)[9] as number) + 1) < 1e-12);
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
  const need = orderFlowWarmupDays();
  assert.equal(need, Math.ceil(ORDER_FLOW_V3_DEFAULTS.flowLookbackDays + ORDER_FLOW_V3_DEFAULTS.flowDebiasDays));
  // ข้อมูลสั้นกว่าที่ต้องการ ต้องไม่เปิดสถานะเลยและต้องบอกเหตุผลไว้
  const k = bars(flat(300), 0.9);
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
  const r = orderFlowV3(bars(flat(n), share), { flowLookbackDays: L, flowDebiasDays: M, flowBand: 0.05 });
  assert.ok(r.exposure.some((e) => e > 0), 'แรงซื้อที่ชัดเจนต้องทำให้เกิดสถานะซื้อ');
  assert.ok(r.exposure.every((e) => e >= 0), 'ไม่มีอะไรทำให้ควรเปิดฝั่งขายในกรณีนี้');
  // ฝั่งขายแบบสะท้อนกระจก
  const mirror = share.map((v) => 1 - v);
  const rs = orderFlowV3(bars(flat(n), mirror), { flowLookbackDays: L, flowDebiasDays: M, flowBand: 0.05 });
  assert.ok(rs.exposure.some((e) => e < 0), 'แรงขายที่ชัดเจนต้องทำให้เกิดสถานะขาย');
  assert.ok(rs.exposure.every((e) => e <= 0));
  // ทิศทางถูกปิดได้ตามรหัสกลยุทธ์
  const longOnly = orderFlowV3(bars(flat(n), mirror), { flowLookbackDays: L, flowDebiasDays: M, flowBand: 0.05, allowShort: 0 });
  assert.ok(longOnly.exposure.every((e) => e >= 0), 'เมื่อปิดฝั่งขายต้องไม่มีสถานะขายเลย');
});

test('OrderFlow: ทุก prefix ให้ผลเหมือนเดิม จึงไม่มีการมองอนาคต', () => {
  const n = 24 * 10;
  const share = Array.from({ length: n }, (_, i) => 0.5 + 0.35 * Math.sin(i / 17));
  const prices = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 9) * 5);
  const k = bars(prices, share);
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
  const r = orderFlowV3(bars(prices, share), { flowLookbackDays: 1, flowDebiasDays: 3, flowBand: 0.05 });
  for (let i = 1; i < n; i++) {
    const before = r.exposure[i - 1], now = r.exposure[i];
    if (r.signal[i] === 'BUY') assert.ok(now > 0 && before <= 0, `BUY ที่ ${i} ต้องเปลี่ยนเป็นสถานะซื้อ`);
    if (r.signal[i] === 'SHORT') assert.ok(now < 0 && before >= 0, `SHORT ที่ ${i} ต้องเปลี่ยนเป็นสถานะขาย`);
    if (r.signal[i] === 'SELL') assert.ok(now === 0 && before > 0, `SELL ที่ ${i} ต้องปิดสถานะซื้อ`);
    if (r.signal[i] === 'COVER') assert.ok(now === 0 && before < 0, `COVER ที่ ${i} ต้องปิดสถานะขาย`);
    if (r.signal[i] === null && now !== before) assert.fail(`สถานะเปลี่ยนที่ ${i} โดยไม่มีสัญญาณ`);
  }
  // ราคาขึ้นตลอดและกลยุทธ์ถือฝั่งซื้อ ผลต้องเป็นบวกเมื่อไม่มีค่าธรรมเนียม
  const sim = simulateExposure(bars(prices, share), r.exposure, 0, 0, 0, 0, 'next_open');
  assert.ok(sim.totalTrades > 0 && sim.returnPct > 0);
});

test('OrderFlow: ปฏิเสธค่าพารามิเตอร์ที่ขัดกันเอง', () => {
  const k = bars(flat(100), 0.6);
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

test('OrderFlow: เชื่อมเข้าทะเบียน v3 ครบและแยกจากตระกูล ShortTrade', () => {
  // ทุกรหัสในทะเบียนตอนนี้เป็นตระกูลแรงซื้อขายสุทธิทั้งหมด
  assert.ok(V3_STRATEGY_IDS.every((id) => V3_REGISTRY[id].family === 'orderflow'));
  assert.deepEqual(v3Direction('orderflow_v3'), { allowLong: 1, allowShort: 1 });
  assert.deepEqual(v3Direction('orderflow_v3_long'), { allowLong: 1, allowShort: 0 });
  assert.deepEqual(v3Direction('orderflow_v3_short'), { allowLong: 0, allowShort: 1 });
  const defaults = v3Defaults('orderflow_v3');
  assert.ok('flowLookbackDays' in defaults && 'flowBand' in defaults);
  assert.ok(!('stopAtr' in defaults), 'ต้องไม่ปนพารามิเตอร์ของตระกูล ShortTrade');
  assert.ok(!('allowLong' in defaults), 'ทิศทางต้องมาจากรหัสกลยุทธ์');
  assert.equal(validateV3Params('orderflow_v3', defaults), null);
  assert.ok(validateV3Params('orderflow_v3', { ...defaults, flowLookbackDays: 999 }));
  assert.equal(v3WarmupBars('orderflow_v3'), 2000);
  // computeV3 ต้องส่งต่อไปยังอินดิเคเตอร์ที่ถูกตัว
  const k = bars(flat(24 * 8), 0.9);
  const viaRegistry = computeV3('orderflow_v3', k, { flowLookbackDays: 1, flowDebiasDays: 3 });
  const direct = orderFlowV3(k, { flowLookbackDays: 1, flowDebiasDays: 3, allowLong: 1, allowShort: 1 });
  assert.deepEqual(viaRegistry.exposure, direct.exposure);
  // กฎสำหรับไฟล์ Export ต้องบอกข้อจำกัดไว้ ไม่ใช่โฆษณาอย่างเดียว
  assert.ok(ORDER_FLOW_RULE_TH.includes('ยังไม่มีนัยสำคัญทางสถิติ'));
  assert.ok(ORDER_FLOW_RULE_TH.includes('ต้องกระจายหลายเหรียญ'));
  // รหัสฝั่งเดียวต้องล็อกทิศได้จริงผ่านทะเบียน ไม่ใช่แค่ประกาศไว้
  const share = Array.from({ length: 24 * 12 }, (_, i) => (i < 24 * 8 ? 0.5 : 0.05));
  const k2 = bars(flat(24 * 12), share);
  const small = { flowLookbackDays: 1, flowDebiasDays: 3, flowBand: 0.05 };
  assert.ok(computeV3('orderflow_v3', k2, small).exposure.some((e) => e < 0), 'สองทางต้องเปิดฝั่งขายได้');
  assert.ok(computeV3('orderflow_v3_long', k2, small).exposure.every((e) => e >= 0), 'ซื้ออย่างเดียวต้องไม่มี exposure ติดลบ');
  assert.ok(computeV3('orderflow_v3_short', k2, small).exposure.every((e) => e <= 0), 'ขายอย่างเดียวต้องไม่มี exposure เป็นบวก');
  for (const id of V3_STRATEGY_IDS) assert.equal(v3WarmupBars(id), 2000);
});
