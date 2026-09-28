/**
 * ส่วนที่ walk-forward ทุกตัวในโฟลเดอร์นี้ใช้ร่วมกัน
 * อ่าน CLI · เปิด snapshot พร้อมตรวจ SHA-256 · แบ่งช่วง train/test · cache ผลตาม key
 *
 * CLI ของทุกตัว: [snapshot] [--tf 4h,1d] [--fee 0.1] [--slip 0.05] [--force]
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KlineData } from "../../../lib/types/kline";
import { DATA_DIR, RANGES, sha256, type Manifest } from "./download";
import type { Chain, Costs } from "./sim";

export const HERE = fileURLToPath(new URL(".", import.meta.url));
const DAY = 86_400_000;
/** ความยาวช่วง train / test (วัน) ต่อ timeframe */
export const WF: Record<string, { train: number; test: number }> = {
  "15m": { train: 60, test: 30 },
  "1h": { train: 270, test: 90 },
  "4h": { train: 540, test: 180 },
  "1d": { train: 1095, test: 365 },
};
export const WARM = 200;       // แท่งอุ่นเครื่องก่อน train ช่วงแรกของแต่ละเหรียญ
export const MIN_COINS = 3;    // ช่วงที่มีเหรียญพร้อมน้อยกว่านี้ไม่นับ

export interface Cli { snapshot: string; tfs: string[]; cost: Costs; force: boolean; suffix: string }
export function parseCli(argv = process.argv.slice(2)): Cli {
  const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const snapshot = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"))
    // ค่าตั้งต้น = snapshot หลักล่าสุด (ชุดตรวจ *-holdout / *-holdout2 ต้องระบุชื่อเอง)
    ?? (existsSync(DATA_DIR) ? readdirSync(DATA_DIR) : [])
      .filter((d) => !/-holdout\d*$/.test(d) && existsSync(path.join(DATA_DIR, d, "manifest.json"))).sort().at(-1);
  if (!snapshot) throw Error("ไม่พบ snapshot — รัน npm run web:tl:download ก่อน");
  const tfs = (flag("tf") ?? Object.keys(WF).join(",")).split(",");
  for (const tf of tfs) if (!WF[tf]) throw Error(`ไม่รองรับ timeframe ${tf}`);
  const cost: Costs = { feePct: +(flag("fee") ?? 0.1), slipPct: +(flag("slip") ?? 0.05) };
  // ต้นทุนไม่ใช่ค่าตั้งต้น → แยกไฟล์ผล เพื่อไม่ทับ cache ของชุดหลัก
  const suffix = cost.feePct === 0.1 && cost.slipPct === 0.05 ? "" : `-fee${cost.feePct}-slip${cost.slipPct}`;
  return { snapshot, tfs, cost, force: argv.includes("--force"), suffix };
}

export interface Fold { trainStart: number; testStart: number; testEnd: number; coins: string[] }
/** ผล OOS ของหนึ่งเหรียญเมื่อต่อช่วง test ทุกช่วงเข้าด้วยกัน */
export interface ChainOut { comp: number; mdd: number; trades: number; folds: number }

export function openSnapshot(snapshot: string) {
  const dir = path.join(DATA_DIR, snapshot);
  const manifest: Manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const names = (tf: string) => {
    const list = Object.keys(manifest.files).filter((n) => manifest.files[n].interval === tf).sort();
    if (!list.length) throw Error(`snapshot ${snapshot} ไม่มี ${tf}`);
    return list;
  };
  const load = (name: string): KlineData[] => {
    const text = readFileSync(path.join(dir, name), "utf8");
    assert.equal(sha256(text), manifest.files[name].sha256, `checksum ไม่ตรง: ${name}`);
    return text.trim().split("\n").map((line) => JSON.parse(line));
  };
  /** ช่วงเวลา: เริ่มเมื่อเหรียญแรกอุ่นเครื่องครบ · ช่วง test สุดท้ายต้องยาวอย่างน้อยครึ่งหนึ่ง */
  const folds = (tf: string): Fold[] => {
    const { train, test } = WF[tf], ms = RANGES[tf].ms, list = names(tf);
    const starts = Object.fromEntries(list.map((n) => [manifest.files[n].symbol, manifest.files[n].from + WARM * ms]));
    const end = Math.max(...list.map((n) => manifest.files[n].to)) + 1;
    const t0 = Math.min(...Object.values(starts));
    const out: Fold[] = [];
    for (let ts = t0 + train * DAY; end - ts >= (test * DAY) / 2; ts += test * DAY) {
      const coins = Object.keys(starts).filter((s) => starts[s] <= ts - train * DAY).sort();
      if (coins.length >= MIN_COINS) out.push({ trainStart: ts - train * DAY, testStart: ts, testEnd: Math.min(end, ts + test * DAY), coins });
    }
    return out;
  };
  /** ช่วง train ล่าสุดที่จบที่ข้อมูลล่าสุด — ใช้เลือกค่าสำหรับใช้งานจริงตอนนี้ */
  const latestTrain = (tf: string) => {
    const end = Math.max(...names(tf).map((n) => manifest.files[n].to)) + 1;
    return { trainStart: end - WF[tf].train * DAY, trainEnd: end };
  };
  return { manifest, names, load, folds, latestTrain };
}

/** อ่านผลจาก cache ถ้า key ตรง · ไม่ตรงหรือ --force → คำนวณใหม่แล้วเขียนทับ */
export function cached<T extends { key: string }>(file: string, key: string, force: boolean, label: string, compute: () => T): T {
  if (!force && existsSync(file)) {
    const hit: T = JSON.parse(readFileSync(file, "utf8"));
    if (hit.key === key) { console.log(`${label}: ใช้ผลจาก cache`); return hit; }
  }
  const res = compute();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(res));
  return res;
}

/** SHA-256 ของไฟล์โค้ดในโฟลเดอร์นี้ ใส่ใน cache key: แก้โค้ดเมื่อไร ผลเก่าถูกคำนวณใหม่ */
export const sourceHash = (...files: string[]) => files.map((f) => sha256(readFileSync(path.join(HERE, f), "utf8")));

export const newChain = (): Chain => ({ eq: 1, peak: 1, mdd: 0 });
export const chainOut = (c: Chain, trades: number, folds: number): ChainOut =>
  ({ comp: r4((c.eq - 1) * 100), mdd: r4(c.mdd * 100), trades, folds });

export const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
export const median = (a: number[]) => {
  if (!a.length) return NaN;
  const b = [...a].sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
export const lowerBound = (t: Float64Array, x: number) => {
  let lo = 0, hi = t.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
};
export const pct = (x: number) => (Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
export const date = (t: number) => new Date(t).toISOString().slice(0, 10);
