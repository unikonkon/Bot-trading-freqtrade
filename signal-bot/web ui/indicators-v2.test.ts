import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  V2_INDICATORS, V2_STRATEGY_IDS, V2_PARAM_META, TRADE_FILTER_DEFAULTS,
  applyTradeFilter, computeV2, isV2StrategyId, resolveV2Strategy, v2Defaults,
  v2SignalOf, v2WarmupBars, validateV2Params,
  sma, ema, rma, stdev, dmi, atr, crossOver, crossUnder, findPivots,
  rsiV2, macdV2, supertrendV2, ichimokuV2, vwapV2, volumeProfileV2, lorentzianV2,
  type V2StrategyId,
} from '../../lib/indicators-v2';
import { parseKline, type KlineData } from '../../lib/types/kline';
import { STRATEGIES, STRATEGY_FNS, computeSignals, computeStrategyIndicators, alternateSignals, type SignalAction } from '../../lib/backtest';
import { RULES, INDICATOR_KEY } from './export-calculations';
import { INDICATOR_KEYS } from './engine';
import { validate, warmupBars } from './data';

const fixture: KlineData[] = JSON.parse(
  fs.readFileSync(new URL('../../freqtrade/fixtures/BTCUSDT-1h.json', import.meta.url), 'utf8'),
).map(parseKline);

function prices(values: number[]): KlineData[] {
  return values.map((p, i) =>
    parseKline([i * 3600000, String(p), String(p + 1), String(p - 1), String(p), '100', (i + 1) * 3600000 - 1, '1000', 10, '50', '500']));
}

test('V2 math helpers: warmup nulls, Wilder smoothing and cross detection', () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  // EMA ตั้งต้นด้วย SMA ของ n แท่งแรก แล้วใช้ alpha = 2/(n+1)
  const e = ema([1, 2, 3, 4], 2);
  assert.equal(e[0], null);
  assert.equal(e[1], 1.5);
  assert.ok(Math.abs(e[2]! - (3 * (2 / 3) + 1.5 * (1 / 3))) < 1e-12);
  // RMA ให้น้ำหนักข้อมูลใหม่ 1/n
  const r = rma([2, 4, 6, 8], 2);
  assert.equal(r[1], 3);
  assert.equal(r[2], (3 * 1 + 6) / 2);
  assert.deepEqual(stdev([5, 5, 5, 5], 2).slice(1), [0, 0, 0]);
  // ค่า null ต้องไม่ทำให้เกิดสัญญาณตัดกัน
  assert.equal(crossOver([null, 1], [null, 0], 1), false);
  assert.equal(crossOver([0, 1], [1, 0], 1), true);
  assert.equal(crossUnder([1, 0], [0, 1], 1), true);
  assert.equal(crossOver([1, 1], [0, 0], 1), false, 'อยู่เหนืออยู่แล้วไม่ใช่การตัด');
});

test('V2 ATR and DMI follow Wilder on a pure trend', () => {
  const up = prices(Array.from({ length: 40 }, (_, i) => 100 + i));
  const d = dmi(up, 3, 3);
  assert.ok(d.plusDI.slice(6).every(v => v !== null && v > 0));
  assert.ok(d.minusDI.slice(6).every(v => v === 0));
  assert.ok(d.adx[20]! > 90, 'เทรนด์เดียวทางต้องให้ ADX สูง');
  const flat = prices(new Array(30).fill(100));
  assert.ok(atr(flat, 14).slice(14).every(v => v === 2), 'High-Low คงที่ 2 หน่วย');
});

test('V2 pivots are only usable after right-hand confirmation', () => {
  const k = prices([1, 2, 3, 10, 3, 2, 1]);
  const { pivotHighs } = findPivots(k, 2, 2);
  assert.equal(pivotHighs.length, 1);
  assert.equal(pivotHighs[0].index, 3);
  assert.equal(pivotHighs[0].confirmedAt, 5, 'รู้ว่าเป็น pivot ได้ที่แท่ง index + right เท่านั้น');
});

