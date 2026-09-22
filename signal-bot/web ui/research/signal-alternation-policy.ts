/**
 * สองคำถามที่ต้องตอบก่อนแก้โค้ด
 *   A) สัญญาณที่ "ซ้ำฝั่ง" ของ v3 เป็นคู่ปิด→เปิด (ถูกต้องตามดีไซน์สองทาง) หรือเป็นการเปิดซ้ำ (บั๊ก)
 *   B) เมื่อบังคับสลับฝั่ง ควรเก็บสัญญาณ "ตัวแรก" หรือ "ตัวสุดท้าย" ของชุดที่ซ้ำกัน
 *      ข้อนี้เปลี่ยนจังหวะเข้าจริง จึงต้องเลือกจาก train แล้วรายงาน test ครั้งเดียว
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
const START = 1000, FEE = 0.1, SLIP = 0.05;
const SPLIT_AT = Date.UTC(2026, 4, 17);
const CUT = k.findIndex((b) => b.openTime >= SPLIT_AT);
const side = (s: SignalAction) => (s === "BUY" || s === "COVER" ? 1 : s === "SELL" || s === "SHORT" ? -1 : 0);
const OPEN = new Set<SignalAction>(["BUY", "SHORT"]);

// ══ A) v3 ซ้ำฝั่งด้วยเหตุผลอะไร ═════════════════════════════════
console.log(`# A. สัญญาณซ้ำฝั่งของ v3 เป็นคู่แบบไหน (${TF})\n`);
console.log("| กลยุทธ์ | ซ้ำฝั่งทั้งหมด | คู่ ปิด→เปิด (ถูกตามดีไซน์) | คู่ เปิด→เปิด (เป็นบั๊ก) |");
console.log("|---|---:|---:|---:|");
for (const cfg of STRATEGIES.filter((s) => s.version === 3)) {
  const signals = computeSignals(k, cfg.id as StrategyId, cfg.params as Record<string, number>, { confirmedPivots: true, startIndex: START });
  const seq = signals.slice(START).filter((s) => s !== "HOLD");
  let repeat = 0, closeOpen = 0, openOpen = 0;
  for (let i = 1; i < seq.length; i++) {
    if (side(seq[i]) !== side(seq[i - 1])) continue;
    repeat++;
    if (!OPEN.has(seq[i - 1]) && OPEN.has(seq[i])) closeOpen++;
    else if (OPEN.has(seq[i - 1]) && OPEN.has(seq[i])) openOpen++;
  }
  console.log(`| ${cfg.id} | ${repeat} | ${closeOpen} | ${openOpen} |`);
}

// ══ B) นโยบายเลือกสัญญาณในชุดที่ซ้ำฝั่ง ═════════════════════════
/**
 * ทางเลือกที่เป็นไปได้จริงมีสองแบบเท่านั้น เพราะต้องตัดสินใจได้ ณ แท่งที่ปิดแล้ว
 *
 *   first   — ลงมือที่แท่งแรกของชุด แล้วเมินสัญญาณซ้ำฝั่งที่เหลือ (เป็นการกรองล้วน ๆ)
 *   confirm — รอจนเงื่อนไขหยุดเป็นจริง แล้วลงมือที่แท่งถัดจากนั้น (เปลี่ยนจังหวะเข้าจริง)
 *
 * ที่ **ไม่** อยู่ในรายการคือ "เก็บสัญญาณตัวสุดท้ายของชุด" ซึ่งฟังดูสมเหตุสมผล
 * แต่ทำไม่ได้: จะรู้ว่าแท่งไหนเป็นตัวสุดท้ายของชุดก็ต่อเมื่อชุดจบไปแล้ว
 * การเขียนสัญญาณย้อนกลับไปที่แท่งนั้นคือการมองอนาคต ผลที่ได้จะดูดีแบบหลอก ๆ
 * ส่วน confirm คือรุ่นที่เป็นเหตุเป็นผลตามเวลาของแนวคิดเดียวกัน
 */
