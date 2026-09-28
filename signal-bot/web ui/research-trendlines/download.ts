/**
 * ดึงแท่งเทียน Binance Spot ของหลายเหรียญเก็บเป็น snapshot สำหรับ walk-forward ของ Trendlines with Breaks
 *
 *   npm run web:tl:download                 # snapshot ใหม่ชื่อ tl-YYYYMMDD (วันที่ UTC)
 *   npm run web:tl:download -- tl-20260928  # snapshot เดิม = โหลดต่อเฉพาะไฟล์ที่ยังไม่มี
 *   npm run web:tl:download -- tl-20260928-holdout --symbols holdout --asof-from tl-20260928
 *     ชุดเหรียญที่ไม่เคยใช้เลือกค่า (HOLDOUT_SYMBOLS) ตัดเวลาเดียวกับ snapshot หลัก
 *   npm run web:tl:download -- tl-20260928-holdout2 --symbols holdout2 --asof-from tl-20260928
 *
 * snapshot ตรึงเวลา `asOf` ไว้ใน manifest.json ทุกไฟล์ในชุดจึงจบที่แท่งปิดแท่งเดียวกัน
 * และรัน walk-forward ซ้ำได้ผลเท่าเดิมโดยไม่เรียก Binance อีก
 * ไฟล์ที่เขียนเสร็จแล้วตรวจ SHA-256 ทุกครั้งที่อ่าน (ดู `loadSnapshot` ใน walk-forward.ts)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseKline, type BinanceKlineRaw, type KlineData } from "../../../lib/types/kline";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const DATA_DIR = path.join(ROOT, "data-test", "trendlines");

/** เหรียญ USDT สภาพคล่องสูงที่มีประวัติยาว — เลือกจากสภาพปัจจุบัน จึงมี survivorship bias */
export const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT",
  "LINKUSDT", "AVAXUSDT", "DOTUSDT", "LTCUSDT", "BCHUSDT", "XLMUSDT", "ATOMUSDT",
];
/**
 * ชุดตรวจขั้นสุดท้าย: เหรียญที่ไม่อยู่ใน SYMBOLS และไม่เคยใช้เลือกค่า (เหรียญที่ลิสต์บน Spot ถึงวันที่โหลด)
 * เหรียญที่ดึงไม่ได้ (เช่นถูกถอด) ข้ามไปพร้อมคำเตือน
 */
export const HOLDOUT_SYMBOLS = [
  "ETCUSDT", "NEOUSDT", "VETUSDT", "ALGOUSDT", "NEARUSDT", "UNIUSDT", "FILUSDT", "AAVEUSDT",
  "SANDUSDT", "MANAUSDT", "HBARUSDT", "THETAUSDT", "XTZUSDT", "INJUSDT", "ZECUSDT",
];
/** ชุดตรวจ 2: ใช้ยืนยันค่าที่ลงทะเบียนไว้ใน enhance-wf.ts (PRESET) ครั้งเดียว — ห้ามใช้เลือกค่า */
export const HOLDOUT2_SYMBOLS = [
  "IOTAUSDT", "ONTUSDT", "QTUMUSDT", "ZILUSDT", "BATUSDT", "ENJUSDT", "CHZUSDT", "COMPUSDT",
  "SNXUSDT", "CRVUSDT", "KAVAUSDT", "RUNEUSDT", "EGLDUSDT", "ICXUSDT", "ZRXUSDT",
];
/** จุดเริ่มข้อมูลต่อ timeframe (เหรียญที่ลิสต์ทีหลังเริ่มที่แท่งแรกของมันเอง) */
export const RANGES: Record<string, { from: number; ms: number }> = {
  "15m": { from: Date.UTC(2026, 2, 1), ms: 15 * 60_000 },
  "1h": { from: Date.UTC(2023, 8, 1), ms: 3_600_000 },
  "4h": { from: Date.UTC(2019, 0, 1), ms: 4 * 3_600_000 },
  "1d": { from: 0, ms: 86_400_000 },
};

