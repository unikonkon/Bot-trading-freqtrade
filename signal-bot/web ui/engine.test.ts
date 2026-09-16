import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { simulateNextOpen, analyze } from "./engine";
import {
  computeSignals,
  computeStrategyIndicators,
  runBacktest,
  STRATEGIES,
} from "../../lib/backtest";
import {
  parseKline,
  type KlineData,
  type BinanceKlineRaw,
} from "../../lib/types/kline";

function bars(prices: number[]): KlineData[] {
  return prices.map((p, i) =>
    parseKline([
      i * 60000,
      String(p),
      String(p + 2),
      String(p - 2),
      String(p),
      "10",
      (i + 1) * 60000 - 1,
      "1000",
      10,
      "5",
      "500",
    ]),
  );
}
test("signal on close fills at following open, never at signal close", () => {
  const k = bars([100, 110, 120, 90]);
  k[1].open = "105";
  k[3].open = "115";
  const r = simulateNextOpen(k, ["BUY", "HOLD", "SELL", "HOLD"], 0, 0, 0);
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].entryPrice, 105);
  assert.equal(r.trades[0].exitPrice, 115);
  assert.equal(r.trades[0].entryTime, 60000);
  assert.equal(r.trades[0].exitTime, 180000);
  assert.ok(Math.abs(r.returnPct - (115 / 105 - 1) * 100) < 1e-10);
});
test("fees and adverse slippage apply on both legs", () => {
  const r = simulateNextOpen(
    bars([100, 100, 100]),
    ["BUY", "SELL", "HOLD"],
    0,
    1,
    2,
  );
  const expected = (100 / (102 * 1.01)) * 98 * 0.99;
  assert.ok(Math.abs(r.returnPct - (expected - 100)) < 1e-10);
  assert.equal(r.trades[0].entryPrice, 102);
  assert.equal(r.trades[0].exitPrice, 98);
});
test("warmup signals cannot open positions and final BUY has no future fill", () => {
  const r = simulateNextOpen(
    bars([100, 100, 100, 100]),
    ["BUY", "BUY", "HOLD", "BUY"],
    2,
    0,
    0,
  );
  assert.equal(r.totalTrades, 0);
  assert.deepEqual(r.equity, [0, 0]);
});
test("open position marks to market, drawdown captures loss before recovery, forced exit is explicit", () => {
  const k = bars([100, 100, 50, 110]);
  const r = simulateNextOpen(k, ["BUY", "HOLD", "HOLD", "HOLD"], 0, 0, 0);
  assert.equal(r.maxDrawdownPct, 50);
  assert.ok(Math.abs(r.returnPct - 10) < 1e-10);
  assert.equal(r.trades[0].reason, "ปิดเมื่อจบข้อมูล");
  assert.equal(r.trades[0].exitTime, k[3].closeTime);
});
test("portfolio compounds consecutive trades", () => {
  const r = simulateNextOpen(
    bars([100, 100, 110, 100, 110]),
    ["BUY", "SELL", "BUY", "SELL", "HOLD"],
    0,
    0,
    0,
  );
  assert.equal(r.totalTrades, 2);
  assert.ok(Math.abs(r.returnPct - 21) < 1e-10);
});
test("all HOLD and SELL-only sequences stay flat", () => {
  for (const signal of ["HOLD", "SELL"] as const) {
    const r = simulateNextOpen(
      bars([100, 90, 80]),
      [signal, signal, signal],
      0,
      0.1,
      0.05,
    );
    assert.equal(r.returnPct, 0);
    assert.equal(r.totalTrades, 0);
    assert.deepEqual(r.equity, [0, 0, 0]);
  }
});
for (const file of ["BTCUSDT-1h", "ETHUSDT-4h"]) {
  const k = (
    JSON.parse(
      fs.readFileSync(
        new URL(`../../freqtrade/fixtures/${file}.json`, import.meta.url),
        "utf8",
      ),
    ) as BinanceKlineRaw[]
  ).map(parseKline);
  test(`${file}: all strategies, legacy parity, shared indicators, warmup and signal causality samples`, () => {
    for (const s of STRATEGIES) {
      const original = runBacktest(k, s.id, s.params);
      const a = analyze(k, 0, s.id, s.params, 0.1, 0.05, "both", true);
      assert.equal(a.simulations[1].returnPct, original.totalPnlPct, s.id);
      assert.deepEqual(a.simulations[1].trades, original.trades, s.id);
      assert.deepEqual(a.signals, original.signals, s.id);
      assert.equal(a.simulations[0].equity.length, k.length);
      for (const cut of [200, 500, 999])
        assert.deepEqual(
          computeSignals(k.slice(0, cut), s.id, s.params),
          a.signals.slice(0, cut),
          s.id,
        );
      const warmed = analyze(k, 300, s.id, s.params, 0.1, 0.05, "both", true);
      assert.equal(warmed.signals.length, 700);
      for (const sim of warmed.simulations) {
        assert.equal(sim.equity.length, 700);
        assert.ok(sim.trades.every((t) => t.entryIdx >= 300));
      }
    }
  });
  test(`${file}: CDC parameter edits reach indicators and affect signals`, () => {
    const defaultInd = computeStrategyIndicators(k, "cdc_actionzone");
    const edited = computeStrategyIndicators(k, "cdc_actionzone", {
      fastPeriod: 3,
      slowPeriod: 8,
    });
    assert.notDeepEqual(
      defaultInd.cdcActionZone.fastMA,
      edited.cdcActionZone.fastMA,
    );
    assert.notDeepEqual(
      computeSignals(k, "cdc_actionzone"),
      computeSignals(k, "cdc_actionzone", { fastPeriod: 3, slowPeriod: 8 }),
    );
  });
}
