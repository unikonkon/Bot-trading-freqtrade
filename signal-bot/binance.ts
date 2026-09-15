/**
 * ดึงแท่งเทียนจาก Binance โดยตรง (public endpoint ไม่ต้องใช้ key)
 * คืนเฉพาะแท่งที่ "ปิดแล้ว" — ย้ายมาจาก NextJS_UseBot_Crypto/lib/scanner.ts และเพิ่ม timeout + retry
 */
import { parseKline, type BinanceKlineRaw, type KlineData } from "@/lib/types/kline";

const BINANCE_BASE = process.env.BINANCE_BASE || "https://api.binance.com";

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchClosedKlines(
  symbol: string,
  interval: string,
  limit: number,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<KlineData[]> {
  const lim = Math.min(Math.max(Math.floor(limit) || 200, 50), 1000);
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval,
    limit: String(Math.min(lim + 1, 1000)), // เผื่อ 1 แท่งสำหรับตัดแท่งที่ยังไม่ปิด
  });
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
