import { loadData, type RequestConfig } from "./data";
import { analyze } from "./engine";
import { STRATEGIES, type StrategyId } from "../../lib/backtest";

let cfg: RequestConfig;
let data: Awaited<ReturnType<typeof loadData>>;
let detail: ReturnType<typeof analyze>;
let summaries: ReturnType<typeof analyze>[] = [];
const send = (message: unknown) => process.send?.(message);
function getDetail(id: StrategyId) {
  if (detail?.id !== id) {
    send({ progress: `คำนวณรายละเอียด ${id}` });
    detail = analyze(data.klines, data.start, id, cfg.params[id], cfg.fee, cfg.slippage, cfg.mode, true, true);
  }
  return detail;
}
function view(input: { strategy?: StrategyId; offset?: number; count?: number; tradePage?: number } = {}) {
  const totalBars = data.klines.length - data.start;
  const count = Math.max(1, Math.min(2000, Math.trunc(input.count ?? 2000)));
  const offset = Math.max(0, Math.min(Math.max(0, totalBars - 1), Math.trunc(input.offset ?? Math.max(0, totalBars - count))));
  const end = Math.min(totalBars, offset + count);
  const d = getDetail(input.strategy ?? cfg.selected);
  const tradePage = Math.max(0, Math.trunc(input.tradePage ?? 0));
  return {
    paged: true, config: cfg, warnings: data.warnings, warmup: data.start, totalBars, offset,
    from: data.klines[data.start].openTime, to: data.klines.at(-1)!.closeTime,
    klines: data.klines.slice(data.start + offset, data.start + end),
    results: summaries,
    detail: { ...d, signals: d.signals.slice(offset, end),
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
      send({ progress: "ตรวจไฟล์และโหลดข้อมูลย้อนหลัง" });
      data = await loadData(cfg);
      const ids = cfg.strategies;
      for (let index = 0; index < ids.length; index++) {
        const id = ids[index];
        send({ progress: `คำนวณ ${id} (${index + 1}/${ids.length}) · ${(data.klines.length - data.start).toLocaleString()} แท่ง` });
        const r = analyze(data.klines, data.start, id, cfg.params[id], cfg.fee, cfg.slippage, cfg.mode, id === cfg.selected, true);
        if (id === cfg.selected) detail = r;
        summaries.push({ ...r, signals: [], indicators: {}, simulations: r.simulations.map(s => ({ ...s, trades: [], equity: [] })) });
      }
      result = view();
    } else if (message.command === "view") {
      if (!data) throw Error("Run not ready");
      if (message.input.strategy && !STRATEGIES.some(s => s.id === message.input.strategy)) throw Error("Unknown strategy");
      for (const key of ["offset", "count", "tradePage"]) {
        const value = message.input[key];
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw Error(`Invalid ${key}`);
      }
      result = view(message.input);
    } else throw Error("Unknown command");
    send({ requestId: message.requestId, result });
  } catch (error) { send({ requestId: message.requestId, error: error instanceof Error ? error.message : String(error) }); }
});