test('V2 registry covers all 20 documented indicators and 40 strategies', () => {
  assert.equal(V2_INDICATORS.length, 20);
  assert.equal(V2_STRATEGY_IDS.length, 40);
  assert.deepEqual(
    V2_INDICATORS.map(d => d.docIndex),
    Array.from({ length: 20 }, (_, i) => i + 1),
    'ต้องครบและเรียงตามลำดับในเอกสาร',
  );
  const keys = new Set(V2_INDICATORS.map(d => d.key));
  assert.equal(keys.size, 20, 'คีย์ผลลัพธ์ต้องไม่ซ้ำกัน');
  for (const id of V2_STRATEGY_IDS) {
    assert.ok(isV2StrategyId(id));
    // ทุกพารามิเตอร์ต้องมีคำอธิบายและขอบเขต ไม่งั้น UI จะแสดงชื่อดิบและ validate จะใช้ค่าคาดเดา
    for (const key of Object.keys(v2Defaults(id)))
      assert.ok(V2_PARAM_META[key], `ขาด V2_PARAM_META สำหรับ ${key} (${id})`);
  }
  assert.equal(isV2StrategyId('rsi'), false, 'กลยุทธ์ v1 ต้องไม่ถูกจับเป็น v2');
});

test('V2 defaults sit inside their own declared bounds', () => {
  for (const id of V2_STRATEGY_IDS) {
    const defaults = v2Defaults(id);
    for (const [key, value] of Object.entries(defaults)) {
      const meta = V2_PARAM_META[key];
      assert.ok(value >= meta.min && value <= meta.max, `${id}.${key} = ${value} อยู่นอก ${meta.min}–${meta.max}`);
      if (meta.integer) assert.ok(Number.isInteger(value), `${id}.${key} ต้องเป็นจำนวนเต็ม`);
    }
    assert.equal(validateV2Params(id, defaults), null, `ค่าเริ่มต้นของ ${id} ต้องผ่านการตรวจความสัมพันธ์`);
  }
});

test('V2 every strategy produces aligned signals through the whole stack', () => {
  for (const id of V2_STRATEGY_IDS) {
    if (id.startsWith('lorentzian')) continue; // ตรวจแยกด้านล่างเพราะต้องใช้แท่งจำนวนมาก
    const params = v2Defaults(id);
    const direct = v2SignalOf(id, computeV2(id, fixture, params, 0)).map(s => s ?? 'HOLD');
    const viaStack = computeSignals(fixture, id, params, { confirmedPivots: true, startIndex: 0 });
    assert.equal(viaStack.length, fixture.length, `${id}: ความยาวสัญญาณต้องเท่าจำนวนแท่ง`);
    // เส้นทางผ่าน backtest ต้องเป็นสัญญาณดิบของอินดิเคเตอร์ตัวเดียวกัน หลังผ่านกฎสลับเปิด-ปิด
    // ไม่ใช่สัญญาณดิบตรง ๆ เพราะ STRATEGY_FNS บังคับกฎนั้นให้ทุกผู้เรียกแล้ว
    assert.deepEqual(viaStack, alternateSignals(direct), `${id}: เส้นทางผ่าน backtest ต้องให้ผลเดียวกับการเรียกตรงแล้วบังคับกฎสลับ`);
    assert.ok(viaStack.every(s => s === 'BUY' || s === 'SELL' || s === 'HOLD'));
    // และผลที่ออกมาต้องสลับซื้อ-ขายจริง โดยเริ่มด้วยซื้อเสมอ
    const acted = viaStack.filter(s => s !== 'HOLD');
    for (let i = 0; i < acted.length; i++)
      assert.equal(acted[i], i % 2 === 0 ? 'BUY' : 'SELL', `${id}: สัญญาณลำดับที่ ${i} ต้องสลับซื้อ-ขาย`);
  }
});

