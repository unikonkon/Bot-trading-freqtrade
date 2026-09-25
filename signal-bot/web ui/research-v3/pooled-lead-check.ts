/**
 * ตรวจ lead ที่ `frequent-pooled.ts` ทิ้งไว้ **ครั้งเดียว** — 4 / 40 / 0.01 / 0
 *
 * ที่มา: บนพอร์ต 5 เหรียญช่วงก่อน 17 พ.ค. (ช่วงที่ใช้เลือก) ชุดนี้ดีที่สุดในย่าน 0.25–0.5 สัญญาณ/วัน
 * ได้ +50.6% / +51.2% (15m / 30m) เทียบกับ `orderflow_v3` +13.5% / +13.6% ที่ความถี่ใกล้กัน
 * ยังไม่เคยเปิดดูช่วงหลัง 17 พ.ค. เลย ไฟล์นี้เปิดดูครั้งเดียวตามเกณฑ์ที่เขียนไว้ก่อนรัน
 *
 * ═══ เกณฑ์ ประกาศไว้ก่อนเห็นผล (ช่วงหลัง 17 พ.ค. · พอร์ต BTC/ETH/SOL/BNB/XRP แบ่งทุนเท่ากัน) ═══
 *   1) พอร์ตเป็นบวก 15m/30m × band 0.0075 / 0.01 / 0.015 (6/6)
 *   2) ชนะ `orderflow_v3` ทั้ง 15m และ 30m ที่ band 0.01 — lead นี้มีเหตุผลก็ต่อเมื่อกำไรมากกว่าของเดิม
 *   3) ชนะเส้นฐาน "ซื้อตลอด" และ "ขายตลอด" ทั้ง 15m และ 30m
 * ไม่ครบทุกข้อ = ไม่ลงทะเบียน และไม่ปรับค่าแล้ววัดซ้ำบนช่วงเดิม
 *
 *   npx tsx "signal-bot/web ui/research-v3/pooled-lead-check.ts" <dir-btc> [data-test/crosscoin]
 */
import fs from "node:fs";
import path from "node:path";
import { run, f2, SPLIT_AT } from "./lib";
import type { KlineData } from "../../../lib/types/kline";
import { orderFlowV3 } from "../../../lib/indicators-v3";

const DIRS = [process.argv[2], process.argv[3] ?? "data-test/crosscoin"];
if (!DIRS[0] || !fs.existsSync(DIRS[0])) { console.log("ต้องระบุโฟลเดอร์ BTCUSDT ที่เริ่ม 1 พ.ค. 2025"); process.exit(1); }
const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
const LEAD = { flowLookbackDays: 4, flowDebiasDays: 40, flowBand: 0.01, flowExitMult: 0 };
const BANDS = [0.0075, 0.01, 0.015];

function coins(tf: string) {
  return DIRS.flatMap((dir) => fs.readdirSync(dir).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort().map((file) => {
    const k = fs.readFileSync(path.join(dir, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
    const cut = k.findIndex((b) => b.openTime >= SPLIT_AT);
    return { name: file.split("-")[0].replace("USDT", ""), k, cut, from: k.findIndex((b) => b.openTime >= EVAL_FROM) };
  }));
}
function portfolio(cs: ReturnType<typeof coins>, o: Record<string, number> | number, after: boolean) {
  const per = cs.map((c) => {
    const k = after ? c.k : c.k.slice(0, c.cut), start = after ? c.cut : c.from;
    const exposure = typeof o === "number" ? k.map(() => o) : orderFlowV3(k, o, start).exposure;
    return { name: c.name, s: run(k, exposure, start, FEE, SLIP, FUNDING) };
  });
  const len = Math.min(...per.map((x) => x.s.equity.length));
  return { ret: per.reduce((a, x) => a + x.s.equity[len - 1], 0) / per.length, per };
}

console.log("# ตรวจ lead 4 / 40 / 0.01 / 0 ครั้งเดียว — พอร์ต 5 เหรียญ\n");
console.log("| tf | band | ก่อน 17 พ.ค. (ช่วงเลือก) | **หลัง 17 พ.ค.** | รายเหรียญ หลัง | orderflow_v3 หลัง | ซื้อตลอด | ขายตลอด |");
console.log("|---|---|---:|---:|---|---:|---:|---:|");
let ok = 0, beatBase = true, beatFlat = true;
for (const tf of ["15m", "30m"]) {
  const cs = coins(tf);
  const base = portfolio(cs, {}, true).ret, long = portfolio(cs, 1, true).ret, short = portfolio(cs, -1, true).ret;
  for (const flowBand of BANDS) {
    const before = portfolio(cs, { ...LEAD, flowBand }, false).ret;
    const after = portfolio(cs, { ...LEAD, flowBand }, true);
    if (after.ret > 0) ok++;
    if (flowBand === LEAD.flowBand) {
      if (after.ret <= base) beatBase = false;
      if (after.ret <= long || after.ret <= short) beatFlat = false;
    }
    const per = after.per.map((x) => `${x.name} ${f2(x.s.returnPct, 0)}`).join(" · ");
    console.log(`| ${tf} | ${flowBand}${flowBand === LEAD.flowBand ? " ◀" : ""} | ${f2(before)}% | **${f2(after.ret)}%** | ${per} | ${f2(base)}% | ${f2(long)}% | ${f2(short)}% |`);
  }
}
console.log("\n### คำตัดสิน\n");
console.log(`- ด่าน 1 พอร์ตบวก ${ok}/6: ${ok === 6 ? "ผ่าน" : "ไม่ผ่าน"}`);
console.log(`- ด่าน 2 ชนะ orderflow_v3 ทั้ง 15m และ 30m: ${beatBase ? "ผ่าน" : "ไม่ผ่าน"}`);
console.log(`- ด่าน 3 ชนะเส้นฐานถือฝั่งเดียว: ${beatFlat ? "ผ่าน" : "ไม่ผ่าน"}`);
console.log(`\n**${ok === 6 && beatBase && beatFlat ? "ผ่านครบ → ลงทะเบียนได้" : "ไม่ผ่าน → ไม่ลงทะเบียน"}**`);