export interface Manifest {
  snapshot: string;
  asOf: number;
  files: Record<string, { symbol: string; interval: string; from: number; to: number; bars: number; sha256: string }>;
}

const BASE = process.env.BINANCE_URL ?? "https://data-api.binance.vision/api/v3/klines";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

async function page(symbol: string, interval: string, startTime: number, endTime: number): Promise<KlineData[]> {
  const url = `${BASE}?${new URLSearchParams({ symbol, interval, limit: "1000", startTime: String(startTime), endTime: String(endTime) })}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch((e) => {
      console.log(`  ลองใหม่ ${attempt + 1}: ${e}`); return null;
    });
    if (res?.ok) return ((await res.json()) as BinanceKlineRaw[]).map(parseKline);
    if (res && ![429, 418].includes(res.status) && res.status < 500)
      throw Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const retry = Number(res?.headers.get("retry-after"));
    await pause(Number.isFinite(retry) && retry > 0 ? (retry + 1) * 1000 : Math.min(60_000, 2000 * 2 ** attempt));
  }
  throw Error(`ดึง ${symbol} ${interval} ที่ ${startTime} ไม่สำเร็จ`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const snapshot = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"))
    ?? `tl-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const symbolsArg = flag("symbols");
  const symbols = symbolsArg === "holdout" ? HOLDOUT_SYMBOLS : symbolsArg === "holdout2" ? HOLDOUT2_SYMBOLS : symbolsArg ? symbolsArg.split(",") : SYMBOLS;
  const asOfFrom = flag("asof-from");
  const dir = path.join(DATA_DIR, snapshot);
  mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, "manifest.json");
  const manifest: Manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : {
      snapshot, files: {},
      // ใช้เวลาตัดของ snapshot อื่น เพื่อให้ทุกชุดจบที่แท่งเดียวกัน
      asOf: asOfFrom ? (JSON.parse(readFileSync(path.join(DATA_DIR, asOfFrom, "manifest.json"), "utf8")) as Manifest).asOf : Date.now(),
    };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  for (const [interval, { from, ms }] of Object.entries(RANGES)) {
    // แท่งสุดท้าย = แท่งที่ปิดครบก่อน asOf
    const to = Math.floor(manifest.asOf / ms) * ms - 1;
    for (const symbol of symbols) {
      const name = `${symbol}-${interval}.jsonl`;
      if (manifest.files[name]) continue;
      const bars: KlineData[] = [];
      let cursor = from;
      try {
        while (cursor <= to) {
          const rows = await page(symbol, interval, cursor, to);
          if (!rows.length) break;
          bars.push(...rows);
          cursor = rows[rows.length - 1].openTime + ms;
          await pause(300);
        }
      } catch (e) {
        console.log(`  ⚠ ข้าม ${name}: ${String(e).slice(0, 200)}`);
        continue;
      }
      const done = bars.filter((b) => b.closeTime <= to);
      if (!done.length) { console.log(`  ⚠ ข้าม ${name}: ไม่มีข้อมูล`); continue; }
      for (let i = 1; i < done.length; i++)
        if (done[i].openTime - done[i - 1].openTime !== ms)
          console.log(`  ⚠ ${name}: ช่องว่างที่ ${new Date(done[i - 1].openTime).toISOString()} → ${new Date(done[i].openTime).toISOString()}`);
      const text = done.map((b) => JSON.stringify(b)).join("\n") + "\n";
      writeFileSync(path.join(dir, name), text);
      manifest.files[name] = { symbol, interval, from: done[0].openTime, to: done[done.length - 1].closeTime, bars: done.length, sha256: sha256(text) };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`${name.padEnd(22)} ${String(done.length).padStart(6)} แท่ง · ${new Date(done[0].openTime).toISOString().slice(0, 10)} → ${new Date(done[done.length - 1].openTime).toISOString().slice(0, 10)}`);
    }
  }
  console.log(`\nเสร็จ: ${dir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