test('V2 signals never change when future candles are added', () => {
  // ตัดท้ายออกแล้วคำนวณใหม่ สัญญาณของแท่งเดิมต้องเหมือนเดิมทุกตัว มิฉะนั้นคือมองอนาคต
  const cut = fixture.slice(0, fixture.length - 40);
  for (const id of V2_STRATEGY_IDS) {
    if (id.startsWith('lorentzian')) continue;
    const params = v2Defaults(id);
    const full = computeSignals(fixture, id, params, { confirmedPivots: true, startIndex: 0 });
    const prefix = computeSignals(cut, id, params, { confirmedPivots: true, startIndex: 0 });
    assert.deepEqual(prefix, full.slice(0, prefix.length), `${id}: ข้อมูลแท่งใหม่เปลี่ยนสัญญาณของอดีต`);
  }
});

test('V2 baseline rules follow the documented readings', () => {
  // RSI ใช้ "จุดตัดขากลับ" ไม่ใช่สภาวะค้างในโซน จึงต้องไม่ยิง BUY ซ้ำทุกแท่งที่ต่ำกว่าเกณฑ์
  const dip = prices([100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72, 74, 76, 78, 80, 82, 84]);
  const r = rsiV2(dip, { rsiLength: 5 });
  assert.ok(r.rsi.slice(6).every(v => v !== null));
  assert.ok(r.signal.filter(s => s === 'BUY').length <= 1, 'ขาลงยาวแล้วเด้งครั้งเดียวต้องได้ BUY ไม่เกินหนึ่งครั้ง');
  // MACD v2 ใช้ EMA เป็นเส้น Signal ตามสูตรมาตรฐาน (ต่างจาก v1 ที่ใช้ SMA)
  const m = macdV2(fixture);
  const manual = ema(m.macd, 9);
  assert.deepEqual(m.signalLine, manual);
  // Supertrend พลิกสถานะจึงให้สัญญาณ ไม่ใช่ทุกแท่งที่อยู่ในเทรนด์เดียวกัน
  const st = supertrendV2(fixture);
  st.signal.forEach((s, i) => {
    if (s !== null && i > 0) assert.notEqual(st.trend[i], st.trend[i - 1], 'สัญญาณต้องเกิดเฉพาะแท่งที่ทิศเปลี่ยน');
  });
});

test('V2 Ichimoku cloud uses displaced past values, never future ones', () => {
  const k = fixture;
  const r = ichimokuV2(k, { ichimokuDisplacement: 26 });
  // spanAAt ที่แท่ง t ต้องเท่ากับค่าที่คำนวณได้จากแท่ง t-26 ซึ่งรู้ค่าแล้ว
  for (let i = 26 + 52; i < k.length; i++) {
    const t = r.tenkan[i - 26], kj = r.kijun[i - 26];
    if (t === null || kj === null) continue;
    assert.ok(Math.abs(r.spanAAt[i]! - (t + kj) / 2) < 1e-9);
  }
  assert.ok(r.spanAAt.slice(0, 26).every(v => v === null), 'ยังไม่มีข้อมูลย้อนหลังพอต้องเป็น null');
});

test('V2 anchored VWAP restarts on its anchor and exposes the bar count', () => {
  const day = 24;
  const k = prices(Array.from({ length: day * 3 }, (_, i) => 100 + (i % day)));
  const r = vwapV2(k, { vwapAnchorMode: 1 });
  assert.equal(r.barsSinceAnchor[0], 0);
  assert.equal(r.barsSinceAnchor[1], 1);
  assert.equal(r.barsSinceAnchor[day], 0, 'ข้ามวันแล้วต้องเริ่มนับใหม่');
  // แท่งแรกของรอบ VWAP ต้องเท่ากับ typical price ของแท่งนั้นพอดี
  assert.ok(Math.abs(r.vwap[day]! - (+k[day].high + +k[day].low + +k[day].close) / 3) < 1e-9);
});

test('V2 Volume Profile keeps VAL <= POC <= VAH and ignores the current bar', () => {
  const r = volumeProfileV2(fixture, { profileLength: 60, profileBinCount: 20 });
  let checked = 0;
  r.poc.forEach((poc, i) => {
    if (poc === null) return;
    checked++;
    assert.ok(r.val[i]! <= poc + 1e-9 && poc <= r.vah[i]! + 1e-9, `แท่ง ${i}: VAL <= POC <= VAH`);
  });
  assert.ok(checked > 100, 'ต้องมีแท่งที่คำนวณได้จริงพอสมควร');
  assert.ok(r.poc.slice(0, 60).every(v => v === null), 'ช่วงอุ่นเครื่องต้องเป็น null');
});

