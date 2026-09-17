import { mkdir, readFile, open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { parseKline, type BinanceKlineRaw } from "../lib/types/kline";
import { atomicJSON, validateBar, validateManifest, verifySegment, PERIODS, snapshotPath, type Segment, type Manifest } from "./history-storage";

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
const id = process.argv[2] ?? new Date().toISOString().replace(/[:.]/g, "-");
const root = snapshotPath(id);
const endpoint = new URL(process.env.KLINES_URL ?? "http://127.0.0.1:4311/api/klines");
if (!["127.0.0.1", "localhost"].includes(endpoint.hostname) || endpoint.pathname !== "/api/klines") throw Error("KLINES_URL must point to the local /api/klines adapter");
const progressFile = path.join(root, "progress.json");
let requests = 0, retries = 0;
async function page(interval: string, from: number, to: number) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ symbol: "BTCUSDT", interval, limit: "1000", startTime: String(from), endTime: String(to) }).toString();
  for (let attempt = 0; attempt < 12; attempt++) {
    if (stopping) throw Error("Stopped safely; run again with the same snapshot ID to resume");
    await pause(2000 + Math.random() * 250);
    if (stopping) throw Error("Stopped safely; checkpoint preserved");
    let response: Response;
    try { requests++; response = await fetch(url, { signal: AbortSignal.timeout(30000) }); }
    catch (e) { retries++; console.log(`Network retry ${attempt + 1}: ${e}`); await pause(Math.min(60000, 2000 * 2 ** attempt)); continue; }
    if (response.ok) {
      const raw: unknown = await response.json();
      if (!Array.isArray(raw)) throw Error("Invalid API response");
      return raw.map(row => {
        if (!Array.isArray(row) || row.length < 11) throw Error("Invalid Binance kline tuple");
        return parseKline(row as BinanceKlineRaw);
      });
    }
    if (response.status === 429 || response.status === 418 || response.status >= 500) {
      retries++;
      const retry = Number(response.headers.get("retry-after"));
      const wait = response.status < 500 ? (Number.isFinite(retry) && retry > 0 ? retry + 1 : 61) * 1000 : Math.min(60000, 2000 * 2 ** attempt);
      console.log(`HTTP ${response.status}; pause ${Math.ceil(wait / 1000)}s`);
      // Save long cooldowns: restarting the downloader cannot bypass an upstream ban.
      await atomicJSON(path.join(root, "cooldown.json"), { until: Date.now() + wait });
      for (let remaining = wait; remaining > 0 && !stopping; remaining -= 1000) await pause(Math.min(remaining, 1000));
      continue;
    }
    throw Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  throw Error("Retry budget exhausted; checkpoint preserved");
}
async function segment(m: Manifest, rec: Manifest["records"][number], s: Segment) {
  const ms = PERIODS[rec.interval], file = path.join(root, s.file), partial = file + ".partial", cpFile = file + ".checkpoint.json";
  await mkdir(path.dirname(file), { recursive: true });
  if (s.status === "complete") { await verifySegment(root, s, ms); return; }
  // Recover crash between rename and manifest update.
  if (await stat(file).then(() => true, e => { if (e.code === "ENOENT") return false; throw e; })) {
    Object.assign(s, await verifySegment(root, s, ms), { status: "complete" });
    await atomicJSON(path.join(root, "manifest.json"), m); return;
  }
  let cp = { bars: 0, bytes: 0, next: s.from };
  try { cp = JSON.parse(await readFile(cpFile, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  if (!Number.isSafeInteger(cp.bars) || cp.bars < 0 || cp.bars > s.expected || cp.next !== s.from + cp.bars * ms || !Number.isSafeInteger(cp.bytes) || cp.bytes < 0)
    throw Error(`Invalid checkpoint: ${cpFile}`);
  const handle = await open(partial, "a+");
  try {
    if ((await handle.stat()).size < cp.bytes) throw Error("Partial file is shorter than committed checkpoint");
    await handle.truncate(cp.bytes); // Remove an uncommitted tail after interruption.
    while (cp.next <= s.to) {
      const batch = await page(rec.interval, cp.next, s.to);
      if (!batch.length) throw Error(`Missing data at ${rec.interval} ${new Date(cp.next).toISOString()}`);
      let cursor = cp.next;
      for (const b of batch) {
        validateBar(b, ms);
        if (b.openTime !== cursor || b.closeTime > s.to) throw Error(`Gap/duplicate/out-of-range at ${cursor}`);
        cursor += ms;
      }
      const text = batch.map(b => JSON.stringify(b) + "\n").join("");
      await handle.writeFile(text); await handle.sync();
      cp = { bars: cp.bars + batch.length, bytes: cp.bytes + Buffer.byteLength(text), next: cursor };
      await atomicJSON(cpFile, cp);
      await atomicJSON(progressFile, { snapshot: id, at: new Date().toISOString(), interval: rec.interval, file: s.file, bars: cp.bars, expected: s.expected, requests, retries });
      console.log(`${rec.interval} ${s.file}: ${cp.bars}/${s.expected} (${(cp.bars / s.expected * 100).toFixed(1)}%)`);
    }
  } finally { await handle.close(); }
  await rename(partial, file);
  Object.assign(s, await verifySegment(root, s, ms), { status: "complete" });
  await atomicJSON(path.join(root, "manifest.json"), m);
}
async function main() {
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, "download.lock");
  try {
    const old = Number(await readFile(lockPath, "utf8"));
    try { process.kill(old, 0); throw Error(`Snapshot already being downloaded by PID ${old}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; await unlink(lockPath); }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const lock = await open(lockPath, "wx"); await lock.writeFile(String(process.pid)); await lock.close();
  try {
    let m: Manifest;
    try { m = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const asOf = Math.floor(Date.now() / 60000) * 60000;
      m = { schemaVersion: 1, symbol: "BTCUSDT", market: "spot", source: "api/klines/route.ts → Binance Spot /api/v3/klines", snapshot: id, asOf, createdAt: new Date().toISOString(), status: "downloading", records: [] };
      for (const [interval, ms] of Object.entries(PERIODS)) {
        const years = interval.endsWith("m") ? 1 : 2, date = new Date(asOf);
        date.setUTCFullYear(date.getUTCFullYear() - years);
        const from = Math.ceil(+date / ms) * ms, to = Math.floor(asOf / ms) * ms - 1;
        m.records.push({ interval: interval as keyof typeof PERIODS, years,
          data: { file: `BTCUSDT-${interval}.jsonl`, from, to, expected: (to + 1 - from) / ms, status: "pending" },
          warmup: { file: `warmup/BTCUSDT-${interval}.jsonl`, from: from - 1000 * ms, to: from - 1, expected: 1000, status: "pending" } });
      }
      await atomicJSON(path.join(root, "manifest.json"), m);
    }
    validateManifest(m, id);
    try {
      const cooldown = JSON.parse(await readFile(path.join(root, "cooldown.json"), "utf8"));
      while (cooldown.until > Date.now() && !stopping) await pause(Math.min(1000, cooldown.until - Date.now()));
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    // Smaller series first: the UI can use completed datasets while 1m is downloading.
    for (const rec of [...m.records].reverse()) { await segment(m, rec, rec.warmup); await segment(m, rec, rec.data); }
    m.status = "complete"; await atomicJSON(path.join(root, "manifest.json"), m);
    await atomicJSON(progressFile, { snapshot: id, status: "complete", at: new Date().toISOString(), requests, retries });
    console.log(`COMPLETE ${root}`);
  } finally { await unlink(lockPath); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
