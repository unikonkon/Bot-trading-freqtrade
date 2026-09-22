/**
 * ดึงแท่งเทียนของเหรียญที่ใช้ "ตรวจข้ามเหรียญ" จาก Binance public API
 *
 * ชุดนี้แยกจาก `download-history.ts` โดยตั้งใจ — ตัวนั้นเป็นท่อหลักของ BTCUSDT
 * ที่มี manifest / checksum / resume ครบ ส่วนตัวนี้เป็นข้อมูลสำหรับงานวิจัยอย่างเดียว
 * จึงเน้นสั้นและตรวจสอบได้: ดึง → ตรวจความต่อเนื่อง → เขียนทีเดียวเมื่อผ่านครบ
 *
 * ช่วงเวลาถูกตั้งให้ตรงกับชุด BTCUSDT (`data-test/BTCUSDT/btcusdt-20260917`) เพื่อให้
 * เทียบกันได้ตรง ๆ และเพื่อให้จุดแบ่ง train/test ที่ 17 พ.ค. 2026 อยู่ตำแหน่งเดียวกัน
 *
 *   npx tsx scripts/download-crosscoin.ts [โฟลเดอร์ปลายทาง]
 *
 * ผลลัพธ์: <ปลายทาง>/<SYMBOL>-<interval>.jsonl ซึ่งเป็นรูปแบบที่ `ofi-crosscoin.ts`
 * และ `ofi-portfolio.ts` อ่านได้โดยตรง
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseKline, type BinanceKlineRaw, type KlineData } from "../lib/types/kline";

const OUT = process.argv[2] ?? "data-test/crosscoin";
const SYMBOLS = ["ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
/**
 * ปลายทางตรงกับไฟล์ BTCUSDT ส่วนต้นทางย้อนไปไกลกว่านั้นราว 4 เดือนครึ่ง โดยตั้งใจ
 *
 * สัญญาณ OrderFlow ต้องสะสมข้อมูล flowLookbackDays + flowDebiasDays = 125 วันก่อนให้ค่าแรก
 * ถ้าไฟล์เริ่มพร้อมกับ BTCUSDT ช่วงประเมินผลของเหรียญอื่นจะสั้นกว่า BTCUSDT อยู่ 125 วัน
 * แล้วการเทียบผลจะไม่ยุติธรรม เริ่มที่ 1 พ.ค. 2025 จึงทำให้ทุกเหรียญเริ่มประเมินผลได้
 * ที่วันเดียวกับ BTCUSDT คือ 17 ก.ย. 2025
 */
const START = Date.UTC(2025, 4, 1);
const RANGES: Record<string, { from: number; to: number; ms: number }> = {
  "15m": { from: START, to: 1789640100000, ms: 15 * 60000 },
  "30m": { from: START, to: 1789639200000, ms: 30 * 60000 },
};
const BASE = process.env.BINANCE_URL ?? "https://data-api.binance.vision/api/v3/klines";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function page(symbol: string, interval: string, startTime: number, endTime: number): Promise<KlineData[]> {
  const url = `${BASE}?${new URLSearchParams({ symbol, interval, limit: "1000", startTime: String(startTime), endTime: String(endTime) })}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) }).catch((e) => {
      console.log(`  ลองใหม่ ${attempt + 1}: ${e}`); return null;
    });
    if (res?.ok) {
      const raw: unknown = await res.json();
      if (!Array.isArray(raw)) throw Error("รูปแบบผลลัพธ์ไม่ใช่รายการ");
      return raw.map((row) => parseKline(row as BinanceKlineRaw));
    }
    if (res && ![429, 418].includes(res.status) && res.status < 500)
      throw Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    await pause(Math.min(60000, 2000 * 2 ** attempt));
  }
  throw Error(`ดึง ${symbol} ${interval} ที่ ${startTime} ไม่สำเร็จ`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const symbol of SYMBOLS) {
    for (const [interval, { from, to, ms }] of Object.entries(RANGES)) {
      const bars: KlineData[] = [];
      let cursor = from;
      while (cursor <= to) {
        const batch = await page(symbol, interval, cursor, to);
        if (!batch.length) break;
        for (const b of batch) if (b.openTime >= cursor) bars.push(b);
        cursor = batch[batch.length - 1].openTime + ms;
        await pause(120);
      }
      // ตรวจความต่อเนื่อง: ห้ามมีแท่งซ้ำ ห้ามมีช่องว่าง มิฉะนั้นหน้าต่างย้อนหลังจะเพี้ยน
      const expected = Math.round((to - from) / ms) + 1;
      for (let i = 1; i < bars.length; i++) {
        const gap = bars[i].openTime - bars[i - 1].openTime;
        if (gap !== ms) throw Error(`${symbol} ${interval}: ช่องว่าง ${gap / ms} แท่งที่ดัชนี ${i} (${new Date(bars[i - 1].openTime).toISOString()})`);
      }
      if (bars.length !== expected)
        throw Error(`${symbol} ${interval}: ได้ ${bars.length} แท่ง แต่ควรได้ ${expected}`);
      const file = path.join(OUT, `${symbol}-${interval}.jsonl`);
      await writeFile(file, bars.map((b) => JSON.stringify(b)).join("\n") + "\n");
      console.log(`${file} — ${bars.length} แท่ง · ${new Date(bars[0].openTime).toISOString()} ถึง ${new Date(bars.at(-1)!.openTime).toISOString()}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
