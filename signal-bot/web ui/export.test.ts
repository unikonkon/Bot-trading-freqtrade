import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  validateExport,
  captureExportSources,
  buildExportFiles,
  createExport,
  csvCell,
} from "./export";
import { validate } from "./data";
import { parseKline, type BinanceKlineRaw } from "../../lib/types/kline";
import { computeSignals, STRATEGIES } from "../../lib/backtest";
import { evaluateKlines } from "./evaluate-klines";
import { calculateExport } from "./export-calculations";
import { zipFiles } from "./zip";
const raw = JSON.parse(
  fs.readFileSync(
    new URL("../../freqtrade/fixtures/BTCUSDT-1h.json", import.meta.url),
    "utf8",
  ),
) as BinanceKlineRaw[];
const klines = raw.map(parseKline);
const cfg = validate({
  symbol: "BTCUSDT",
  interval: "1h",
  source: "latest",
  limit: 1000,
  strategy: "all",
  selected: "supertrend",
  params: { cdc_actionzone: { fastPeriod: 3, slowPeriod: 8 } },
  fee: 0.1,
  slippage: 0.05,
  mode: "both",
});
const run = {
  at: Date.now(),
  cfg,
  datasets: { "1h": { klines, start: 300, warnings: ["fixture"] } },
};
function unzip(buffer: Buffer) {
  const files: Record<string, string> = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18),
      nameLength = buffer.readUInt16LE(offset + 26),
      extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString();
    const start = offset + 30 + nameLength + extraLength;
    files[name] = inflateRawSync(
      buffer.subarray(start, start + compressedSize),
    ).toString();
    offset = start + compressedSize;
  }
  return files;
}
test("export validates selections, duplicates, unsafe/unknown IDs and empty requests", () => {
  for (const input of [
    null,
    {},
    { runId: "r", strategies: [] },
    { runId: "r", strategies: ["rsi", "rsi"] },
    { runId: "r", strategies: ["../../.env"] },
    { runId: "r", strategies: ["unknown"] },
    { runId: 4, strategies: ["rsi"] },
  ])
    assert.throws(() => validateExport(input));
  assert.deepEqual(
    validateExport({ runId: "r", strategies: ["supertrend", "rsi"] })
      .strategies,
    ["rsi", "supertrend"],
  );
});
test("selected export contains requested data only, full warmup, matching provenance and standalone code", async () => {
  const sources = await captureExportSources();
  const files = buildExportFiles("r", run, ["rsi", "cdc_actionzone"], sources);
  assert.ok(files["1h/signals/rsi.csv"].startsWith("\uFEFF"));
  assert.ok(!files["1h/signals/supertrend.csv"]);
  assert.equal(JSON.parse(files["1h/input-klines.json"]).length, 1000);
  const config = JSON.parse(files["config.json"]);
  assert.equal(config.datasets["1h"].startIndex, 300);
  assert.deepEqual(config.intervals, ["1h"]);
  assert.equal(config.params.cdc_actionzone.fastPeriod, 3);
  const c = JSON.parse(files["1h/calculations/cdc_actionzone.json"]);
  assert.equal(c.records.length, 700);
  assert.equal(c.records[0].index, 300);
  assert.equal(
    c.records[0].previous["cdcActionZone.fastMA"],
    c.series["cdcActionZone.fastMA"][299],
  );
  assert.deepEqual(
    c.records.map((r: { signal: string }) => r.signal),
    computeSignals(klines, "cdc_actionzone", cfg.params.cdc_actionzone).slice(
      300,
    ),
  );
  assert.ok(files["lib/indicators.ts"]);
  assert.ok(files["signal-bot/web ui/replay.ts"]);
  assert.ok(files["package-lock.json"]);
  assert.ok(
    !Object.keys(files).some((name) =>
      /\.env|state\.json|telegram\.ts|binanceSign/.test(name),
    ),
  );
  for (const [name, sha] of Object.entries(
    JSON.parse(files["manifest.json"]).sha256,
  ))
    assert.equal(createHash("sha256").update(files[name]).digest("hex"), sha);
});
test("all strategy exports use exact shared-library signals and preserve full structures", () => {
  for (const { id } of STRATEGIES) {
    const c = calculateExport(
      klines,
      300,
      id,
      cfg.params[id],
      0.1,
      0.05,
      "both",
    );
    assert.deepEqual(
      c.records.map((r) => r.signal),
      computeSignals(klines, id, cfg.params[id], { startIndex: 300 }).slice(300),
    );
    assert.equal(c.simulations.length, 2);
  }
  const smc = calculateExport(
    klines,
    300,
    "smc",
    cfg.params.smc,
    0.1,
    0.05,
    "both",
  );
  assert.ok("internalStructures" in (smc.indicator as object));
});
test("download ZIP contains UTF-8 metadata and exact input without path escapes", async () => {
  const archive = createExport(
    "r",
    run,
    ["supertrend"],
    await captureExportSources(),
  );
  const files = unzip(archive);
  assert.equal(
    files["1h/input-klines.json"],
    JSON.stringify(klines, null, 2) + "\n",
  );
  assert.match(files["README.md"], /คำนวณซ้ำ/);
  assert.ok(files["1h/trades/supertrend-next_open.csv"]);
  assert.throws(() => zipFiles({ "../escape": "bad" }));
  assert.throws(() => zipFiles({ "/absolute": "bad" }));
});
test("CSV quotes multiline/Thai correctly and neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(-2), '"-2"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell("ซื้อ,\nขาย"), '"ซื้อ,\nขาย"');
});
test("API adapter excludes unfinished candles and matches the exported signal library", () => {
  const rows = evaluateKlines(
    raw,
    "supertrend",
    cfg.params.supertrend,
    klines.at(-1)!.openTime + 1,
  );
  assert.equal(rows.length, 999);
  assert.deepEqual(
    rows.map((r) => r.signal),
    computeSignals(klines.slice(0, 999), "supertrend", cfg.params.supertrend),
  );
});
