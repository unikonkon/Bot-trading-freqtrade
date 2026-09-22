import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SHORT_TRADE_V3_DEFAULTS, shortTradeV3, sessionAllowed,
} from './research-v3/shorttrade-baseline';
import { V3_STRATEGY_IDS } from '../../lib/indicators-v3';
import { parseKline, type KlineData } from '../../lib/types/kline';

const fixture: KlineData[] = JSON.parse(
  fs.readFileSync(new URL('../../freqtrade/fixtures/BTCUSDT-1h.json', import.meta.url), 'utf8'),
).map(parseKline);

/** สร้างแท่งเทียมที่คุมราคาและระยะเวลาได้ เพื่อทดสอบเลขของตัวจำลองแบบตรวจมือได้ */
function bars(prices: number[], stepMs = 3600000, startMs = 0): KlineData[] {
  return prices.map((p, i) =>
    parseKline([startMs + i * stepMs, String(p), String(p + 1), String(p - 1), String(p), '100',
      startMs + (i + 1) * stepMs - 1, '1000', 10, '50', '500']));
}

// อินดิเคเตอร์นี้เป็นเส้นฐานงานวิจัย ไม่ใช่โค้ดของผลิตภัณฑ์ (ดูหัวข้อ 7 ของเอกสาร)
// เทสต์ยังเก็บไว้เพราะสคริปต์ใน research-v3/ ยังอ้างผลของมันเป็นเส้นเทียบ
// ถ้ามันคำนวณผิด ข้อสรุปในเอกสารหัวข้อ 7 ก็ผิดตาม

test('ShortTrade stays out of the product: it is not a selectable strategy', () => {
  assert.ok(!V3_STRATEGY_IDS.some((id) => id.startsWith('shorttrade')),
    'กลยุทธ์ที่วัดแล้วขาดทุนต้องไม่กลับเข้าทะเบียนโดยไม่ได้ตั้งใจ');
  // ค่าตั้งต้นต้องยังสมเหตุสมผลในตัวเอง แม้ไม่มีตารางป้ายพารามิเตอร์แล้ว
  const p = SHORT_TRADE_V3_DEFAULTS;
  assert.ok(p.fastPeriod < p.trendPeriod && p.internalSize < p.swingSize);
  assert.ok(p.minSizePct > 0 && p.minSizePct <= p.maxSizePct && p.maxSizePct <= 100);
});
test('ShortTrade scales holding time by timeframe instead of using a fixed bar count', () => {
  // ปัญหาของ v1: maxHoldBars ชุดเดียวหมายถึง 48 นาทีบน 1m แต่ 12 ชั่วโมงบน 15m
  const oneMin = shortTradeV3(bars(Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 9) * 4), 60000));
  const fifteenMin = shortTradeV3(bars(Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 9) * 4), 15 * 60000));
  assert.equal(oneMin.timeframeMinutes, 1);
  assert.equal(fifteenMin.timeframeMinutes, 15);
  assert.ok(oneMin.resolvedHoldBars > fifteenMin.resolvedHoldBars,
    'timeframe สั้นกว่าต้องได้จำนวนแท่งถือมากกว่า เพื่อให้เวลาจริงใกล้เคียงกัน');
  // สิ่งที่ต้องเท่ากันคือ "เวลาจริง" ไม่ใช่ "จำนวนแท่ง" — ขอบเขตจำนวนแท่งมีไว้กันค่าไร้สาระเท่านั้น
  // เวอร์ชันก่อนบีบไว้ที่ 12–60 แท่งทุก timeframe ทำให้ holdMinutes = 240 กลายเป็น 60 นาที
  // บน 1m แต่ 360 นาทีบน 30m คือต่างกัน 6 เท่าทั้งที่ตั้งค่าเดียวกัน
  const held = (r: { resolvedHoldBars: number; timeframeMinutes: number }) =>
    r.resolvedHoldBars * r.timeframeMinutes;
  assert.equal(held(oneMin), SHORT_TRADE_V3_DEFAULTS.holdMinutes);
  assert.equal(held(fifteenMin), SHORT_TRADE_V3_DEFAULTS.holdMinutes);
  const thirtyMin = shortTradeV3(bars(Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 9) * 4), 30 * 60000));
  assert.equal(held(thirtyMin), SHORT_TRADE_V3_DEFAULTS.holdMinutes, '30m ต้องอยู่ในขอบเขตด้วย');
});

