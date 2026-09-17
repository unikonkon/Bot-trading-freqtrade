import { readdir } from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT, PERIODS, readManifest, snapshotPath, readBars, verifySegment } from "../../scripts/history-storage";
import type { RequestConfig } from "./data";
import type { KlineData } from "../../lib/types/kline";

export async function listDatasets() {
  const ids = await readdir(DATA_ROOT).catch(e => { if (e.code === "ENOENT") return []; throw e; });
  const snapshots = [];
  for (const id of ids.sort().reverse()) {
    try {
      const m = await readManifest(id);
      snapshots.push({ snapshot: id, asOf: m.asOf, status: m.status, symbol: m.symbol,
        records: m.records.map(r => ({ interval: r.interval, from: r.data.from, to: r.data.to, bars: r.data.expected,
          ready: r.data.status === "complete" && r.warmup.status === "complete" })) });
    } catch { /* Skip incomplete metadata during initial creation, never expose arbitrary paths. */ }
  }
  return snapshots;
}
export async function loadLocalData(cfg: RequestConfig, warmCount: number) {
  const m = await readManifest(cfg.snapshot!);
  if (cfg.symbol !== m.symbol) throw Error("คู่เหรียญไม่ตรงกับชุดข้อมูล");
  const rec = m.records.find(r => r.interval === cfg.interval);
  if (!rec || rec.data.status !== "complete" || rec.warmup.status !== "complete") throw Error("ชุดข้อมูลนี้ยังดาวน์โหลดไม่ครบ");
  const ms = PERIODS[rec.interval], root = snapshotPath(m.snapshot);
  for (const [segment, expectedName] of [[rec.data, `BTCUSDT-${rec.interval}.jsonl`], [rec.warmup, `warmup/BTCUSDT-${rec.interval}.jsonl`]] as const) {
    if (segment.file !== expectedName) throw Error("Invalid dataset filename");
    await verifySegment(root, segment, ms);
  }
  const from = cfg.from ?? rec.data.from, to = cfg.to ?? rec.data.to;
  if (from < rec.data.from || to > rec.data.to || from >= to) throw Error("ช่วงวันที่อยู่นอกข้อมูลที่บันทึกไว้");
  const alignedFrom = Math.ceil(from / ms) * ms;
  const k: KlineData[] = [];
  let start = 0;
  for (const segment of [rec.warmup, rec.data]) {
    for await (const b of readBars(path.join(root, segment.file))) {
      if (b.openTime < alignedFrom - warmCount * ms) continue;
      if (b.closeTime > to) break;
      k.push(b);
      if (b.openTime < alignedFrom) start++;
    }
  }
  if (k.length - start < 2) throw Error("ไม่พบแท่งที่ปิดแล้วเพียงพอในช่วงที่เลือก");
  const warnings = ["อ่านจากไฟล์ในเครื่อง ตรวจ checksum และความต่อเนื่องแล้ว; ไม่เรียก Binance ระหว่างทดสอบ",
    "คำนวณต่อเนื่องจาก warmup ที่เลือก; OBV/VWAP อิงจุดเริ่มข้อมูลนี้ และ VWAP ในไลบรารีไม่รีเซ็ตรายวัน"];
  if (start < warmCount) warnings.push(`แท่งเตรียม indicator ไม่ครบ ${start}/${warmCount}`);
  return { klines: k, start, warnings };
}
