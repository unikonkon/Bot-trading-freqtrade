/**
 * ดึงแท่งเทียนจาก Binance โดยตรง (public endpoint ไม่ต้องใช้ key)
 * คืนเฉพาะแท่งที่ "ปิดแล้ว" — ย้ายมาจาก NextJS_UseBot_Crypto/lib/scanner.ts และเพิ่ม timeout + retry
 */
import { parseKline, type BinanceKlineRaw, type KlineData } from "@/lib/types/kline";

const BINANCE_BASE = process.env.BINANCE_BASE || "https://api.binance.com";

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** เพดานการไล่หน้า = 50 คำขอ เพราะ Binance ให้ 1,000 แท่งต่อคำขอ */
export const MAX_KLINES = 50_000;

/**
 * ดึงแท่งที่ปิดแล้วให้ครบตามจำนวนที่ขอ โดยไล่ย้อนทีละหน้าเมื่อเกิน 1,000 แท่ง
 *
 * ก่อนแก้จุดนี้ฟังก์ชันยิงคำขอเดียวและถูกตัดที่ 1,000 แท่งเสมอ ขณะที่กลยุทธ์ v3
 * ต้องการ 6,002 แท่งที่ 30m (125 วัน) ผลคือชั้นทิศทางสะสมไม่ครบสักครั้ง
 * และบอท **ไม่เคยส่งสัญญาณ v3 ออกมาเลย** ทุก timeframe ที่สั้นกว่า 4h
 */
export async function fetchClosedKlines(
  symbol: string,
  interval: string,
  limit: number,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<KlineData[]> {
  const want = Math.min(Math.max(Math.floor(limit) || 200, 50), MAX_KLINES);
  const out: KlineData[] = [];
  let endTime: number | null = null;
  while (out.length < want) {
    const page = await fetchKlinePage(symbol, interval, Math.min(want - out.length + 1, 1000), endTime, opts);
    if (!page.length) break;
    const nextEnd = page[0].openTime - 1;
    if (endTime !== null && nextEnd >= endTime) break; // ไม่ถอยหลัง — กันวนไม่รู้จบ
    out.unshift(...page);
    endTime = nextEnd;
    if (page.length < 2) break;
  }
  return out.length > want ? out.slice(-want) : out;
}

async function fetchKlinePage(
  symbol: string,
  interval: string,
  lim: number,
  endTime: number | null,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<KlineData[]> {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval,
    limit: String(Math.min(Math.max(lim, 2), 1000)),
  });
  if (endTime !== null) params.set("endTime", String(endTime));
  const url = `${BINANCE_BASE}/api/v3/klines?${params.toString()}`;
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) {
        const detail = await res.text();
        // 4xx (ยกเว้น 429/418) ไม่ต้อง retry
        if (res.status < 500 && res.status !== 429 && res.status !== 418) {
          throw new Error(`Binance ${symbol} ${interval}: ${res.status} ${detail.slice(0, 200)}`);
        }
        throw new Error(`Binance ${symbol} ${interval}: ${res.status} ${detail.slice(0, 200)} (retryable)`);
      }
      const raw = (await res.json()) as BinanceKlineRaw[];
      const parsed = raw.map(parseKline);
      const now = Date.now();
      // ตัดแท่งสุดท้ายถ้ายังไม่ปิด (closeTime > now)
      while (parsed.length && parsed[parsed.length - 1].closeTime > now) parsed.pop();
      return parsed;
    } catch (err) {
      lastErr = err;
      const msg = String(err);
      if (!msg.includes("retryable") && !msg.includes("abort") && !msg.includes("fetch failed")) throw err;
      if (attempt < retries) await sleep(1500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
