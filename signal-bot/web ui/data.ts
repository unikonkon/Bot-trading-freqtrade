import { GET as klinesRoute } from "../../api/klines/route";
import { loadLocalData } from "./local-data";
import {
  parseKline,
  INTERVALS,
  type BinanceKlineRaw,
  type KlineData,
} from "../../lib/types/kline";
import { STRATEGIES, type StrategyId } from "../../lib/backtest";
import {
  isV2StrategyId,
  v2WarmupBars,
  validateV2Params,
} from "../../lib/indicators-v2";
import {
  isV3StrategyId,
  v3WarmupBars,
  validateV3Params,
} from "../../lib/indicators-v3";

export interface RequestConfig {
  symbol: string;
  /** Interval shown in the chart, per-bar values and Telegram preview. Always a member of `intervals`. */
  interval: string;
  /** Every interval the run covers, ordered as in INTERVALS. */
  intervals: string[];
  source: "latest" | "range" | "local";
  snapshot?: string;
  limit: number;
  from?: number;
  to?: number;
  strategies: StrategyId[];
  selected: StrategyId;
  params: Record<string, Record<string, number>>;
  fee: number;
  slippage: number;
  /**
   * ต้นทุน funding ของ perpetual futures เป็น % ต่อรอบ 8 ชั่วโมง
   * ใช้เฉพาะกลยุทธ์สองทาง (v3) ที่เปิดสถานะขายได้ กลยุทธ์ Spot ไม่ถูกกระทบ
   * คิดเป็นต้นทุนของผู้ถือทั้งสองฝั่ง ซึ่งเป็นสมมติฐานแบบระมัดระวัง
   */
  funding: number;
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
  // Accepts a list of intervals; a single `interval` stays valid for older callers.
  let intervals: string[];
  if (v.intervals !== undefined) {
    if (!Array.isArray(v.intervals) || !v.intervals.length)
      throw new Error("ต้องเลือกอย่างน้อย 1 ช่วงแท่งเทียน");
    if (v.intervals.length > INTERVALS.length)
      throw new Error("เลือกช่วงแท่งเทียนเกินจำนวนที่มี");
    if (!v.intervals.every((i) => INTERVALS.includes(i as never)))
      throw new Error("Timeframe ไม่ถูกต้อง");
    if (new Set(v.intervals).size !== v.intervals.length)
      throw new Error("เลือกช่วงแท่งเทียนซ้ำ");
    const chosen = new Set(v.intervals as string[]);
    intervals = INTERVALS.filter((i) => chosen.has(i));
  } else if (INTERVALS.includes(v.interval as never)) intervals = [String(v.interval)];
  else throw new Error("Timeframe ไม่ถูกต้อง");
  const mainInterval = v.interval === undefined ? intervals[0] : String(v.interval);
  if (!intervals.includes(mainInterval))
    throw new Error("ช่วงแท่งเทียนหลักต้องอยู่ในรายการที่เลือกทดสอบ");
  if (!["latest", "range", "local"].includes(String(v.source)))
    throw new Error("รูปแบบข้อมูลไม่ถูกต้อง");
  if (!["next_open", "legacy", "both"].includes(String(v.mode)))
    throw new Error("โหมดจำลองไม่ถูกต้อง");
  const ids = STRATEGIES.map((s) => s.id);
  // Accepts a list of strategies; "all" and a single id stay valid for older callers.
  let requested: StrategyId[];
  if (v.strategies !== undefined) {
    if (!Array.isArray(v.strategies) || !v.strategies.length)
      throw new Error("ต้องเลือกอย่างน้อย 1 กลยุทธ์");
    if (v.strategies.length > ids.length) throw new Error("เลือกกลยุทธ์เกินจำนวนที่มี");
    if (!v.strategies.every((id) => ids.includes(id as StrategyId)))
      throw new Error("ไม่พบกลยุทธ์");
    if (new Set(v.strategies).size !== v.strategies.length)
      throw new Error("เลือกกลยุทธ์ซ้ำ");
    const chosen = new Set(v.strategies as StrategyId[]);
    requested = ids.filter((id) => chosen.has(id));
  } else if (v.strategy === "all") requested = [...ids];
  else if (ids.includes(v.strategy as StrategyId)) requested = [v.strategy as StrategyId];
  else throw new Error("ไม่พบกลยุทธ์");
  if (!ids.includes(v.selected as StrategyId))
    throw new Error("ไม่พบกลยุทธ์ที่เลือก");
  if (!requested.includes(v.selected as StrategyId))
    throw new Error("กลยุทธ์หลักต้องอยู่ในรายการที่เลือกทดสอบ");
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
      // กลยุทธ์ v2 ประกาศขอบเขตของตัวเองไว้ใน lib/indicators-v2.ts จึงใช้ค่านั้นตรง ๆ
      const meta = s.paramMeta?.[key];
      if (meta) {
        params[s.id][key] = number(value, key, meta.min, meta.max, meta.integer);
        continue;
      }
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
    if (isV2StrategyId(s.id)) {
      const problem = validateV2Params(s.id, p);
      if (problem) throw new Error(`${s.name}: ${problem}`);
    }
    if (isV3StrategyId(s.id)) {
      const problem = validateV3Params(s.id, p);
      if (problem) throw new Error(`${s.name}: ${problem}`);
    }
  }
  const result: RequestConfig = {
    symbol,
    interval: mainInterval,
    intervals,
    source: v.source as RequestConfig["source"],
    limit: number(v.limit ?? 500, "จำนวนแท่ง", 300, 10000, true),
    strategies: requested,
    selected: v.selected as StrategyId,
    params,
    fee: number(v.fee, "ค่าธรรมเนียม", 0, 5),
    slippage: number(v.slippage, "Slippage", 0, 5),
    funding: number(v.funding ?? 0.01, "Funding", 0, 1),
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

/**
 * กลยุทธ์ v1 คงพฤติกรรมเดิมทุกประการ (คาดเดาช่วงจากชื่อพารามิเตอร์ เพดาน 1,000 แท่ง)
 * กลยุทธ์ v2 ประกาศความต้องการของตัวเองผ่าน v2WarmupBars เพราะบางตัว เช่น Lorentzian
 * ไม่ให้สัญญาณเลยจนกว่าจะมีแท่งครบ maxBarsBack เพดานรวมจึงขยายเป็น 4,000 แท่ง
 */
export function warmupBars(cfg: RequestConfig) {
  // v2 และ v3 ประกาศความต้องการของตัวเอง ห้ามใช้กฎเดาจากชื่อพารามิเตอร์กับสองชุดนี้
  // (เช่น maxSizePct ของ v3 มีคำว่า "Size" แต่เป็นขนาดไม้ ไม่ใช่ช่วงคำนวณ)
  const legacy = cfg.strategies.filter((id) => !isV2StrategyId(id) && !isV3StrategyId(id));
  const periods = legacy.flatMap((id) =>
    Object.entries(cfg.params[id])
      .filter(([key]) => /period|length|size|bars|len/i.test(key))
      .map(([, v]) => v),
  );
  let bars = periods.length
    ? Math.min(1000, Math.max(300, Math.max(...periods) * 5))
    : 300;
  for (const id of cfg.strategies) {
    if (isV2StrategyId(id)) bars = Math.max(bars, v2WarmupBars(id, cfg.params[id]));
    if (isV3StrategyId(id)) bars = Math.max(bars, v3WarmupBars(id, cfg.params[id]));
  }
  return Math.min(4000, bars);
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
  if (cfg.strategies.includes("smc_adaptive_short")) {
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

export type IntervalData = Awaited<ReturnType<typeof loadData>>;

/**
 * Loads one interval of a multi-interval run. An interval that cannot be loaded —
 * outside the snapshot, not downloaded yet, or over the 10,000-bar range cap —
 * is reported instead of failing the whole run.
 */
export async function loadInterval(
  cfg: RequestConfig,
  interval: string,
  load: typeof loadData = loadData,
): Promise<{ data?: IntervalData; warnings: string[] }> {
  try {
    const data = await load({ ...cfg, interval });
    return { data, warnings: data.warnings.map((w) => `[${interval}] ${w}`) };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ";
    return { warnings: [`ข้ามช่วง ${interval}: ${reason}`] };
  }
}
