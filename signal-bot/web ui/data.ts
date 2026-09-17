import { GET as klinesRoute } from "../../api/klines/route";
import { loadLocalData } from "./local-data";
import {
  parseKline,
  INTERVALS,
  type BinanceKlineRaw,
  type KlineData,
} from "../../lib/types/kline";
import { STRATEGIES, type StrategyId } from "../../lib/backtest";

export interface RequestConfig {
  symbol: string;
  interval: string;
  source: "latest" | "range" | "local";
  snapshot?: string;
  limit: number;
  from?: number;
  to?: number;
  strategy: StrategyId | "all";
  selected: StrategyId;
  params: Record<string, Record<string, number>>;
  fee: number;
  slippage: number;
  mode: "next_open" | "legacy" | "both";
}
function number(
  v: unknown,
  name: string,
  min: number,
  max: number,
  integer = false,
) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  )
    throw new Error(
      `${name} ต้องอยู่ระหว่าง ${min}–${max}${integer ? " และเป็นจำนวนเต็ม" : ""}`,
    );
  return v;
}
export function validate(input: unknown): RequestConfig {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("ข้อมูลคำขอไม่ถูกต้อง");
  const v = input as Record<string, unknown>;
  const symbol = String(v.symbol ?? "").toUpperCase();
  if (!/^[A-Z0-9]{5,24}$/.test(symbol))
    throw new Error("Symbol ไม่ถูกต้อง เช่น BTCUSDT");
  if (!INTERVALS.includes(v.interval as never))
    throw new Error("Timeframe ไม่ถูกต้อง");
  if (!["latest", "range", "local"].includes(String(v.source)))
    throw new Error("รูปแบบข้อมูลไม่ถูกต้อง");
  if (!["next_open", "legacy", "both"].includes(String(v.mode)))
    throw new Error("โหมดจำลองไม่ถูกต้อง");
  const ids = STRATEGIES.map((s) => s.id);
  if (v.strategy !== "all" && !ids.includes(v.strategy as StrategyId))
    throw new Error("ไม่พบกลยุทธ์");
  if (!ids.includes(v.selected as StrategyId))
    throw new Error("ไม่พบกลยุทธ์ที่เลือก");
  if (v.strategy !== "all" && v.strategy !== v.selected)
    throw new Error("กลยุทธ์ที่เลือกไม่ตรงกับคำขอทดสอบ");
  const params: RequestConfig["params"] = {};
  if (
    v.params !== undefined &&
    (!v.params || typeof v.params !== "object" || Array.isArray(v.params))
  )
    throw new Error("พารามิเตอร์ต้องเป็น object");
  for (const id of Object.keys(v.params ?? {}))
    if (!ids.includes(id as StrategyId)) throw new Error(`ไม่พบกลยุทธ์ ${id}`);
  for (const s of STRATEGIES) {
    const custom =
      (v.params as RequestConfig["params"] | undefined)?.[s.id] ?? {};
    if (!custom || typeof custom !== "object" || Array.isArray(custom))
      throw new Error("พารามิเตอร์ไม่ถูกต้อง");
    params[s.id] = { ...s.params };
    for (const [key, value] of Object.entries(custom)) {
      if (!Object.hasOwn(s.params, key)) throw new Error(`ไม่พบพารามิเตอร์ ${key}`);
      const period = /period|length|size|bars|len/i.test(key);
      params[s.id][key] = number(
        value,
        key,
        period ? 2 : key === "volumeThresh" ? 0 : 0.01,
        period
          ? 200
          : key.includes("Threshold")
            ? 100
            : key === "volumeThresh"
              ? 1000
              : 20,
        period,
      );
    }
    const p = params[s.id];
    if (s.id === "rsi" && p.buyThreshold >= p.sellThreshold)
      throw new Error("RSI buyThreshold ต้องน้อยกว่า sellThreshold");
    if (s.id === "cdc_actionzone" && p.fastPeriod >= p.slowPeriod)
      throw new Error("CDC fastPeriod ต้องน้อยกว่า slowPeriod");
    if (s.id === "cm_macd" && p.fastLength >= p.slowLength)
      throw new Error("MACD fastLength ต้องน้อยกว่า slowLength");
    if (s.id === "msb_ob" && p.fibFactor > 1)
      throw new Error("fibFactor ต้องไม่เกิน 1");
    if (s.id === "smc_adaptive" &&
      (p.internalSize >= p.swingSize || p.trendThreshold > 1 || p.rsiThreshold >= 70))
      throw new Error("SMC Adaptive: Internal ต้องน้อยกว่า Swing, trendThreshold ไม่เกิน 1 และ RSI ต่ำกว่า 70");
    if (s.id === "smc_adaptive_v2" && p.fastPeriod >= p.trendPeriod)
      throw new Error("SMC Adaptive V2: EMA เร็วต้องมี period น้อยกว่า EMA เทรนด์");
    if (s.id === "smc_adaptive_short" &&
      (p.fastPeriod >= p.trendPeriod || p.internalSize >= p.swingSize || p.rsiThreshold >= 100))
      throw new Error("SMC Adaptive Short: EMA เร็ว < EMA เทรนด์, Internal < Swing และ RSI < 100");
  }
  const result: RequestConfig = {
    symbol,
    interval: String(v.interval),
    source: v.source as RequestConfig["source"],
    limit: number(v.limit ?? 500, "จำนวนแท่ง", 300, 10000, true),
    strategy: v.strategy as RequestConfig["strategy"],
    selected: v.selected as StrategyId,
    params,
    fee: number(v.fee, "ค่าธรรมเนียม", 0, 5),
    slippage: number(v.slippage, "Slippage", 0, 5),
    mode: v.mode as RequestConfig["mode"],
  };
  if (result.source === "local") {
    if (typeof v.snapshot !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.snapshot)) throw Error("ต้องเลือกชุดข้อมูลในเครื่อง");
    result.snapshot = v.snapshot;
    if ((v.from != null) !== (v.to != null)) throw Error("ต้องระบุวันที่เริ่มและสิ้นสุดคู่กัน");
  }
  if (result.source === "range" || (result.source === "local" && v.from != null)) {
    result.from = number(v.from, "วันที่เริ่ม", Date.UTC(2017, 0), Date.now());
    result.to = number(
      v.to,
      "วันที่สิ้นสุด",
      result.from + 1,
      Date.now() + 86400000,
    );
  }
  return result;
}

