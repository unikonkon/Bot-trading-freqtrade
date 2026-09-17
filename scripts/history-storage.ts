import { createReadStream } from "node:fs";
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KlineData } from "../lib/types/kline";

export const DATA_ROOT = fileURLToPath(new URL("../data-test/BTCUSDT/", import.meta.url));
export const PERIODS = { "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "2h": 7200000, "4h": 14400000, "1d": 86400000 } as const;
export type HistoryInterval = keyof typeof PERIODS;
export interface Segment {
  file: string; from: number; to: number; expected: number;
  status: "pending" | "complete"; bars?: number; sha256?: string; bytes?: number;
}
export interface HistoryRecord { interval: HistoryInterval; years: number; data: Segment; warmup: Segment }
export interface Manifest {
  schemaVersion: 1; symbol: "BTCUSDT"; market: "spot"; source: string;
  snapshot: string; asOf: number; createdAt: string; status: "downloading" | "complete";
  records: HistoryRecord[];
}
export async function atomicJSON(file: string, value: unknown) {
  const temporary = file + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await rename(temporary, file);
}
export function validateBar(value: unknown, ms: number): asserts value is KlineData {
  if (!value || typeof value !== "object") throw Error("Invalid candle object");
  const b = value as KlineData;
  if (!Number.isSafeInteger(b.openTime) || b.openTime < 0 || b.openTime % ms !== 0 || b.closeTime !== b.openTime + ms - 1)
    throw Error(`Invalid candle time ${b.openTime}`);
  for (const key of ["open", "high", "low", "close", "volume", "quoteAssetVolume", "takerBuyBaseVolume", "takerBuyQuoteVolume"] as const)
    if (typeof b[key] !== "string" || b[key].trim() === "" || !Number.isFinite(+b[key]) || +b[key] < 0) throw Error(`Invalid ${key} at ${b.openTime}`);
  if (Math.min(+b.open, +b.high, +b.low, +b.close) <= 0 || +b.low > Math.min(+b.open, +b.close) || +b.high < Math.max(+b.open, +b.close) || +b.low > +b.high)
    throw Error(`Invalid OHLC at ${b.openTime}`);
  if (!Number.isSafeInteger(b.numberOfTrades) || b.numberOfTrades < 0) throw Error("Invalid trade count");
}
export async function* readBars(file: string) {
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try { for await (const line of lines) { if (!line.trim()) throw Error(`Empty row in ${file}`); yield JSON.parse(line) as KlineData; } }
  finally { lines.close(); input.destroy(); }
}
export async function verifySegment(root: string, segment: Segment, ms: number) {
  const file = path.join(root, segment.file);
  let cursor = segment.from, bars = 0;
  for await (const bar of readBars(file)) {
    validateBar(bar, ms);
    if (bar.openTime !== cursor || bar.closeTime > segment.to) throw Error(`Gap, duplicate or out-of-range candle in ${segment.file} at ${cursor}`);
    cursor += ms; bars++;
  }
  if (bars !== segment.expected || cursor !== segment.to + 1) throw Error(`Incomplete ${segment.file}: ${bars}/${segment.expected}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  if (segment.sha256 && sha256 !== segment.sha256) throw Error(`Checksum mismatch: ${segment.file}`);
  return { bars, sha256, bytes: (await stat(file)).size };
}
export function snapshotPath(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Error("Invalid snapshot ID");
  return path.join(DATA_ROOT, id);
}
export async function readManifest(id: string): Promise<Manifest> {
  const m = JSON.parse(await readFile(path.join(snapshotPath(id), "manifest.json"), "utf8")) as Manifest;
  validateManifest(m, id);
  return m;
}

export function validateManifest(m: Manifest, id: string) {
  if (m.schemaVersion !== 1 || m.snapshot !== id || m.symbol !== "BTCUSDT" || m.market !== "spot" ||
      !Number.isSafeInteger(m.asOf) || !Array.isArray(m.records) || !m.records.length ||
      new Set(m.records.map(r => r.interval)).size !== m.records.length) throw Error("Invalid manifest");
  for (const r of m.records) {
    if (!Object.hasOwn(PERIODS, r.interval)) throw Error("Unknown history interval");
    const ms = PERIODS[r.interval];
    if (r.data.file !== `BTCUSDT-${r.interval}.jsonl` || r.warmup.file !== `warmup/BTCUSDT-${r.interval}.jsonl` ||
        r.warmup.to + 1 !== r.data.from || r.data.to >= m.asOf) throw Error("Invalid manifest path or boundary");
    for (const segment of [r.data, r.warmup]) {
      if (!Number.isSafeInteger(segment.from) || segment.from < 0 || segment.from % ms ||
          !Number.isSafeInteger(segment.to) || (segment.to + 1) % ms || segment.to < segment.from ||
          segment.expected !== (segment.to + 1 - segment.from) / ms ||
          !["pending", "complete"].includes(segment.status)) throw Error("Invalid manifest segment");
      if (segment.status === "complete" && (!/^[a-f0-9]{64}$/.test(segment.sha256 ?? "") || segment.bars !== segment.expected)) throw Error("Missing completed checksum/count");
    }
  }
}