test('ShortTrade session filter follows the documented UTC windows', () => {
  for (let hour = 0; hour < 24; hour++) {
    assert.equal(sessionAllowed(hour, 0), true, 'โหมด 0 ต้องไม่กรองอะไรเลย');
    assert.equal(sessionAllowed(hour, 1), hour >= 6);
    assert.equal(sessionAllowed(hour, 2), hour >= 7 && hour < 21);
  }
  // ช่วง 03:00–04:00 UTC คือช่วงที่งานวิจัยระบุว่า volume ต่ำสุด ต้องถูกกรองในโหมด 1 และ 2
  assert.equal(sessionAllowed(3, 1), false);
  assert.equal(sessionAllowed(3, 2), false);
});

test('ShortTrade never trades outside the allowed session when the filter is on', () => {
  const k = bars(Array.from({ length: 1500 }, (_, i) => 100 + Math.sin(i / 7) * 3 + i * 0.01), 5 * 60000);
  const r = shortTradeV3(k, { sessionMode: 2 }, 300);
  r.signal.forEach((s, i) => {
    if (s !== 'BUY' && s !== 'SHORT') return;
    const hour = new Date(k[i].openTime).getUTCHours();
    assert.ok(hour >= 7 && hour < 21, `เข้าสถานะนอกช่วงที่อนุญาตที่แท่ง ${i} (${hour}:00 UTC)`);
  });
});

test('ShortTrade mirrors every rule on both sides and respects the direction lock', () => {
  // ตระกูล SMC ไม่ได้ลงทะเบียนเป็นกลยุทธ์อีกแล้ว (ดูหัวข้อ 7 ของเอกสาร) จึงเรียกอินดิเคเตอร์ตรง
  const long = shortTradeV3(fixture, { allowLong: 1, allowShort: 0 }, 0);
  const short = shortTradeV3(fixture, { allowLong: 0, allowShort: 1 }, 0);
  const both = shortTradeV3(fixture, {}, 0);
  assert.ok(long.signal.every((s) => s !== 'SHORT' && s !== 'COVER'), 'ฝั่งซื้ออย่างเดียวต้องไม่มีสัญญาณฝั่งขาย');
  assert.ok(long.exposure.every((e) => e >= 0), 'ฝั่งซื้ออย่างเดียวต้องไม่มี exposure ติดลบ');
  assert.ok(short.signal.every((s) => s !== 'BUY' && s !== 'SELL'), 'ฝั่งขายอย่างเดียวต้องไม่มีสัญญาณฝั่งซื้อ');
  assert.ok(short.exposure.every((e) => e <= 0), 'ฝั่งขายอย่างเดียวต้องไม่มี exposure เป็นบวก');
  assert.ok(both.exposure.some((e) => e !== 0), 'โหมดสองทางต้องเข้าสถานะได้จริง');
  assert.throws(() => shortTradeV3(fixture, { allowLong: 0, allowShort: 0 }), /direction/);
});

