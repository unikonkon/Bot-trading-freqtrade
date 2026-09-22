/**
 * ตรวจสตรีมสัญญาณของกลยุทธ์ทุกตัวทุกเวอร์ชัน ว่าสลับซื้อ-ขายจริงหรือไม่
 *
 * นิยามที่ใช้: สัญญาณฝั่งซื้อคือ BUY และ COVER (ปิดสถานะขาย = ซื้อกลับ)
 * สัญญาณฝั่งขายคือ SELL และ SHORT ถ้าสองสัญญาณติดกันอยู่ฝั่งเดียวกัน ถือว่าละเมิด
 *
 *   npx tsx "signal-bot/web ui/research/signal-alternation.ts" [tf]
 */
import fs from "node:fs";
import { STRATEGIES, computeSignals, type SignalAction, type StrategyId } from "../../../lib/backtest";
import { simulateNextOpen } from "../engine";
import type { KlineData } from "../../../lib/types/kline";

const TF = process.argv[2] ?? "30m";
const ROOT = "data-test/BTCUSDT/btcusdt-20260917";
const read = (f: string) =>
  fs.readFileSync(`${ROOT}/${f}`, "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
const k: KlineData[] = [...read(`warmup/BTCUSDT-${TF}.jsonl`), ...read(`BTCUSDT-${TF}.jsonl`)];
const START = 1000;
const FEE = 0.1, SLIP = 0.05;

/** +1 = ฝั่งซื้อ, −1 = ฝั่งขาย, 0 = ไม่ใช่สัญญาณ */
const side = (s: SignalAction) => (s === "BUY" || s === "COVER" ? 1 : s === "SELL" || s === "SHORT" ? -1 : 0);

/** บังคับให้สลับฝั่ง: เก็บสัญญาณแรกของแต่ละชุดที่ซ้ำฝั่งกัน และตัดสัญญาณขายที่มาก่อนการซื้อครั้งแรก */
function alternate(signals: SignalAction[], twoWay: boolean): SignalAction[] {
  const out: SignalAction[] = signals.map(() => "HOLD");
  let last = 0;
  for (let i = 0; i < signals.length; i++) {
    const s = side(signals[i]);
    if (s === 0) continue;
    if (s === last) continue;                       // ซ้ำฝั่งเดิม — ตัดทิ้ง
    if (last === 0 && s === -1 && !twoWay) continue; // ขายก่อนซื้อครั้งแรกบนกลยุทธ์ทางเดียว
    out[i] = signals[i];
    last = s;
  }
  return out;
}

console.log(`# สตรีมสัญญาณ BTCUSDT ${TF} · ${k.length - START} แท่ง · เริ่มนับที่แท่ง ${START}\n`);
console.log("| กลยุทธ์ | v | สัญญาณ | ละเมิด | % ละเมิด | ชุดยาวสุด | สัญญาณแรก | net% เดิม | net% หลังบังคับ |");
console.log("|---|---:|---:|---:|---:|---:|---|---:|---:|");
const rows: { id: string; version: number; total: number; bad: number; longest: number; delta: number }[] = [];
for (const cfg of STRATEGIES) {
  let signals: SignalAction[];
  try {
    signals = computeSignals(k, cfg.id as StrategyId, cfg.params as Record<string, number>, { confirmedPivots: true, startIndex: START });
  } catch (e) {
    console.log(`| ${cfg.id} | ${cfg.version} | ขัดข้อง: ${(e as Error).message.slice(0, 40)} | | | | | | |`);
    continue;
  }
  const seq = signals.slice(START);
  let total = 0, bad = 0, longest = 0, run = 0, last = 0, first: SignalAction | "-" = "-";
  for (const s of seq) {
    const sd = side(s);
    if (sd === 0) continue;
    total++;
    if (first === "-") first = s;
    if (sd === last) { bad++; run++; } else { run = 1; }
    longest = Math.max(longest, run);
    last = sd;
  }
  const twoWay = cfg.twoWay === true;
  const before = simulateNextOpen(k, signals, START, FEE, SLIP);
  const after = simulateNextOpen(k, alternate(signals, twoWay), START, FEE, SLIP);
  rows.push({ id: cfg.id, version: cfg.version ?? 1, total, bad, longest, delta: after.returnPct - before.returnPct });
  console.log(`| ${cfg.id} | ${cfg.version ?? 1} | ${total} | ${bad} | ${total ? ((bad / total) * 100).toFixed(0) : "-"}% | ${longest} | ${first} | ${before.returnPct.toFixed(2)}% | ${after.returnPct.toFixed(2)}% |`);
}

console.log("\n## สรุป\n");
for (const v of [1, 2, 3]) {
  const g = rows.filter((r) => r.version === v);
  if (!g.length) continue;
  const broken = g.filter((r) => r.bad > 0);
  const totalSig = g.reduce((s, r) => s + r.total, 0), totalBad = g.reduce((s, r) => s + r.bad, 0);
  const worst = [...g].sort((a, b) => b.bad - a.bad)[0];
  console.log(`- **v${v}**: ${broken.length}/${g.length} กลยุทธ์ละเมิด · สัญญาณรวม ${totalSig} ละเมิด ${totalBad} (${totalSig ? ((totalBad / totalSig) * 100).toFixed(0) : 0}%) · หนักสุดคือ \`${worst.id}\` ${worst.bad} ครั้ง ชุดยาวสุด ${worst.longest}`);
}
const moved = rows.filter((r) => Math.abs(r.delta) > 1e-9);
console.log(`- ผลตอบแทนเปลี่ยนหลังบังคับสลับฝั่ง: ${moved.length}/${rows.length} กลยุทธ์`);
for (const r of moved.sort((a, b) => b.delta - a.delta).slice(0, 8))
  console.log(`    • ${r.id}: ${r.delta > 0 ? "+" : ""}${r.delta.toFixed(2)} จุด`);
