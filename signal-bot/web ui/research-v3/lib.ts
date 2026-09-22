/** ตัวช่วยร่วมของงานวิจัย v3: โหลดข้อมูล แบ่ง train/test และสรุปผล */
import fs from "node:fs";
import path from "node:path";
import type { KlineData } from "../../../lib/types/kline";
import { simulateExposure, type Simulation } from "../engine";

export const ROOT = "data-test/BTCUSDT/btcusdt-20260917";
export const TFS = ["1m", "3m", "5m", "15m", "30m"] as const;
export type Tf = (typeof TFS)[number];

/** warmup + ข้อมูลหลัก ต่อกันเป็นชุดเดียว ผลเริ่มนับที่ดัชนี 1000 */
export function load(tf: string): KlineData[] {
  const read = (f: string) =>
    fs.readFileSync(path.join(ROOT, f), "utf8").trim().split("\n").map(l => JSON.parse(l) as KlineData);
  return [...read(`warmup/BTCUSDT-${tf}.jsonl`), ...read(`BTCUSDT-${tf}.jsonl`)];
}

/** แบ่งครึ่งตามเวลา: train = 8 เดือนแรก, test = 4 เดือนท้าย (ไม่ซ้อนกัน) */
export const SPLIT_AT = Date.UTC(2026, 4, 17); // 17 พ.ค. 2026
export function split(k: KlineData[], warm = 1000) {
  const cut = k.findIndex(b => b.openTime >= SPLIT_AT);
  if (cut <= warm) throw new Error("split point outside data");
  // test ได้ warmup ของตัวเองจากแท่งก่อนหน้า จึงไม่มีการรั่วของ indicator
  return { train: { k: k.slice(0, cut), start: warm }, test: { k, start: cut } };
}

export const f2 = (x: number, d = 2) => x.toFixed(d);
export function show(s: Simulation, bars: number) {
  return `${s.totalTrades} (${f2((s.totalTrades / bars) * 1000, 1)}/k) / ${f2(s.returnPct)}% / win ${f2(s.winRate, 0)}% / pf ${s.profitFactor == null ? "inf" : f2(s.profitFactor)} / dd ${f2(s.maxDrawdownPct)}%`;
}
export function run(k: KlineData[], exposure: number[], start: number, fee: number, slip: number, funding: number) {
  return simulateExposure(k, exposure, start, fee, slip, funding, "next_open");
}
/** สถิติของชุดตัวเลข: ค่าเฉลี่ย ส่วนเบี่ยงเบน และ t ของสมมติฐานว่าเฉลี่ย = 0 */
export function tstat(xs: number[]) {
  const n = xs.length;
  if (n < 2) return { n, mean: 0, sd: 0, t: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return { n, mean, sd, t: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0 };
}
