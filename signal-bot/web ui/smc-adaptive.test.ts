import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { smcAdaptive, SMC_ADAPTIVE_DEFAULTS } from '../../lib/indicators';
import { computeSignals } from '../../lib/backtest';
import { parseKline, type KlineData } from '../../lib/types/kline';
import { analyze, simulateNextOpen } from './engine';
import { calculateExport } from './export-calculations';
import { validate, warmupBars } from './data';
const fixture: KlineData[] = JSON.parse(fs.readFileSync(new URL('../../freqtrade/fixtures/BTCUSDT-1h.json', import.meta.url), 'utf8')).map(parseKline);

test('SMC Adaptive: every fixture prefix preserves signals and historical risk levels', () => {
  const full = smcAdaptive(fixture);
  for (let end = 0; end <= fixture.length; end++) {
    const prefix = smcAdaptive(fixture.slice(0, end));
    for (const key of ['signal', 'stop', 'target', 'regime', 'reason', 'support', 'resistance'] as const)
      assert.deepEqual(prefix[key], full[key].slice(0, end), `${key} at ${end}`);
  }
});

test('SMC Adaptive: future price shocks cannot change earlier signals or stop levels', () => {
  const full = smcAdaptive(fixture);
  const altered = fixture.map((bar, i) => i < 500 ? bar : {
    ...bar, open: String(+bar.open * 20), high: String(+bar.high * 20),
    low: String(+bar.low * 20), close: String(+bar.close * 20),
  });
  const future = smcAdaptive(altered);
  assert.deepEqual(future.signal.slice(0, 500), full.signal.slice(0, 500));
  assert.deepEqual(future.stop.slice(0, 500), full.stop.slice(0, 500));
});

test('SMC Adaptive: warmup carries features but no position, exports and both engines agree', () => {
  // Faster settings ensure the fixture includes an active warmup position.
  const params = { ...SMC_ADAPTIVE_DEFAULTS, internalSize: 5, trendPeriod: 100, rsiThreshold: 40 };
  const full = smcAdaptive(fixture, params);
  const start = full.position.findIndex((v, i) => v && i > 220 && full.signal[i] !== 'BUY');
  assert.ok(start > 220);
  const reset = smcAdaptive(fixture, params, start);
  assert.ok(reset.signal.slice(0, start).every(x => x === null));
  assert.ok(reset.position.slice(0, start).every(x => !x));
  const first = reset.signal.slice(start).find(x => x !== null);
  assert.equal(first, 'BUY');
  const exported = calculateExport(fixture, start, 'smc_adaptive', params, .1, .05, 'both');
  const a = analyze(fixture, start, 'smc_adaptive', params, .1, .05, 'both', true);
  assert.deepEqual(exported.records.map(x => x.signal), a.signals);
  assert.deepEqual(a.signals, computeSignals(fixture, 'smc_adaptive', params, { startIndex: start }).slice(start));
  assert.deepEqual(exported.simulations, a.simulations);
  assert.ok(a.simulations.every(s => s.trades.every(t => t.entryIdx >= start)));
});

test('SMC Adaptive: signals alternate, stops only tighten, fills use next open', () => {
  const p = { ...SMC_ADAPTIVE_DEFAULTS, internalSize: 5, trendPeriod: 100, rsiThreshold: 40 };
  const r = smcAdaptive(fixture, p);
  let held = false, lastStop = -Infinity, buys = 0, sells = 0;
  for (let i = 0; i < fixture.length; i++) {
    if (r.signal[i] === 'BUY') {
      assert.equal(held, false); held = true; buys++;
      assert.ok(r.stop[i]! < +fixture[i].close);
      assert.ok(r.target[i]! > +fixture[i].close);
      lastStop = r.stop[i]!;
    } else if (held) {
      assert.ok(r.stop[i]! >= lastStop);
      lastStop = r.stop[i]!;
    }
    if (r.signal[i] === 'SELL') { assert.ok(held); held = false; sells++; }
    if (r.regime[i] === 'shock') assert.notEqual(r.signal[i], 'BUY');
  }
  assert.ok(buys > 0 && sells > 0);
  const sim = simulateNextOpen(fixture, r.signal.map(x => x ?? 'HOLD'), 0, .1, .05);
  for (const trade of sim.trades) {
    assert.equal(r.signal[trade.entryIdx - 1], 'BUY');
    assert.equal(trade.entryPrice, +fixture[trade.entryIdx].open * 1.0005);
    if (trade.reason !== 'ปิดเมื่อจบข้อมูล') assert.equal(r.signal[trade.exitIdx - 1], 'SELL');
  }
});

test('SMC Adaptive: close stop never promises an intrabar stop-price fill', () => {
  const p = { ...SMC_ADAPTIVE_DEFAULTS, internalSize: 5, trendPeriod: 100, rsiThreshold: 40 };
  const base = smcAdaptive(fixture, p);
  const buy = base.signal.indexOf('BUY');
  assert.ok(buy > 0);
  const k = fixture.slice(0, buy + 4).map(x => ({ ...x }));
  const stop = base.stop[buy]!;
  // A wick through the stop followed by a close above it must not fill a stop.
  k[buy + 1].low = String(stop * .9);
  k[buy + 1].close = k[buy].close;
  k[buy + 1].high = String(Math.max(+k[buy + 1].open, +k[buy + 1].close) * 1.01);
  const wick = smcAdaptive(k.slice(0, buy + 2), p);
  assert.notEqual(wick.reason[buy + 1], 'ATR close stop');
  k[buy + 2].close = String(stop * .95);
  k[buy + 2].low = String(stop * .94);
  k[buy + 2].high = String(Math.max(+k[buy + 2].open, +k[buy + 2].close) * 1.01);
  k[buy + 3].open = String(stop * .8);
  k[buy + 3].low = String(stop * .79);
  const result = smcAdaptive(k, p);
  assert.equal(result.reason[buy + 2], 'ATR close stop');
  const sim = simulateNextOpen(k, result.signal.map(x => x ?? 'HOLD'), 0, 0, 0);
  assert.equal(sim.trades.at(-1)!.exitPrice, stop * .8);
});

test('SMC Adaptive: empty, flat, warmup-only and invalid parameters', () => {
  assert.deepEqual(smcAdaptive([]).signal, []);
  assert.ok(smcAdaptive(fixture.slice(0, 100)).signal.every(x => x === null));
  assert.ok(smcAdaptive(fixture, {}, fixture.length).signal.every(x => x === null));
  const flat = fixture.map(x => ({ ...x, open: '100', high: '100', low: '100', close: '100' }));
  assert.ok(smcAdaptive(flat).signal.every(x => x === null));
  for (const params of [{ stopAtr: NaN }, { atrPeriod: 0 }, { internalSize: 30 }, { trendThreshold: 2 }, { rsiThreshold: 70 }])
    assert.throws(() => smcAdaptive(fixture, params));
  assert.throws(() => smcAdaptive(fixture, {}, -1));
  const request = { symbol: 'BTCUSDT', interval: '1h', source: 'latest', mode: 'next_open', strategy: 'smc_adaptive', selected: 'smc_adaptive', fee: .1, slippage: .05 };
  assert.equal(validate(request).params.smc_adaptive.trendPeriod, 200);
  assert.equal(warmupBars(validate(request)), 1000);
  assert.equal(warmupBars(validate({ ...request, strategy: 'rsi', selected: 'rsi' })), 300);
  assert.throws(() => validate({ ...request, params: { smc_adaptive: { internalSize: 50 } } }));
});
