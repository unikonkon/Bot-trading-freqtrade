/**
 * Harness ฝั่ง TypeScript (แผนเฟส 1)
 * dump ค่า indicator ทุกคอลัมน์ + สัญญาณของทุก strategy ออกเป็น CSV
 * เพื่อให้ ft/user_data/scripts/compare_with_ts.py เทียบกับผลจาก Python
 *
 * ใช้:  npx tsx scripts/dump-indicators.ts ft/fixtures/BTCUSDT-1h.json ft/fixtures/BTCUSDT-1h.ts.csv
 */
import fs from "node:fs";
import { parseKline, type BinanceKlineRaw } from "@/lib/types/kline";
import { computeAll } from "@/lib/indicators";
import { runBacktest, STRATEGIES } from "@/lib/backtest";

const [, , file, out] = process.argv;
if (!file || !out) {
  console.error("usage: npx tsx scripts/dump-indicators.ts <fixture.json> <out.csv>");
  process.exit(2);
}

const raw = JSON.parse(fs.readFileSync(file, "utf8")) as BinanceKlineRaw[];
const klines = raw.map(parseKline);
const ind = computeAll(klines);

type Cell = number | string | null | boolean | undefined;
const cols: Record<string, Cell[]> = {
  openTime: klines.map((k) => k.openTime),
  rsi: ind.rsi,
  atr: ind.atr,
  cdc_fast: ind.cdcActionZone.fastMA,
  cdc_slow: ind.cdcActionZone.slowMA,
  cdc_zone: ind.cdcActionZone.zone,
  macd: ind.cmMacd.macdLine,
  macd_signal: ind.cmMacd.signalLine,
  macd_hist: ind.cmMacd.histogram,
  st_line: ind.supertrend.supertrend,
  st_trend: ind.supertrend.trend,
  sqz_val: ind.squeezeMomentum.value,
  sqz_on: ind.squeezeMomentum.sqzOn,
  ut_stop: ind.utBot.trailingStop,
  ut_pos: ind.utBot.pos,
  msb_market: ind.msbOb.market,
  sr_res: ind.supportResistance.resistance,
  sr_sup: ind.supportResistance.support,
  tl_upper: ind.trendlines.upper,
  tl_lower: ind.trendlines.lower,
  smc_internal_trend: ind.smc.internalTrend,
  smc_pd: ind.smc.premiumDiscount,
};
for (const s of STRATEGIES) cols[`sig_${s.id}`] = runBacktest(klines, s.id).signals;

const keys = Object.keys(cols);
const lines = [keys.join(",")];
for (let i = 0; i < klines.length; i++) {
  lines.push(keys.map((k) => String(cols[k][i] ?? "")).join(","));
}
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}: ${klines.length} rows, ${keys.length} columns`);
