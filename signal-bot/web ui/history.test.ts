import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createKlineHandler } from "../../api/klines/route";
import { PriceSearch } from "../../lib/price-search";
import { computeAll } from "../../lib/indicators";
import { STRATEGIES } from "../../lib/backtest";
import { analyze, INDICATOR_KEYS } from "./engine";
import { loadData, validate } from "./data";
import { startJob, jobStatus, jobView, cancelJob } from "./history-jobs";
import { parseKline } from "../../lib/types/kline";
import { atomicJSON, validateBar, verifySegment, snapshotPath, readManifest, readBars, type Manifest } from "../../scripts/history-storage";

const epoch = Date.UTC(2025, 0, 1), ms = 60000;
const bar = (time: number) => parseKline([time, "100", "105", "95", "101", "10", time + ms - 1, "1010", 5, "5", "505"]);
function manifest(id: string, size = 40): Manifest {
  return { schemaVersion: 1, symbol: "BTCUSDT", market: "spot", source: "test fixture", snapshot: id, asOf: epoch + size * ms,
    createdAt: new Date().toISOString(), status: "downloading", records: [{ interval: "1m", years: 1,
      data: { file: "BTCUSDT-1m.jsonl", from: epoch, to: epoch + size * ms - 1, expected: size, status: "pending" },
      warmup: { file: "warmup/BTCUSDT-1m.jsonl", from: epoch - 1000 * ms, to: epoch - 1, expected: 1000, status: "pending" } }] };
}
const config = (snapshot: string) => validate({ source: "local", snapshot, symbol: "BTCUSDT", interval: "1m", strategy: "rsi", selected: "rsi", params: {}, fee: .1, slippage: .05, mode: "both" });

test("route validates before fetch, serializes requests, forwards weight and applies shared cooldown", async () => {
  let calls = 0, active = 0, maxActive = 0;
  const get = createKlineHandler({ gapMs: 0, fetch: async () => {
    calls++; active++; maxActive = Math.max(maxActive, active);
    await new Promise(r => setTimeout(r, 5)); active--;
    return Response.json([], { headers: { "X-MBX-USED-WEIGHT-1M": "12" } });
  }});
  const req = (query: string) => new Request(`http://localhost/api/klines?${query}`);
  assert.equal((await get(req("symbol=BTCUSDT&interval=1m&limit=1001"))).status, 400);
  assert.equal(calls, 0);
  const results = await Promise.all([get(req("symbol=BTCUSDT&interval=1m")), get(req("symbol=BTCUSDT&interval=1m"))]);
  assert.equal(maxActive, 1); assert.equal(results[0].headers.get("x-mbx-used-weight-1m"), "12");
  assert.equal(results[0].headers.get("cache-control"), "no-store");
  calls = 0;
  const limited = createKlineHandler({ gapMs: 0, fetch: async () => { calls++; return new Response("{}", { status: 429, headers: { "Retry-After": "60" } }); }});
  const a = await limited(req("symbol=BTCUSDT&interval=1m"));
  const b = await limited(req("symbol=BTCUSDT&interval=1m"));
  assert.equal(a.headers.get("retry-after"), "60"); assert.equal(b.status, 429); assert.equal(calls, 1);
});

test("indexed first-cross search agrees with chronological scans including equal thresholds", () => {
  const values = Array.from({ length: 257 }, (_, i) => Math.round(Math.sin(i * .79) * 20));
  for (const direction of ["min", "max"] as const) {
    const tree = new PriceSearch(values, direction);
    for (let start = 0; start <= values.length; start += 3) for (let threshold = -21; threshold <= 21; threshold++) for (const strict of [false, true]) {
      const expected = values.findIndex((v, i) => i >= start && (direction === "min" ? (strict ? v < threshold : v <= threshold) : (strict ? v > threshold : v >= threshold)));
      assert.equal(tree.first(start, threshold, strict), expected);
    }
  }
});

test("selected-only analysis preserves full-analysis signals, both simulations and selected indicator fields", async () => {
  const k = JSON.parse(await readFile(new URL("./research-mtf/data/BTCUSDT-1m.json", import.meta.url), "utf8")).slice(0, 900);
  const lazy = computeAll(k, { lazy: true });
  assert.equal(typeof Object.getOwnPropertyDescriptor(lazy, "smc")!.get, "function");
  void lazy.rsi;
  assert.equal(typeof Object.getOwnPropertyDescriptor(lazy, "smc")!.get, "function");
  for (const strategy of STRATEGIES) {
    const full = analyze(k, 300, strategy.id, strategy.params, .1, .05, "both", true);
    const selected = analyze(k, 300, strategy.id, strategy.params, .1, .05, "both", true, true);
    assert.deepEqual(selected.signals, full.signals, strategy.id);
    assert.deepEqual(selected.simulations, full.simulations, strategy.id);
    for (const [key, values] of Object.entries(selected.indicators)) assert.deepEqual(values, full.indicators[key], key);
    assert.ok(Object.keys(selected.indicators).every(k => k === INDICATOR_KEYS[strategy.id] || k.startsWith(INDICATOR_KEYS[strategy.id] + ".")));
  }
});

