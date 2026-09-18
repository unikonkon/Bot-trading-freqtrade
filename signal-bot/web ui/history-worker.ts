import { loadData, loadInterval, type RequestConfig, type IntervalData } from "./data";
import { analyze } from "./engine";
import { STRATEGIES, type StrategyId } from "../../lib/backtest";

interface IntervalSummary {
  interval: string;
  bars: number;
  warmup: number;
  from: number;
  to: number;
}
let cfg: RequestConfig;
// Only one interval's candles stay resident; switching intervals reloads from disk.
let current: { interval: string; data: IntervalData } | undefined;
let detail: ReturnType<typeof analyze> | undefined;
let mainInterval = "";
let summaries: (ReturnType<typeof analyze> & { interval: string })[] = [];
let intervals: IntervalSummary[] = [];
let warnings: string[] = [];
const send = (message: unknown) => process.send?.(message);
const strip = (r: ReturnType<typeof analyze>, interval: string) => ({
  ...r,
  interval,
  signals: [],
  indicators: {},
  simulations: r.simulations.map((s) => ({ ...s, trades: [], equity: [] })),
});
async function useInterval(interval: string) {
  if (current?.interval === interval) return current.data;
  const loaded = await loadInterval(cfg, interval, loadData);
  if (!loaded.data) throw Error(loaded.warnings[0] ?? "โหลดช่วงแท่งเทียนไม่สำเร็จ");
  current = { interval, data: loaded.data };
  detail = undefined;
  return loaded.data;
}
function getDetail(id: StrategyId) {
  if (detail?.id !== id) {
    send({ progress: `คำนวณรายละเอียด ${id} · ${current!.interval}` });
    const data = current!.data;
    detail = analyze(data.klines, data.start, id, cfg.params[id], cfg.fee, cfg.slippage, cfg.mode, true, true);
  }
  return detail;
}
async function view(input: { interval?: string; strategy?: StrategyId; offset?: number; count?: number; tradePage?: number } = {}) {
  const data = await useInterval(input.interval ?? mainInterval);
  const totalBars = data.klines.length - data.start;
  const count = Math.max(1, Math.min(2000, Math.trunc(input.count ?? 2000)));
  const offset = Math.max(0, Math.min(Math.max(0, totalBars - 1), Math.trunc(input.offset ?? Math.max(0, totalBars - count))));
  const end = Math.min(totalBars, offset + count);
  const d = getDetail(input.strategy ?? cfg.selected);
  const tradePage = Math.max(0, Math.trunc(input.tradePage ?? 0));
  return {
    paged: true, config: cfg, warnings, warmup: data.start, totalBars, offset, intervals,
    interval: current!.interval,
    from: data.klines[data.start].openTime, to: data.klines.at(-1)!.closeTime,
    klines: data.klines.slice(data.start + offset, data.start + end),
    results: summaries,
    detail: { ...d, interval: current!.interval, signals: d.signals.slice(offset, end),
      indicators: Object.fromEntries(Object.entries(d.indicators).map(([key, values]) => [key, values.slice(offset, end)])),
      simulations: d.simulations.map(s => {
        const step = Math.max(1, Math.ceil(s.equity.length / 2000)), indices: number[] = [];
        for (let i = 0; i < s.equity.length; i += step) indices.push(i);
        if (indices.at(-1) !== s.equity.length - 1) indices.push(s.equity.length - 1);
        const page = Math.min(tradePage, Math.max(0, Math.ceil(s.trades.length / 25) - 1));
        return { ...s, trades: s.trades.slice(page * 25, page * 25 + 25), tradePage: page,
          equity: indices.map(i => s.equity[i]), equityIndices: indices };
      }) },
  };
}
process.on("message", async (message: { requestId: number; command: string; input: any }) => {
  try {
    let result: unknown;
    if (message.command === "start") {
      cfg = message.input;
      if (cfg.source !== "local") throw Error("Worker accepts local snapshots only");
      // The worker is forked per run and compiled from disk, so it can be newer than the
      // server process that validated this request. Say so instead of failing on a missing field.
      if (!Array.isArray(cfg.intervals) || !Array.isArray(cfg.strategies))
        throw Error("คำขอไม่มีรายการช่วงแท่งเทียนหรือกลยุทธ์ — server ที่รันอยู่เป็นคนละเวอร์ชันกับโค้ดปัจจุบัน กรุณาหยุดแล้วรัน npm run web:ui ใหม่");
      send({ progress: "ตรวจไฟล์และโหลดข้อมูลย้อนหลัง" });
      for (let index = 0; index < cfg.intervals.length; index++) {
        const interval = cfg.intervals[index];
        send({ progress: `โหลดช่วง ${interval} (${index + 1}/${cfg.intervals.length})` });
        const loaded = await loadInterval(cfg, interval, loadData);
        warnings.push(...loaded.warnings);
        if (!loaded.data) continue;
        const data = loaded.data;
        const bars = data.klines.length - data.start;
        intervals.push({ interval, bars, warmup: data.start, from: data.klines[data.start].openTime, to: data.klines.at(-1)!.closeTime });
        for (let i = 0; i < cfg.strategies.length; i++) {
          const id = cfg.strategies[i];
          send({ progress: `${interval} · คำนวณ ${id} (${i + 1}/${cfg.strategies.length}) · ${bars.toLocaleString()} แท่ง` });
          summaries.push(strip(analyze(data.klines, data.start, id, cfg.params[id], cfg.fee, cfg.slippage, cfg.mode, false, true), interval));
        }
        // Keep the chart interval resident; every other interval is released here.
        if (interval === cfg.interval) current = { interval, data };
      }
      if (!intervals.length) throw Error("ไม่มีช่วงแท่งเทียนที่โหลดได้จากชุดข้อมูลนี้");
      mainInterval = current?.interval ?? intervals[0].interval;
      if (mainInterval !== cfg.interval)
        warnings.push(`ช่วงหลัก ${cfg.interval} ใช้ไม่ได้ จึงแสดงกราฟของ ${mainInterval} แทน`);
      result = await view();
    } else if (message.command === "view") {
      if (!intervals.length) throw Error("Run not ready");
      if (message.input.strategy && !STRATEGIES.some(s => s.id === message.input.strategy)) throw Error("Unknown strategy");
      if (message.input.interval && !intervals.some(i => i.interval === message.input.interval)) throw Error("Unknown interval");
      for (const key of ["offset", "count", "tradePage"]) {
        const value = message.input[key];
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw Error(`Invalid ${key}`);
      }
      result = await view(message.input);
    } else throw Error("Unknown command");
    send({ requestId: message.requestId, result });
  } catch (error) { send({ requestId: message.requestId, error: error instanceof Error ? error.message : String(error) }); }
});