test('V2 trade filter enters only when every gate passes and exits on its stop', () => {
  // ขาขึ้นชัดเจน: เจตนา BUY ที่ปลายเทรนด์ต้องผ่านตัวกรองและได้ stop ที่ต่ำกว่าราคาปิด
  const up = prices(Array.from({ length: 300 }, (_, i) => 100 + i));
  const intent = up.map((_, i) => (i === 280 ? 'BUY' : null)) as (('BUY' | 'SELL' | null)[]);
  const ok = applyTradeFilter(up, intent, TRADE_FILTER_DEFAULTS, 0);
  assert.equal(ok.signal[280], 'BUY');
  assert.ok(ok.stop[280]! < +up[280].close);
  assert.equal(ok.passed[280], true);
  // ขาลงชัดเจน: เจตนาเดียวกันต้องถูกปฏิเสธพร้อมเหตุผล
  const down = prices(Array.from({ length: 300 }, (_, i) => 400 - i));
  const blocked = applyTradeFilter(down, intent, TRADE_FILTER_DEFAULTS, 0);
  assert.equal(blocked.signal[280], null);
  assert.equal(blocked.passed[280], false);
  assert.match(blocked.reason[280]!, /งดเข้า/);
  // trailing stop เลื่อนขึ้นอย่างเดียว ห้ามลดลง
  const trail = ok.stop.filter((v): v is number => v !== null);
  for (let i = 1; i < trail.length; i++) assert.ok(trail[i] >= trail[i - 1], 'stop ต้องไม่ถอยลง');
});

test('V2 reversion indicators skip the gates that are false by construction', () => {
  // ออสซิลเลเตอร์ให้สัญญาณตอนราคาอ่อนแรง จึงต้องไม่ถูกบังคับว่าราคาต้องอยู่เหนือ EMA เทรนด์
  const reversionIds = ['rsi_v2_filtered', 'stochastic_v2_filtered', 'stoch_rsi_v2_filtered', 'wavetrend_v2_filtered'] as V2StrategyId[];
  for (const id of reversionIds) {
    const result = computeV2(id, fixture, v2Defaults(id), 0);
    const rejected = result.filterReason.filter(r => r?.includes('ราคาปิดต่ำกว่า EMA เทรนด์')).length;
    assert.equal(rejected, 0, `${id}: โหมดซื้อย่อต้องไม่ใช้เงื่อนไขราคาเหนือ EMA เทรนด์`);
    const diPass = result.filterReason.filter(r => r?.includes('+DI ไม่เหนือ')).length;
    assert.equal(diPass, 0, `${id}: โหมดซื้อย่อต้องไม่ใช้เงื่อนไข +DI > −DI`);
  }
  // ตัวเข้าตามแรงยังต้องใช้เงื่อนไขเหล่านั้นอยู่
  const trendStyle = computeV2('supertrend_v2_filtered', fixture, v2Defaults('supertrend_v2_filtered'), 0);
  assert.ok(trendStyle.filterReason.some(r => r?.includes('ราคาปิดต่ำกว่า EMA เทรนด์') || r?.includes('+DI ไม่เหนือ')));
});

test('V2 filtered mode never trades more than its own baseline', () => {
  for (const def of V2_INDICATORS) {
    if (def.id === 'lorentzian_v2') continue;
    const filteredId = `${def.id}_filtered` as V2StrategyId;
    const r = computeV2(filteredId, fixture, v2Defaults(filteredId), 0);
    const rawBuys = r.signal.filter(s => s === 'BUY').length;
    const gatedBuys = r.signalFiltered.filter(s => s === 'BUY').length;
    assert.ok(gatedBuys <= rawBuys, `${def.id}: ตัวกรองต้องไม่สร้างสัญญาณเข้าเพิ่ม (${gatedBuys} > ${rawBuys})`);
    // โหมดมีตัวกรองต้องสลับ BUY/SELL เสมอ เพราะบริหารสถานะเอง
    const ordered = r.signalFiltered.filter((s): s is 'BUY' | 'SELL' => s !== null);
    ordered.forEach((s, i) => assert.equal(s, i % 2 === 0 ? 'BUY' : 'SELL', `${def.id}: ลำดับสัญญาณต้องสลับกัน`));
  }
});