export function warmupBars(cfg: RequestConfig) {
  const active = cfg.strategy === "all"
    ? Object.values(cfg.params)
    : [cfg.params[cfg.selected]];
  const periods = active.flatMap((p) =>
    Object.entries(p)
      .filter(([key]) => /period|length|size|bars|len/i.test(key))
      .map(([, v]) => v),
  );
  return Math.min(1000, Math.max(300, Math.max(...periods) * 5));
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function fetchPage(
  params: Record<string, string>,
  handler = klinesRoute,
): Promise<KlineData[]> {
  // Fixed public destination: never accept a URL or a token from the browser.
  const url = new URL("https://api.binance.com/api/v3/klines");
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await handler(new Request(url));
    } catch (e) {
      if (attempt === 2)
        throw new Error(
          `เชื่อมต่อ Binance ไม่สำเร็จ: ${e instanceof Error ? e.message : "network error"}`,
        );
      await pause(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      if (res.status === 418 || res.status === 429)
        throw new Error(
          `Binance จำกัดคำขอ (${res.status}) กรุณารอ ${res.headers.get("retry-after") ?? "สักครู่"} แล้วลองใหม่`,
        );
      if (res.status >= 500 && attempt < 2) {
        await pause(1000 * (attempt + 1));
        continue;
      }
      throw new Error(
        `Binance HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`,
      );
    }
    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) throw new Error("รูปแบบข้อมูล Binance ไม่ถูกต้อง");
    return raw.map((row) => {
      if (
        !Array.isArray(row) ||
        row.length < 11 ||
        !Number.isFinite(row[0]) ||
        !Number.isFinite(row[6]) ||
        row[6] < row[0] ||
        ![1, 2, 3, 4].every((i) => Number.isFinite(+row[i]) && +row[i] > 0) ||
        !Number.isFinite(+row[5]) ||
        +row[5] < 0
      )
        throw new Error("ข้อมูลแท่งเทียนไม่ถูกต้อง");
      return parseKline(row as BinanceKlineRaw);
    });
  }
  throw new Error("โหลดข้อมูลไม่สำเร็จ");
}

