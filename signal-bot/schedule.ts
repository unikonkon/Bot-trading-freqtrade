/**
 * คำนวณเวลาปิดแท่งถัดไปของแต่ละ interval เพื่อให้บอทตื่นมาสแกน "หลังแท่งปิด" พอดี
 * แทนการ polling ทุก N นาที (ลดจำนวนครั้งที่ยิง Binance และไม่พลาดแท่ง)
 */
const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

// ค่า ms ของ interval ที่ความยาวคงที่ (1M ไม่คงที่ → null)
export function intervalMs(interval: string): number | null {
  const m = /^(\d+)([smhdw])$/.exec(interval);
  if (!m) return null;
  return Number(m[1]) * UNIT_MS[m[2]];
}

// แท่งรายสัปดาห์ของ Binance เปิดวันจันทร์ 00:00 UTC; epoch (1 ม.ค. 1970) เป็นวันพฤหัส → offset 4 วัน
const WEEK_OFFSET_MS = 4 * 86_400_000;

/** เวลาปิด (ms, exclusive boundary) ของแท่งถัดไปหลังเวลา now; null ถ้าจัดตารางไม่ได้ (1M) */
export function nextCloseTime(interval: string, now = Date.now()): number | null {
  const ms = intervalMs(interval);
  if (!ms) return null;
  const offset = interval.endsWith("w") ? WEEK_OFFSET_MS : 0;
  return Math.floor((now - offset) / ms) * ms + ms + offset;
}

/** closeTime แบบ Binance (boundary − 1 ms) ของแท่งล่าสุดที่ปิดไปแล้ว ณ เวลา now */
export function lastClosedCloseTime(interval: string, now = Date.now()): number | null {
  const next = nextCloseTime(interval, now);
  if (next === null) return null;
  const ms = intervalMs(interval)!;
  return next - ms - 1;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