test('ShortTrade exposure and signal always agree with each other', () => {
  const r = shortTradeV3(fixture, {}, 0);
  for (let i = 0; i < fixture.length; i++) {
    const e = r.exposure[i];
    assert.ok(Math.abs(e) <= 1, `exposure ต้องอยู่ในช่วง -1..1 ที่แท่ง ${i}`);
    if (r.signal[i] === 'BUY') assert.ok(e > 0, `BUY ต้องมาพร้อม exposure บวกที่แท่ง ${i}`);
    if (r.signal[i] === 'SHORT') assert.ok(e < 0, `SHORT ต้องมาพร้อม exposure ลบที่แท่ง ${i}`);
    if (r.signal[i] === 'SELL' || r.signal[i] === 'COVER') assert.equal(e, 0, `การปิดสถานะต้องทำให้ exposure เป็น 0 ที่แท่ง ${i}`);
    if (e !== 0) assert.equal(Math.sign(e), Math.sign(r.direction[i]), `ทิศของ exposure ต้องตรงกับ direction ที่แท่ง ${i}`);
  }
});

test('ShortTrade sizing stays inside the configured band and follows confidence', () => {
  const r = shortTradeV3(fixture, { minSizePct: 20, maxSizePct: 80 }, 0);
  const sizes = r.size.filter((v): v is number => v !== null);
  assert.ok(sizes.length > 0, 'ต้องมีดีลที่กำหนดขนาดไม้จริง');
  for (const s of sizes) assert.ok(s >= 0.2 - 1e-9 && s <= 0.8 + 1e-9, `ขนาดไม้ ${s} หลุดกรอบ 20–80%`);
  // ความมั่นใจสูงสุดต้องให้ไม้ใหญ่กว่าความมั่นใจต่ำสุดเสมอ
  const pairs = r.confidence.map((cf, i) => [cf, r.size[i]] as const).filter(([cf]) => cf !== null);
  const sorted = [...pairs].sort((a, b) => a[0]! - b[0]!);
  assert.ok(sorted[0][1]! <= sorted.at(-1)![1]! + 1e-9, 'ไม้ต้องโตตามความมั่นใจ');
});

test('ShortTrade respects warmup: no position is carried across startIndex', () => {
  const start = 300;
  const r = shortTradeV3(fixture, {}, start);
  assert.ok(r.exposure.slice(0, start).every((e) => e === 0), 'ช่วงอุ่นเครื่องต้องไม่มีสถานะ');
  assert.ok(r.signal.slice(0, start).every((s) => s === null), 'ช่วงอุ่นเครื่องต้องไม่มีสัญญาณ');
});

test('ShortTrade stops only ever move toward profit while a position is held', () => {
  const r = shortTradeV3(fixture, {}, 0);
  let lastStop: number | null = null, lastDir = 0;
  for (let i = 0; i < fixture.length; i++) {
    const d = r.direction[i], s = r.stop[i];
    if (d === 0 || s === null) { lastStop = null; lastDir = 0; continue; }
    if (lastStop !== null && d === lastDir)
      assert.ok(d * (s - lastStop) >= -1e-9, `stop ถอยห่างกำไรที่แท่ง ${i}`);
    lastStop = s; lastDir = d;
  }
});

test('ShortTrade defaults keep the cost gate meaningful on low timeframes', () => {
  // ต้นทุนไป–กลับต้องเล็กกว่าเพดานเป้าหมาย มิฉะนั้น reward − cost ติดลบทุกครั้ง
  // และกลยุทธ์จะไม่มีทางเข้าสถานะเลย (เคยเกิดขึ้นจริงตอนตั้ง targetAtr = 3)
  const p = SHORT_TRADE_V3_DEFAULTS;
  assert.ok(p.targetAtr > p.stopAtr, 'เพดานเป้าหมายต้องมากกว่าระยะ stop');
  // ATR ของ BTC บน 1m อยู่ราว 0.047% ของราคา ต้นทุน 0.31% จึงเท่ากับราว 6.6 ATR
  const costInAtr = p.costPct / 0.047;
  assert.ok(p.targetAtr > costInAtr,
    `เพดานเป้าหมาย ${p.targetAtr} ATR ต้องมากกว่าต้นทุนที่คิดเป็น ${costInAtr.toFixed(1)} ATR บน 1m`);
});