test('V2 Lorentzian is causal and both neighbour pools work', () => {
  // ต้องมีแท่งมากกว่า maxBarsBack จึงจะเริ่มทำนาย ใช้ค่าเล็กลงเพื่อให้ fixture พอ
  const params = { ...v2Defaults('lorentzian_v2'), lorentzianMaxBarsBack: 200 };
  for (const pool of [1, 2]) {
    const r = lorentzianV2(fixture, { ...params, lorentzianNeighborPool: pool }, 0);
    assert.ok(r.prediction.slice(0, 200).every(v => v === null), 'ก่อนครบ maxBarsBack ต้องยังไม่ทำนาย');
    assert.ok(r.prediction.slice(200).some(v => v !== null), 'หลังจากนั้นต้องมีค่าทำนาย');
    const neighbours = v2Defaults('lorentzian_v2').lorentzianNeighborsCount;
    assert.ok(r.prediction.every(v => v === null || Math.abs(v) <= neighbours), 'ผลรวมป้ายกำกับต้องไม่เกินจำนวนเพื่อนบ้าน');
  }
  const cut = fixture.slice(0, fixture.length - 30);
  const full = lorentzianV2(fixture, params, 0).signal;
  const prefix = lorentzianV2(cut, params, 0).signal;
  assert.deepEqual(prefix, full.slice(0, prefix.length), 'แท่งอนาคตต้องไม่เปลี่ยนสัญญาณของอดีต');
});

test('V2 is wired into every registry the web UI depends on', () => {
  assert.equal(STRATEGIES.filter(s => s.version !== 2 && s.version !== 3).length, 13, 'กลยุทธ์เดิมต้องคงเหลือ 13 ตัว');
  assert.equal(STRATEGIES.filter(s => s.version === 2).length, 40, 'v2 ต้องมี 40 ตัว');
  for (const id of V2_STRATEGY_IDS) {
    const config = STRATEGIES.find(s => s.id === id);
    assert.ok(config, `${id} ต้องอยู่ใน STRATEGIES`);
    assert.equal(config.version, 2);
    assert.ok(config.group && config.paramMeta && config.defaultOverlay, `${id} ต้องส่ง metadata ครบให้ UI`);
    assert.ok(STRATEGY_FNS[id], `${id} ต้องมีตัวสร้างสัญญาณ`);
    assert.ok(RULES[id] && RULES[id].length > 120, `${id} ต้องมีคำอธิบายกฎสำหรับไฟล์ Export`);
    assert.equal(INDICATOR_KEY[id], resolveV2Strategy(id).def.key);
    assert.equal(INDICATOR_KEYS[id], resolveV2Strategy(id).def.key);
  }
  // กลยุทธ์เดิมต้องไม่ถูกแตะต้อง
  for (const id of ['rsi', 'supertrend', 'ut_bot'] as const) {
    const config = STRATEGIES.find(s => s.id === id)!;
    assert.equal(config.version, 1);
    assert.equal(config.paramMeta, undefined);
  }
});

test('V2 only computes the indicator its own strategy needs', () => {
  const ind = computeStrategyIndicators(fixture, 'rsi_v2', v2Defaults('rsi_v2'), {
    confirmedPivots: true, lazyIndicators: true, startIndex: 0,
  });
  assert.ok(ind.rsiV2, 'ตัวที่เลือกต้องถูกคำนวณ');
  assert.equal(ind.macdV2, undefined, 'ตัวอื่นต้องไม่ถูกคำนวณ ไม่งั้นเสียเวลาและเพิ่มคอลัมน์เกินจำเป็น');
  const v1 = computeStrategyIndicators(fixture, 'rsi', { period: 14 }, { confirmedPivots: true, lazyIndicators: true });
  assert.equal(v1.rsiV2, undefined, 'กลยุทธ์ v1 ต้องไม่ลากอินดิเคเตอร์ v2 มาด้วย');
});

