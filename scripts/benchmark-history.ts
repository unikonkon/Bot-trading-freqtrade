import { performance } from "node:perf_hooks";
import path from "node:path";
import { loadData, validate } from "../signal-bot/web ui/data";
import { analyze } from "../signal-bot/web ui/engine";
import { STRATEGIES } from "../lib/backtest";
import { snapshotPath, atomicJSON } from "./history-storage";
async function main() {
  const snapshot = process.argv[2], interval = process.argv[3] ?? "1m";
  if (!snapshot) throw Error("Usage: npm run history:benchmark -- <snapshot> [interval]");
  const cfg = validate({ source: "local", snapshot, symbol: "BTCUSDT", interval, strategy: "all", selected: "supertrend", params: {}, fee: .1, slippage: .05, mode: "both" });
  const began = performance.now(), data = await loadData(cfg), loadMs = performance.now() - began, records = [];
  for (const s of STRATEGIES) {
    const t = performance.now();
    const result = analyze(data.klines, data.start, s.id, cfg.params[s.id], cfg.fee, cfg.slippage, cfg.mode, false, true);
    const ms = performance.now() - t;
    records.push({ strategy: s.id, ms: Math.round(ms), simulations: result.simulations, rssMB: Math.round(process.memoryUsage().rss / 1048576) });
    console.log(`${s.id}: ${Math.round(ms)}ms, ${data.klines.length - data.start} candles, RSS ${records.at(-1)!.rssMB}MB`);
  }
  await atomicJSON(path.join(snapshotPath(snapshot), `benchmark-${interval}.json`), { checkedAt: new Date().toISOString(), bars: data.klines.length - data.start, warmup: data.start, loadMs: Math.round(loadMs), totalMs: Math.round(performance.now() - began), records });
}
main().catch(e => { console.error(e); process.exitCode = 1; });
