/**
 * โหลด .env และแปลงเป็น config ของบอทสัญญาณ
 * ไม่ใช้ไลบรารีภายนอก — อ่านไฟล์ KEY=VALUE เอง (ไม่ทับค่าที่มีอยู่แล้วใน process.env)
 */
import fs from "node:fs";
import path from "node:path";
import { STRATEGIES, type StrategyId } from "@/lib/backtest";
import { INTERVALS } from "@/lib/types/kline";

/** ลำดับการหา .env: ENV_FILE → signal-bot/.env → .env (ที่ root; รัน process จาก root ของ repo เสมอ) */
export function resolveEnvFile(): string | null {
  const candidates = [
    process.env.ENV_FILE,
    path.resolve(process.cwd(), "signal-bot/.env"),
    path.resolve(process.cwd(), ".env"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function loadDotEnv(file = resolveEnvFile()): void {
  if (!file) return;
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export interface BotSpec {
  id: string;            // "BTCUSDT:1h:supertrend"
  symbol: string;        // "BTCUSDT"
  interval: string;      // "1h"
  strategyId: StrategyId;
  params: Record<string, number>;
}

export interface BotConfig {
  telegramToken: string;           // ว่าง = ปิด Telegram (พิมพ์ลง log แทน)
  telegramChatId: string;          // chat ที่รับแจ้งเตือน
  allowedChatIds: Set<string>;     // chat ที่สั่งงานได้ (default = telegramChatId)
  bots: BotSpec[];
  klineLimit: number;              // จำนวนแท่งที่ดึงมาคำนวณ (≥ 300 เพราะ SMC ใช้ ATR200 + swing50)
  closeDelaySec: number;           // รอหลังแท่งปิดกี่วินาทีก่อนดึงข้อมูล
  heartbeatMin: number;            // ส่งสรุปสถานะทุกกี่นาที (0 = ปิด)
  fallbackPollSec: number;         // รอบ polling สำหรับ interval ที่จัดตารางตามเวลาปิดไม่ได้ (1M)
  stateFile: string;
  timezone: string;
}

const STRATEGY_IDS = new Set<string>(STRATEGIES.map((s) => s.id));
const INTERVAL_SET = new Set<string>(INTERVALS);

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} ต้องเป็นตัวเลข ได้ "${v}"`);
  return n;
}

export function parseBots(spec: string, paramsByStrategy: Record<string, Record<string, number>>): BotSpec[] {
  const bots: BotSpec[] = [];
  const seen = new Set<string>();
  for (const item of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [symbolRaw, interval, strategyId] = item.split(":").map((s) => s.trim());
    if (!symbolRaw || !interval || !strategyId) {
      throw new Error(`BOTS รูปแบบผิด "${item}" ต้องเป็น SYMBOL:INTERVAL:STRATEGY เช่น BTCUSDT:1h:supertrend`);
    }
    const symbol = symbolRaw.toUpperCase();
    if (!INTERVAL_SET.has(interval)) throw new Error(`interval "${interval}" ไม่รองรับ (${INTERVALS.join(", ")})`);
    if (!STRATEGY_IDS.has(strategyId)) {
      throw new Error(`strategy "${strategyId}" ไม่รู้จัก (${[...STRATEGY_IDS].join(", ")})`);
    }
    const id = `${symbol}:${interval}:${strategyId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const defaults = STRATEGIES.find((s) => s.id === strategyId)!.params;
    bots.push({
      id, symbol, interval,
      strategyId: strategyId as StrategyId,
      params: { ...defaults, ...(paramsByStrategy[strategyId] ?? {}) },
    });
  }
  return bots;
}

export function loadConfig(): BotConfig {
  loadDotEnv();
  const botsSpec = process.env.BOTS ?? "";
  if (!botsSpec.trim()) throw new Error("ต้องตั้ง env BOTS เช่น BOTS=BTCUSDT:1h:supertrend,ETHUSDT:1h:cdc_actionzone");

  let paramsByStrategy: Record<string, Record<string, number>> = {};
  if (process.env.STRATEGY_PARAMS) {
    try {
      paramsByStrategy = JSON.parse(process.env.STRATEGY_PARAMS);
    } catch (e) {
      throw new Error(`STRATEGY_PARAMS ต้องเป็น JSON: ${String(e)}`);
    }
  }

  const telegramChatId = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
  const allowed = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (telegramChatId) allowed.push(telegramChatId);

  const cfg: BotConfig = {
    telegramToken: (process.env.TELEGRAM_BOT_TOKEN ?? "").trim(),
    telegramChatId,
    allowedChatIds: new Set(allowed),
    bots: parseBots(botsSpec, paramsByStrategy),
    klineLimit: Math.min(Math.max(num("KLINE_LIMIT", 500), 300), 1000),
    closeDelaySec: Math.max(num("CLOSE_DELAY_SEC", 8), 1),
    heartbeatMin: Math.max(num("HEARTBEAT_MIN", 240), 0),
    fallbackPollSec: Math.max(num("FALLBACK_POLL_SEC", 300), 30),
    stateFile: process.env.STATE_FILE || path.resolve(process.cwd(), "signal-bot/data/signal-bot-state.json"),
    timezone: process.env.TZ_DISPLAY || "Asia/Bangkok",
  };
  if (cfg.telegramToken && !cfg.telegramChatId) {
    throw new Error("ตั้ง TELEGRAM_BOT_TOKEN แล้วต้องตั้ง TELEGRAM_CHAT_ID ด้วย");
  }
  return cfg;
}