test('V2 request validation uses the declared bounds and relationships', () => {
  const base = {
    symbol: 'BTCUSDT', interval: '1h', intervals: ['1h'], source: 'latest', limit: 500,
    strategies: ['rsi_v2_filtered'], selected: 'rsi_v2_filtered', fee: 0.1, slippage: 0.05, mode: 'next_open',
  };
  const ok = validate({ ...base, params: { rsi_v2_filtered: { rsiLength: 21, filterStopAtr: 4.5 } } });
  assert.equal(ok.params.rsi_v2_filtered.rsiLength, 21);
  assert.equal(ok.params.rsi_v2_filtered.filterStopAtr, 4.5);
  assert.equal(ok.params.rsi_v2_filtered.filterMaxHoldBars, TRADE_FILTER_DEFAULTS.filterMaxHoldBars, 'ค่าที่ไม่ส่งมาต้องใช้ค่าเริ่มต้น');
  // 2000 เกินขอบเขต 400 ของ rsiLength — ถ้าไม่ใช้ paramMeta ค่านี้จะหลุดผ่าน
  assert.throws(() => validate({ ...base, params: { rsi_v2_filtered: { rsiLength: 2000 } } }), /rsiLength/);
  // ความสัมพันธ์ระหว่างพารามิเตอร์
  assert.throws(
    () => validate({ ...base, params: { rsi_v2_filtered: { rsiBuyThreshold: 80, rsiSellThreshold: 20 } } }),
    /Oversold/,
  );
  // Lorentzian ต้องการ warmup มากกว่าปกติ เพราะไม่ทำนายจนกว่าจะครบ maxBarsBack
  const heavy = validate({ ...base, strategies: ['lorentzian_v2'], selected: 'lorentzian_v2', params: {} });
  assert.equal(warmupBars(heavy), v2WarmupBars('lorentzian_v2', v2Defaults('lorentzian_v2')));
  assert.ok(warmupBars(heavy) > 2000);
  // กลยุทธ์ v1 ล้วนต้องได้ warmup เท่าเดิมทุกประการ
  const legacy = validate({ ...base, strategies: ['rsi'], selected: 'rsi', params: {} });
  assert.equal(warmupBars(legacy), 300);
});

// ══ กฎสลับเปิด–ปิดของสตรีมสัญญาณ (ใช้กับทุกเวอร์ชัน) ══════════

test('alternateSignals: กลยุทธ์ทางเดียวได้ BUY → SELL → BUY → SELL เป๊ะ ๆ', () => {
  const raw: SignalAction[] = ['BUY', 'BUY', 'BUY', 'HOLD', 'SELL', 'SELL', 'BUY', 'HOLD', 'SELL'];
  assert.deepEqual(alternateSignals(raw),
    ['BUY', 'HOLD', 'HOLD', 'HOLD', 'SELL', 'HOLD', 'BUY', 'HOLD', 'SELL']);
  // ความยาวต้องเท่าเดิมเสมอ เพราะดัชนีของสัญญาณผูกกับดัชนีของแท่ง
  assert.equal(alternateSignals(raw).length, raw.length);
  // ขายก่อนซื้อครั้งแรกต้องถูกตัดทิ้ง เพราะบัญชี Spot ไม่มีของให้ขาย
  assert.deepEqual(alternateSignals(['SELL', 'SELL', 'BUY', 'SELL']), ['HOLD', 'HOLD', 'BUY', 'SELL']);
  // สัญญาณของกลยุทธ์สองทางต้องไม่หลุดเข้ามาในกลยุทธ์ทางเดียว
  assert.deepEqual(alternateSignals(['SHORT', 'COVER', 'BUY']), ['HOLD', 'HOLD', 'BUY']);
  assert.deepEqual(alternateSignals([]), []);
  assert.deepEqual(alternateSignals(['HOLD', 'HOLD']), ['HOLD', 'HOLD']);
});

