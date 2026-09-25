/**
 * ทำไม v3 ไม่มีสัญญาณเลยในช่วงสั้น — วัดข้อเท็จจริงก่อนแก้อะไร
 *
 *   npx tsx "signal-bot/web ui/research-v3/signal-rate.ts"
 */
import { load, f2 } from "./lib";
import { V3_STRATEGY_IDS, computeV3, v3Defaults } from "../../../lib/indicators-v3";

const TFS = ["1m", "3m", "5m", "15m", "30m"] as const;
const MIN_PER = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30 } as const;
/** ไฟล์นี้อธิบายปัญหาของโหมดนับเป็นวัน (ต้องสะสม 125 วัน) จึงขอโหมดนั้นตรง ๆ — ค่าตั้งต้นของทะเบียนตอนนี้นับเป็นแท่ง */
const DAY_MODE = { flowLookbackBars: 0, flowDebiasBars: 0 };
const LIVE_LIMIT = 1000; // เพดานของ Binance ต่อคำขอ (signal-bot ตั้งค่าตั้งต้นไว้ที่ 500)

console.log("# ทำไม v3 ไม่มีสัญญาณในช่วงสั้น\n");
console.log("## 1. จำนวนแท่งที่ชั้นทิศทางต้องสะสมก่อนให้ค่าแรก (lookback 5 วัน + debias 120 วัน)\n");
console.log("| tf | แท่ง/วัน | ต้องมีก่อนค่าแรก | = กี่วัน | ดึงสด 1000 แท่ง ได้กี่วัน | ใช้ได้ไหม |");
console.log("|---|---:|---:|---:|---:|---|");
for (const tf of TFS) {
  const perDay = 1440 / MIN_PER[tf];
  const need = Math.round(125 * perDay);
  console.log(`| ${tf} | ${perDay} | ${need.toLocaleString()} | 125 | ${f2(LIVE_LIMIT / perDay, 1)} | ${need <= LIVE_LIMIT ? "✅" : "❌ ไม่มีสัญญาณเลย"} |`);
}

console.log("\n## 2. ความถี่ของสัญญาณจริง เมื่อข้อมูลยาวพอแล้ว (BTCUSDT เต็มปี)\n");
console.log("| tf | กลยุทธ์ | แท่งทั้งหมด | แท่งที่คำนวณได้ | สัญญาณ | ไม้ | วัน/ไม้ | สัญญาณต่อวัน |");
console.log("|---|---|---:|---:|---:|---:|---:|---:|");
for (const tf of TFS) {
  const k = load(tf);
  const perDay = 1440 / MIN_PER[tf];
  const days = k.length / perDay;
  for (const id of V3_STRATEGY_IDS) {
    if (id.endsWith("_long") || id.endsWith("_short")) continue;
    const r = computeV3(id, k, DAY_MODE, 0);
    const live = r.signalValue.filter((v) => v !== null).length;
    const sig = r.signal.filter(Boolean).length;
    const entries = r.signal.filter((s) => s === "BUY" || s === "SHORT").length;
    console.log(`| ${tf} | ${id} | ${k.length.toLocaleString()} | ${live.toLocaleString()} | ${sig} | ${entries} | ${entries ? f2(days / entries, 1) : "—"} | ${f2(sig / days, 3)} |`);
  }
}

console.log("\n## 3. ต้นทุนของการเพิ่มความถี่ (ต้นทุนไป-กลับ futures taker 0.16%)\n");
console.log("| สัญญาณซื้อ-ขายครบรอบต่อวัน | ไม้/ปี | ค่าธรรมเนียมต่อปี | ต้องได้กำไรก่อนต้นทุนเท่าไรจึงเสมอตัว |");
console.log("|---:|---:|---:|---|");
for (const perDay of [0.2, 1, 2, 4, 8, 24]) {
  const perYear = perDay * 365;
  console.log(`| ${perDay} | ${Math.round(perYear)} | **${f2(perYear * 0.16, 0)}%** | ${f2(0.16, 2)}% ต่อไม้ |`);
}

// ══ 4) ทางที่เพิ่มความถี่ได้โดยไม่ทำลายความได้เปรียบ: เพิ่มจำนวนเหรียญ ═══
import fs from "node:fs";
import path from "node:path";
import type { KlineData } from "../../../lib/types/kline";
console.log("\n## 4. ความถี่เมื่อรันหลายเหรียญพร้อมกัน (ค่าตั้งต้น ไม่แตะพารามิเตอร์เลย)\n");
const COIN_DIR = "data-test/crosscoin";
for (const tf of ["15m", "30m"] as const) {
  const perDay = 1440 / MIN_PER[tf];
  const rows: { name: string; sig: number; days: number }[] = [];
  const btc = load(tf);
  rows.push({ name: "BTC", sig: 0, days: btc.length / perDay });
  const series: Record<string, KlineData[]> = { BTC: btc };
  for (const f of fs.readdirSync(COIN_DIR).filter((x) => x.endsWith(`-${tf}.jsonl`)).sort()) {
    const name = f.split("-")[0].replace("USDT", "");
    series[name] = fs.readFileSync(path.join(COIN_DIR, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
  }
  console.log(`\n### ${tf}\n`);
  console.log("| กลยุทธ์ | " + Object.keys(series).join(" | ") + " | **รวมทุกเหรียญ** |");
  console.log("|---|" + Object.keys(series).map(() => "---:").join("|") + "|---:|");
  for (const id of V3_STRATEGY_IDS) {
    if (id.endsWith("_long") || id.endsWith("_short")) continue;
    const per = Object.entries(series).map(([, k]) => {
      const r = computeV3(id, k, DAY_MODE, 0);
      return r.signal.filter(Boolean).length / (k.length / perDay);
    });
    console.log(`| ${id} | ${per.map((x) => f2(x, 2)).join(" | ")} | **${f2(per.reduce((a, b) => a + b, 0), 2)}** |`);
  }
}
console.log("\nอ่านตารางนี้คู่กับตารางที่ 3: การเพิ่มเหรียญทำให้สัญญาณถี่ขึ้นเป็นสัดส่วนตรง");
console.log("โดย**ต้นทุนต่อไม้ไม่เปลี่ยน** ต่างจากการย่นหน้าต่าง ซึ่ง `fast-window-select.ts` วัดแล้วว่าทำลายความได้เปรียบ");