export async function loadData(
  cfg: RequestConfig,
  page = fetchPage,
  now = Date.now(),
) {
  const base = { symbol: cfg.symbol, interval: cfg.interval };
  let k: KlineData[] = [];
  let start = 0;
  const warnings: string[] = [];
  if (cfg.strategy === "all" || cfg.selected === "smc_adaptive_short") {
    const fee = cfg.fee / 100, slip = cfg.mode === "legacy" ? 0 : cfg.slippage / 100;
    const roundTrip = 100 * ((1 + fee) * (1 + slip) / ((1 - fee) * (1 - slip)) - 1);
    if (cfg.params.smc_adaptive_short.costPct < roundTrip)
      warnings.push(`SMC Adaptive Short trade: costPct ${cfg.params.smc_adaptive_short.costPct}% ต่ำกว่าระยะราคาที่ต้องชดเชยต้นทุนประมาณ ${roundTrip.toFixed(3)}%; ปรับต้นทุนเผื่อในพารามิเตอร์ให้ตรงค่า fee/slippage ที่ใช้ทดสอบ`);
  }
  if (cfg.source === "local") {
    const local = await loadLocalData(cfg, warmupBars(cfg));
    local.warnings.push(...warnings);
    return local;
  }
  if (cfg.source === "latest") {
    k = (
      await page({ ...base, limit: String(Math.min(cfg.limit + 1, 1000)) })
    ).filter((b) => b.closeTime < now);
    // Page backwards: each Binance request is capped at 1000 rows, and the
    // newest page may include an unfinished candle that was filtered out.
    while (k.length && k.length < cfg.limit) {
      const firstOpen = k[0].openTime;
      await pause(80);
      const earlier = (await page({
        ...base,
        limit: String(Math.min(cfg.limit - k.length, 1000)),
        endTime: String(firstOpen - 1),
      })).filter((b) => b.closeTime < now);
      if (!earlier.length) break;
      if (earlier[0].openTime >= firstOpen)
        throw new Error("ข้อมูล Binance ไม่ถอยหลังตามช่วงที่ขอ");
      k = [...earlier, ...k];
    }
    k = k.slice(-cfg.limit);
    if (k.length < cfg.limit)
      warnings.push(`พบแท่งที่ปิดแล้ว ${k.length.toLocaleString("en-US")} จากที่ขอ ${cfg.limit.toLocaleString("en-US")} แท่ง; ประวัติอาจมีไม่เพียงพอ`);
    warnings.push(
      "โหมดแท่งล่าสุดคำนวณจากหน้าต่างข้อมูลนี้เท่านั้น เริ่มจำลองด้วยสถานะว่าง; ช่วงต้นอาจยังเตรียม indicator ไม่ครบ",
    );
  } else {
    const end = Math.min(cfg.to!, now - 1);
    let cursor = cfg.from!;
    while (cursor <= end) {
      const batch = await page({
        ...base,
        limit: "1000",
        startTime: String(cursor),
        endTime: String(end),
      });
      if (!batch.length) break;
      const next = batch.at(-1)!.openTime + 1;
      if (next <= cursor) throw new Error("ข้อมูล Binance ไม่เดินหน้า");
      k.push(
        ...batch.filter((b) => b.openTime >= cfg.from! && b.closeTime <= end),
      );
      if (k.length > 10000)
        throw new Error(
          "ช่วงข้อมูลเกิน 10,000 แท่ง กรุณาลดช่วงวันหรือเลือก timeframe ที่ยาวขึ้น",
        );
      cursor = next;
      if (batch.length < 1000) break;
      await pause(80);
    }
    const warmCount = warmupBars(cfg);
    const firstOpen = k[0]?.openTime ?? cfg.from!;
    const warm = (
      await page({
        ...base,
        limit: String(warmCount),
        endTime: String(firstOpen - 1),
      })
    ).filter((b) => b.closeTime < firstOpen);
    start = warm.length;
    k = [...warm, ...k];
    if (start < warmCount)
      warnings.push(
        `มีแท่งเตรียม indicator ${start}/${warmCount} แท่ง อาจเป็นช่วงเริ่มเปิดซื้อขาย`,
      );
    warnings.push(
      "ใช้ประวัติสะสมพร้อมแท่งเตรียม indicator; อาจต่างจากบอทที่คำนวณใหม่ด้วยหน้าต่าง 500 แท่ง",
    );
  }
  if (k.length - start < 2)
    throw new Error("ไม่พบแท่งที่ปิดแล้วเพียงพอในช่วงที่เลือก");
  for (let i = 1; i < k.length; i++) {
    if (k[i].openTime <= k[i - 1].openTime)
      throw new Error("ข้อมูลมีแท่งซ้ำหรือเรียงเวลาไม่ถูกต้อง");
    if (
      k[i].openTime !== k[i - 1].closeTime + 1 &&
      !warnings.some((w) => w.includes("ช่องว่าง"))
    )
      warnings.push("ข้อมูลมีช่องว่างระหว่างแท่ง โปรดตรวจสอบก่อนใช้ผลทดสอบ");
  }
  return { klines: k, start, warnings };
}