test("offline loader verifies checksums, filters ranges, excludes warmup from test and never calls Binance", async () => {
  const id = `test-offline-${process.pid}`, root = snapshotPath(id), m = manifest(id);
  await mkdir(path.join(root, "warmup"), { recursive: true });
  try {
    for (const segment of [m.records[0].warmup, m.records[0].data]) {
      await writeFile(path.join(root, segment.file), Array.from({ length: segment.expected }, (_, i) => JSON.stringify(bar(segment.from + i * ms)) + "\n").join(""));
      Object.assign(segment, await verifySegment(root, segment, ms), { status: "complete" });
    }
    m.status = "complete"; await atomicJSON(path.join(root, "manifest.json"), m);
    const cfg = config(id);
    const data = await loadData(cfg, async () => { throw Error("Network must not be used"); });
    assert.equal(data.start, 300); assert.equal(data.klines.length, 340); assert.equal(data.klines[data.start].openTime, epoch);
    const subset = await loadData({ ...cfg, from: epoch + 10 * ms, to: epoch + 20 * ms - 1 });
    assert.equal(subset.klines.length - subset.start, 10); assert.equal(subset.klines[subset.start].openTime, epoch + 10 * ms);
    await assert.rejects(loadData({ ...cfg, to: epoch + 999 * ms }), /นอกข้อมูล/);
    const job = startJob(cfg);
    for (let attempt = 0; attempt < 400 && jobStatus(job).status === "running"; attempt++) await new Promise(r => setTimeout(r, 20));
    const ready = jobStatus(job);
    assert.equal(ready.status, "ready", ready.error);
    assert.equal(ready.result.totalBars, 40);
    assert.equal(ready.result.detail.signals.length, 40);
    const window = await jobView(job, { strategy: "supertrend", offset: 10, count: 5, tradePage: 0 });
    assert.equal(window.klines[0].openTime, epoch + 10 * ms);
    assert.equal(window.klines.length, 5);
    assert.equal(window.detail.signals.length, 5);
    assert.ok(window.detail.simulations.every((s: { trades: unknown[] }) => s.trades.length <= 25));
    cancelJob(job); assert.equal(jobStatus(job).status, "cancelled");
    const cancelled = startJob(cfg); cancelJob(cancelled);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(jobStatus(cancelled).status, "cancelled");
    const file = path.join(root, m.records[0].data.file);
    await writeFile(file, (await readFile(file, "utf8")).replace('"101"', '"102"'));
    await assert.rejects(loadData(cfg), /Checksum/);
    assert.throws(() => snapshotPath("../escape"));
    assert.throws(() => validateBar({ ...bar(epoch), high: "90" }, ms));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("downloader resumes committed checkpoint, discards interrupted tail and verifies final file through local API", { timeout: 30000 }, async () => {
  const id = `test-resume-${process.pid}`, root = snapshotPath(id), m = manifest(id, 5), calls: number[] = [];
  m.records[0].warmup.expected = 2; m.records[0].warmup.from = epoch - 2 * ms;
  await mkdir(root, { recursive: true });
  const segment = m.records[0].data;
  const committed = [bar(epoch), bar(epoch + ms)].map(b => JSON.stringify(b) + "\n").join("");
  await atomicJSON(path.join(root, "manifest.json"), m);
  await writeFile(path.join(root, segment.file + ".partial"), committed + '{"interrupted":');
  await atomicJSON(path.join(root, segment.file + ".checkpoint.json"), { bars: 2, bytes: Buffer.byteLength(committed), next: epoch + 2 * ms });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    assert.equal(url.pathname, "/api/klines");
    const from = Number(url.searchParams.get("startTime")), to = Number(url.searchParams.get("endTime")); calls.push(from);
    const bars = [];
    for (let t = from; t + ms - 1 <= to && bars.length < 2; t += ms) {
      const b = bar(t); bars.push([b.openTime, b.open, b.high, b.low, b.close, b.volume, b.closeTime, b.quoteAssetVolume, b.numberOfTrades, b.takerBuyBaseVolume, b.takerBuyQuoteVolume, "0"]);
    }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(bars));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/download-history.ts", id], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { ...process.env, KLINES_URL: `http://127.0.0.1:${port}/api/klines` }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = ""; child.stdout.on("data", b => { output += b; }); child.stderr.on("data", b => { output += b; });
    const [code] = await once(child, "exit"); assert.equal(code, 0, output);
    const result = await readManifest(id); assert.equal(result.status, "complete");
    const rows = []; for await (const b of readBars(path.join(root, segment.file))) rows.push(b);
    assert.equal(rows.length, 5); assert.equal(rows.at(-1)!.closeTime, segment.to);
    assert.deepEqual(calls, [epoch - 2 * ms, epoch + 2 * ms, epoch + 4 * ms]);
  } finally { server.close(); await rm(root, { recursive: true, force: true }); }
});
