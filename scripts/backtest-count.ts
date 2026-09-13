/**
 * เทียบจำนวน trade ของ backtest.ts กับ freqtrade บนข้อมูลชุดเดียวกัน (แผนเฟส 4 ข้อ 8.3)
 * ใช้:  npx tsx scripts/backtest-count.ts ft/user_data/data/BTCUSDT-1h.full.json supertrend 2026-06-01
 */
import fs from "node:fs";
import { parseKline, type BinanceKlineRaw } from "@/lib/types/kline";
import { runBacktest, type StrategyId } from "@/lib/backtest";

const [, , file, strategy, from] = process.argv;
const raw = JSON.parse(fs.readFileSync(file, "utf8")) as BinanceKlineRaw[];
const klines = raw.map(parseKline);
const fromMs = Date.parse(from + "T00:00:00Z");
const res = runBacktest(klines, strategy as StrategyId);
const trades = res.trades.filter((t) => t.entryTime >= fromMs);
const wins = trades.filter((t) => t.pnlPct > 0).length;
console.log(`${strategy} from ${from}: trades=${trades.length} wins=${wins} losses=${trades.length - wins} totalPnl%=${trades.reduce((s, t) => s + t.pnlPct, 0).toFixed(2)}`);
for (const t of trades.slice(0, 5)) {
  console.log(`  entry ${new Date(t.entryTime).toISOString()} @${t.entryPrice} → exit ${new Date(t.exitTime).toISOString()} @${t.exitPrice} ${t.pnlPct.toFixed(2)}%`);
}
