/**
 * Harness ฝั่ง TypeScript (แผนเฟส 1)
 * dump ค่า indicator ทุกคอลัมน์ + สัญญาณของทุก strategy ออกเป็น CSV
 * เพื่อให้ freqtrade/user_data/scripts/compare_with_ts.py เทียบกับผลจาก Python
 *
 * ใช้:  npx tsx freqtrade/scripts/dump-indicators.ts <fixture.json> <out.csv> [--mode ts|live]
 *   --mode live (default) → confirmedPivots=true  เทียบกับ compare_with_ts.py --mode live ต้อง PASS ทุกคอลัมน์
 *   --mode ts             → confirmedPivots=false พฤติกรรม TS เดิม (มี lookahead) เทียบกับ --mode ts
 */
import fs from "node:fs";
import { parseKline, type BinanceKlineRaw } from "@/lib/types/kline";
import { computeAll } from "@/lib/indicators";
import { runBacktest, STRATEGIES } from "@/lib/backtest";

const args = process.argv.slice(2);
const modeIdx = args.indexOf("--mode");
const mode = modeIdx >= 0 ? args[modeIdx + 1] : "live";
const positional = args.filter((a, i) => a !== "--mode" && i !== modeIdx + 1);
const [file, out] = positional;
if (!file || !out || (mode !== "ts" && mode !== "live")) {
  console.error("usage: npx tsx freqtrade/scripts/dump-indicators.ts <fixture.json> <out.csv> [--mode ts|live]");
  process.exit(2);
}
const confirmedPivots = mode === "live";

const raw = JSON.parse(fs.readFileSync(file, "utf8")) as BinanceKlineRaw[];
const klines = raw.map(parseKline);
const ind = computeAll(klines, { confirmedPivots });

type Cell = number | string | null | boolean | undefined;
const cols: Record<string, Cell[]> = {
  openTime: klines.map((k) => k.openTime),
  rsi: ind.rsi,
  atr: ind.atr,
  cdc_fast: ind.cdcActionZone.fastMA,
  cdc_slow: ind.cdcActionZone.slowMA,
  cdc_zone: ind.cdcActionZone.zone,
  st_line: ind.supertrend.supertrend,
  st_trend: ind.supertrend.trend,
  msb_market: ind.msbOb.market,
  sr_res: ind.supportResistance.resistance,
  sr_sup: ind.supportResistance.support,
  tl_upper: ind.trendlines.upper,
  tl_lower: ind.trendlines.lower,
  smc_internal_trend: ind.smc.internalTrend,
  smc_pd: ind.smc.premiumDiscount,
};
for (const s of STRATEGIES) cols[`sig_${s.id}`] = runBacktest(klines, s.id, {}, 0.1, { confirmedPivots }).signals;

const keys = Object.keys(cols);
const lines = [keys.join(",")];
for (let i = 0; i < klines.length; i++) {
  lines.push(keys.map((k) => String(cols[k][i] ?? "")).join(","));
}
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out} (mode=${mode}): ${klines.length} rows, ${keys.length} columns`);
