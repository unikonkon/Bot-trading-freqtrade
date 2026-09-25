/**
 * ตรวจว่า config ของบอท TS (.env → BOTS, STRATEGY_PARAMS) เล่าเรื่องเดียวกับ freqtrade
 * (freqtrade/user_data/config.json + config.<tf>.json ที่มีอยู่ → pair_whitelist, pair_strategy_map, strategy_params)
 *
 * ใช้:  npm run check:sync            (อ่าน signal-bot/.env)
 *       npx tsx signal-bot/scripts/check-config-sync.ts freqtrade/user_data/config.1h.json
 * exit 0 = ตรงกัน, 1 = มีความต่าง (พิมพ์รายการ + ค่า BOTS ที่ควรเป็น)
 */
import fs from "node:fs";
import path from "node:path";
import { loadDotEnv, parseBots } from "@/signal-bot/env";

interface FtConfig {
  timeframe?: string;
  exchange?: { pair_whitelist?: string[] };
  pair_strategy_map?: Record<string, string>;
  strategy_params?: Record<string, Record<string, number>>;
}

function readJson(p: string): FtConfig {
  return JSON.parse(fs.readFileSync(p, "utf8")) as FtConfig;
}

const root = process.cwd();
const ftDir = path.join(root, "freqtrade/user_data");
const base = readJson(path.join(ftDir, "config.json"));
const instanceFiles = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["config.1h.json", "config.4h.json"].map((f) => path.join(ftDir, f)).filter(fs.existsSync);

// ─── ฝั่ง freqtrade: รวมทุก instance → set ของ "SYMBOL:INTERVAL:STRATEGY" ───
const expected = new Map<string, { file: string }>();
const problems: string[] = [];
for (const f of instanceFiles) {
  const inst = readJson(f);
  const timeframe = inst.timeframe ?? base.timeframe;
  const whitelist = inst.exchange?.pair_whitelist ?? base.exchange?.pair_whitelist ?? [];
  const map = { ...(base.pair_strategy_map ?? {}), ...(inst.pair_strategy_map ?? {}) };
  if (!timeframe) { problems.push(`${f}: ไม่มี timeframe`); continue; }
  for (const pair of whitelist) {
    const sid = map[pair] ?? "supertrend"; // default ของ BaseSignalStrategy.strategy_id
    const symbol = pair.replace("/", "").toUpperCase();
    const id = `${symbol}:${timeframe}:${sid}`;
    if (expected.has(id)) problems.push(`คู่ ${pair} ${timeframe} ซ้ำสอง instance (${expected.get(id)!.file} และ ${f})`);
    expected.set(id, { file: path.basename(f) });
  }
  for (const pair of Object.keys(inst.pair_strategy_map ?? {})) {
    if (!whitelist.includes(pair)) problems.push(`${path.basename(f)}: ${pair} อยู่ใน pair_strategy_map แต่ไม่อยู่ใน pair_whitelist`);
  }
}

// ─── ฝั่งบอท TS ───
loadDotEnv();
const botsEnv = process.env.BOTS ?? "";
let paramsEnv: Record<string, Record<string, number>> = {};
try { paramsEnv = process.env.STRATEGY_PARAMS ? JSON.parse(process.env.STRATEGY_PARAMS) : {}; }
catch (e) { problems.push(`STRATEGY_PARAMS ไม่ใช่ JSON: ${String(e)}`); }
let actual = new Set<string>();
try { actual = new Set(parseBots(botsEnv, paramsEnv).map((b) => b.id)); }
catch (e) { problems.push(`BOTS parse ไม่ได้: ${String(e)}`); }

const missingInTs = [...expected.keys()].filter((id) => !actual.has(id));
const extraInTs = [...actual].filter((id) => !expected.has(id));

// ─── พารามิเตอร์: STRATEGY_PARAMS (ถ้ามี) ต้องเท่ากับ strategy_params ของ freqtrade ───
const ftParams = base.strategy_params ?? {};
const usedStrategies = new Set([...expected.keys()].map((id) => id.split(":")[2]));
for (const sid of usedStrategies) {
  const ft = ftParams[sid] ?? {};
  const ts = paramsEnv[sid] ?? {};
  for (const k of new Set([...Object.keys(ft), ...Object.keys(ts)])) {
    if (k in ts && ts[k] !== ft[k]) problems.push(`param ${sid}.${k}: TS=${ts[k]} freqtrade=${ft[k] ?? "(default)"}`);
  }
}

// ─── รายงาน ───
console.log(`freqtrade instances: ${instanceFiles.map((f) => path.basename(f)).join(", ")}`);
console.log(`expected (จาก freqtrade): ${[...expected.keys()].join(", ") || "(ว่าง)"}`);
console.log(`actual   (จาก BOTS):      ${[...actual].join(", ") || "(ว่าง)"}`);
for (const id of missingInTs) console.log(`MISSING  ${id}  ← freqtrade เทรด แต่บอท TS ไม่ได้เฝ้า`);
for (const id of extraInTs) console.log(`EXTRA    ${id}  ← บอท TS เฝ้า แต่ freqtrade ไม่ได้เทรด (แจ้งเตือนอย่างเดียว ยอมรับได้ถ้าตั้งใจ)`);
for (const p of problems) console.log(`PROBLEM  ${p}`);

const ok = missingInTs.length === 0 && problems.length === 0;
if (!ok) {
  console.log(`\nค่า BOTS ที่ตรงกับ freqtrade:\nBOTS=${[...expected.keys()].join(",")}`);
  console.log("FAIL");
  process.exit(1);
}
console.log(extraInTs.length ? "OK (มี EXTRA ที่แจ้งเตือนอย่างเดียว)" : "OK");