type Policy = "first" | "confirm";
function alternate(signals: SignalAction[], policy: Policy): SignalAction[] {
  const out: SignalAction[] = signals.map(() => "HOLD");
  let last = 0;      // ฝั่งของสัญญาณที่ปล่อยออกไปล่าสุด
  let armed = 0;     // ฝั่งที่กำลังรอให้เงื่อนไขหยุด (ใช้เฉพาะ confirm)
  for (let i = 0; i < signals.length; i++) {
    const s = side(signals[i]);
    if (policy === "confirm") {
      if (s !== 0 && s !== last) { armed = s; continue; }   // เงื่อนไขยังเป็นจริง รอก่อน
      if (armed !== 0 && s !== armed) {
        // เงื่อนไขหยุดแล้ว ลงมือที่แท่งนี้ด้วยสัญญาณของฝั่งที่รออยู่
        out[i] = armed === 1 ? "BUY" : "SELL";
        last = armed; armed = 0;
      }
      continue;
    }
    if (s === 0 || s === last) continue;
    if (last === 0 && s === -1) continue;   // ขายก่อนซื้อครั้งแรกบนกลยุทธ์ Spot
    out[i] = signals[i];
    last = s;
  }
  return out;
}

console.log(`\n# B. กรองอย่างเดียว (first) เทียบกับรอให้เงื่อนไขหยุด (confirm) — เฉพาะกลยุทธ์ทางเดียวที่ละเมิดจริง\n`);
console.log("| กลยุทธ์ | train เดิม | train first | train confirm | test เดิม | test first | test confirm |");
console.log("|---|---:|---:|---:|---:|---:|---:|");
const score = { first: [] as number[], confirm: [] as number[], base: [] as number[] };
const testScore = { first: [] as number[], confirm: [] as number[], base: [] as number[] };
for (const cfg of STRATEGIES) {
  if (cfg.version === 3) continue;
  const signals = computeSignals(k, cfg.id as StrategyId, cfg.params as Record<string, number>, { confirmedPivots: true, startIndex: START });
  const seq = signals.slice(START).filter((s) => s !== "HOLD");
  let repeat = 0;
  for (let i = 1; i < seq.length; i++) if (side(seq[i]) === side(seq[i - 1])) repeat++;
  if (!repeat) continue;
  const net = (sig: SignalAction[], from: number, to: number) =>
    simulateNextOpen(k.slice(0, to), sig.slice(0, to), from, FEE, SLIP).returnPct;
  const f = alternate(signals, "first"), c = alternate(signals, "confirm");
  const cells = [
    net(signals, START, CUT), net(f, START, CUT), net(c, START, CUT),
    net(signals, CUT, k.length), net(f, CUT, k.length), net(c, CUT, k.length),
  ];
  score.base.push(cells[0]); score.first.push(cells[1]); score.confirm.push(cells[2]);
  testScore.base.push(cells[3]); testScore.first.push(cells[4]); testScore.confirm.push(cells[5]);
  console.log(`| ${cfg.id} | ${cells.map((x) => x.toFixed(2) + "%").join(" | ")} |`);
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const line = (label: string, o: Record<string, number[]>) =>
  `**มัธยฐาน ${label}**: เดิม ${median(o.base).toFixed(2)}% · first ${median(o.first).toFixed(2)}% · confirm ${median(o.confirm).toFixed(2)}%`;
console.log(`\n${line("train (ใช้เลือก)", score)}`);
console.log(`${line("test (รายงานอย่างเดียว)", testScore)}`);
console.log(`\nดีขึ้นกว่าเดิมบน train: first ${score.first.filter((x, i) => x > score.base[i]).length}/${score.base.length} · confirm ${score.confirm.filter((x, i) => x > score.base[i]).length}/${score.base.length}`);
