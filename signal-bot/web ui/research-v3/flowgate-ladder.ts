/**
 * ต่อจาก flowgate-transfer.ts — ข้อ B แสดงว่าไม่มีความไม่เข้ากันของสเกลให้แก้
 * (ตัวเร็วยิงถี่เท่ากันทุกเหรียญ) และข้อ C แสดงว่าตัวเร็วไม่ได้เลือกแท่งผิด
 * เหลือผู้ต้องสงสัยตัวสุดท้าย: **กฎการออก**
 *
 * FlowGate ออกเมื่อ bias หลุดออกนอก band (เทียบเท่า flowExitMult = 1)
 * แต่ orderflow_v3_zero ที่ลงทะเบียนไว้ออกที่ศูนย์ (flowExitMult = 0) ซึ่งถูกเลือก
 * จาก train เพราะถือไม้ได้ยาวกว่าและจ่ายค่าธรรมเนียมน้อยกว่า
 *
 * บันไดนี้แยกว่าช่องว่างระหว่าง FlowGate กับ OrderFlow V3 บนเหรียญที่ไม่เคยเห็น
 * มาจาก "กฎการออก" หรือ "ชั้นจังหวะ" — ไต่ทีละขั้นโดยเปลี่ยนทีละอย่างเดียว
 *
 *   npx tsx "signal-bot/web ui/research-v3/flowgate-ladder.ts"
 */
import fs from "node:fs";
import path from "node:path";
import { load, f2, run, SPLIT_AT } from "./lib";
import { flowGateV3, orderFlowV3, type FlowGateTrigger } from "../../../lib/indicators-v3";
import type { KlineData } from "../../../lib/types/kline";

const COIN_DIR = "data-test/crosscoin";
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const BANDS = [0.005, 0.01, 0.02];
const TRIGGERS: FlowGateTrigger[] = ["trendlines", "ema", "utbot", "confluence"];

type W = { k: KlineData[]; start: number };
function coinWindows(tf: string): { name: string; before: W; after: W }[] {
  return fs.readdirSync(COIN_DIR).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort().map((file) => {
    const k = fs.readFileSync(path.join(COIN_DIR, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
    const warm = k.findIndex((b) => b.openTime >= EVAL_FROM);
    const cut = k.findIndex((b) => b.openTime >= SPLIT_AT);
    return { name: file.split("-")[0].replace("USDT", ""), before: { k: k.slice(0, cut), start: warm }, after: { k, start: cut } };
  });
}

/** พอร์ตแบ่งทุนเท่ากันสี่เหรียญ — คืนผลตอบแทนปลายงวดของทั้งสองช่วง */
function portfolio(tf: string, exp: (w: W) => number[]) {
  const cs = coinWindows(tf).map((c) => ({
    before: run(c.before.k, exp(c.before), c.before.start, FEE, SLIP, FUNDING),
    after: run(c.after.k, exp(c.after), c.after.start, FEE, SLIP, FUNDING),
  }));
  const blend = (key: "before" | "after") => {
    const len = Math.min(...cs.map((x) => x[key].equity.length));
    let last = 0;
    for (let i = 0; i < len; i++) last = cs.reduce((s, x) => s + x[key].equity[i], 0) / cs.length;
    return last;
  };
  const trades = (key: "before" | "after") => cs.reduce((s, x) => s + x[key].totalTrades, 0);
  return { before: blend("before"), after: blend("after"), tradesA: trades("before"), tradesB: trades("after") };
}

console.log("# บันไดแยกสาเหตุ — พอร์ต ETH/SOL/BNB/XRP แบ่งทุนเท่ากัน (futures taker)\n");
console.log("เปลี่ยนทีละอย่างเดียวจากล่างขึ้นบน · ก่อน/หลัง 17 พ.ค. · ✅ = บวกทั้งสองช่วง\n");
for (const tf of ["15m", "30m"]) {
  console.log(`\n## ${tf}\n`);
  console.log("| ขั้น | " + BANDS.map((b) => `band ${b}`).join(" | ") + " | เทรดรวม (ทั้ง band 0.01) |");
  console.log("|---|" + BANDS.map(() => "---:").join("|") + "|---:|");
  const row = (name: string, make: (band: number) => (w: W) => number[]) => {
    let t = "";
    const cells = BANDS.map((flowBand) => {
      const r = portfolio(tf, make(flowBand));
      if (flowBand === 0.01) t = `${r.tradesA}/${r.tradesB}`;
      return `${r.before > 0 && r.after > 0 ? "✅ " : ""}${f2(r.before)}/${f2(r.after)}`;
    });
    console.log(`| ${name} | ${cells.join(" | ")} | ${t} |`);
  };
  row("1. OrderFlow ออกที่ศูนย์ (`orderflow_v3_zero`)", (flowBand) => (w) => orderFlowV3(w.k, { flowBand, flowExitMult: 0 }, w.start).exposure);
  row("2. OrderFlow ออกครึ่ง band (`orderflow_v3`)", (flowBand) => (w) => orderFlowV3(w.k, { flowBand, flowExitMult: 0.5 }, w.start).exposure);
  row("3. OrderFlow **ออกที่ band** = กฎการออกของ FlowGate", (flowBand) => (w) => orderFlowV3(w.k, { flowBand, flowExitMult: 1 }, w.start).exposure);
  for (const t of TRIGGERS)
    row(`4. ขั้น 3 + ชั้นจังหวะ \`${t}\``, (flowBand) => (w) => flowGateV3(w.k, t, { flowBand }, w.start).exposure);
}