test('alternateSignals: กลยุทธ์สองทางปิดก่อนเปิดใหม่ได้ และพลิกข้างได้ แต่เปิดซ้ำไม่ได้', () => {
  // ปิดแล้วเปิดใหม่: SELL ปิดสถานะซื้อ แล้ว SHORT เปิดสถานะขาย — ทั้งคู่ต้องผ่าน
  assert.deepEqual(alternateSignals(['BUY', 'SELL', 'SHORT', 'COVER'], true),
    ['BUY', 'SELL', 'SHORT', 'COVER']);
  // พลิกข้างโดยไม่ผ่านสถานะว่างก็ต้องผ่าน เพราะตัวจำลองสองทางรองรับ
  assert.deepEqual(alternateSignals(['BUY', 'SHORT', 'BUY'], true), ['BUY', 'SHORT', 'BUY']);
  // เปิดซ้ำทางเดิมโดยยังไม่ปิด คือสิ่งเดียวที่ต้องถูกตัด
  assert.deepEqual(alternateSignals(['BUY', 'BUY', 'SELL'], true), ['BUY', 'HOLD', 'SELL']);
  assert.deepEqual(alternateSignals(['SHORT', 'SHORT', 'COVER'], true), ['SHORT', 'HOLD', 'COVER']);
  // ปิดสถานะที่ไม่ได้ถืออยู่ต้องถูกตัด
  assert.deepEqual(alternateSignals(['COVER', 'BUY', 'COVER', 'SELL'], true), ['HOLD', 'BUY', 'HOLD', 'SELL']);
});

test('alternateSignals: เป็นการสแกนไปข้างหน้าอย่างเดียว จึงไม่มีทางมองอนาคต', () => {
  const raw: SignalAction[] = ['BUY', 'BUY', 'SELL', 'SELL', 'BUY', 'HOLD', 'SELL', 'BUY', 'BUY', 'SELL'];
  const full = alternateSignals(raw);
  for (let end = 0; end <= raw.length; end++)
    assert.deepEqual(alternateSignals(raw.slice(0, end)), full.slice(0, end), `prefix ${end}`);
});

test('alternateSignals: ทุกกลยุทธ์ที่ลงทะเบียนผ่านกฎนี้แล้ว ไม่มีทางเลี่ยง', () => {
  // ตารางที่ส่งออกต้องเป็นตัวที่ห่อแล้ว ไม่ใช่ตัวดิบ — engine.ts เรียกตารางนี้ตรง ๆ
  for (const cfg of STRATEGIES) {
    const signals = computeSignals(fixture, cfg.id, cfg.params, { confirmedPivots: true, startIndex: 0 });
    const viaTable = STRATEGY_FNS[cfg.id](
      fixture, computeStrategyIndicators(fixture, cfg.id, cfg.params, { confirmedPivots: true, startIndex: 0 }), cfg.params);
    assert.deepEqual(viaTable, signals, `${cfg.id}: สองเส้นทางต้องให้ผลเดียวกัน`);
    let state = 'flat';
    for (let i = 0; i < signals.length; i++) {
      const s = signals[i];
      if (s === 'HOLD') continue;
      if (s === 'BUY') { assert.notEqual(state, 'long', `${cfg.id}: ซื้อซ้ำขณะถือของอยู่ที่แท่ง ${i}`); state = 'long'; }
      else if (s === 'SELL') { assert.equal(state, 'long', `${cfg.id}: ขายขณะไม่ได้ถือของที่แท่ง ${i}`); state = 'flat'; }
      else if (s === 'SHORT') { assert.notEqual(state, 'short', `${cfg.id}: เปิดขายซ้ำที่แท่ง ${i}`); state = 'short'; }
      else if (s === 'COVER') { assert.equal(state, 'short', `${cfg.id}: ปิดขายขณะไม่ได้เปิดขายที่แท่ง ${i}`); state = 'flat'; }
    }
  }
});
