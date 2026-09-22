/**
 * วัดตระกูล FlowGate ก่อนลงทะเบียน
 *
 * ═══ เกณฑ์ตัดสิน ประกาศไว้ก่อนเห็นผล ═══════════════════════════════════
 *   1) บน BTCUSDT ต้องเป็นบวก **ทั้ง train และ test** ทั้ง 15m และ 30m
 *   2) ต้องชนะเส้นฐาน "ถือฝั่งเดียวตลอดเวลา" ในช่วง test (กันการได้กำไรเพราะเอียงตามตลาด)
 *   3) บนเหรียญที่ไม่เคยถูกใช้เลือกค่าเลย (ETH/SOL/BNB/XRP) พอร์ตแบ่งทุนเท่ากัน
 *      ต้องเป็นบวกทั้งสองช่วงเวลา ทั้ง 15m และ 30m ทุกค่า flowBand (6 จาก 6 ช่อง)
 * รหัสที่ไม่ครบทุกข้อจะไม่ถูกลงทะเบียน
 *
 *   npx tsx "signal-bot/web ui/research-v3/flowgate-eval.ts" [โฟลเดอร์เหรียญอื่น]
 */
import fs from "node:fs";
import path from "node:path";
import { load, split, run, f2, SPLIT_AT } from "./lib";
import { flowGateV3, orderFlowV3, type FlowGateTrigger } from "../../../lib/indicators-v3";
import type { KlineData } from "../../../lib/types/kline";

const COIN_DIR = process.argv[2] ?? "data-test/crosscoin";
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const TRIGGERS: FlowGateTrigger[] = ["trendlines", "ema", "emaFiltered", "utbot", "confluence"];
const BANDS = [0.005, 0.01, 0.02];

console.log("# FlowGate V3 — วัดก่อนลงทะเบียน (BTCUSDT, futures taker)\n");

// ══ 1) BTCUSDT ═══════════════════════════════════════════════
console.log("## 1. ผลหลังหักต้นทุนบน BTCUSDT\n");
console.log("| tf | กลยุทธ์ | train | test | เทรด train/test | ชนะ test | dd test |");
console.log("|---|---|---:|---:|---:|---:|---:|");
const stage1: Record<string, boolean> = {};
for (const tf of ["15m", "30m"]) {
  const { train, test } = split(load(tf));
  const row = (name: string, exp: (w: typeof train) => number[]) => {
    const a = run(train.k, exp(train), train.start, FEE, SLIP, FUNDING);
    const b = run(test.k, exp(test), test.start, FEE, SLIP, FUNDING);
    console.log(`| ${tf} | ${name} | ${f2(a.returnPct)}% | ${f2(b.returnPct)}% | ${a.totalTrades}/${b.totalTrades} | ${f2(b.winRate, 0)}% | ${f2(b.maxDrawdownPct)}% |`);
    return { a: a.returnPct, b: b.returnPct };
  };
  for (const t of TRIGGERS) {
    const r = row(`FlowGate ${t}`, (w) => flowGateV3(w.k, t, {}, w.start).exposure);
    stage1[`${tf}|${t}`] = r.a > 0 && r.b > 0;
  }
  row("เส้นฐาน OrderFlow V3", (w) => orderFlowV3(w.k, {}, w.start).exposure);
  row("เส้นฐาน ขายตลอดเวลา", (w) => w.k.map(() => -1));
  row("เส้นฐาน ซื้อตลอดเวลา", (w) => w.k.map(() => 1));
}
const passed = TRIGGERS.filter((t) => stage1[`15m|${t}`] && stage1[`30m|${t}`]);
console.log(`\n**ผ่านข้อ 1 (บวกทั้ง train และ test ทั้งสอง timeframe)**: ${passed.length ? passed.join(", ") : "ไม่มี"}`);

// ══ 2) ที่ราบของ flowBand ════════════════════════════════════
console.log("\n## 2. ที่ราบของเกณฑ์แรงซื้อขายสุทธิ (train/test net%, ✅ = บวกทั้งสองช่วง)\n");
console.log("| tf | ตัวเร็ว | " + BANDS.map((b) => `band ${b}`).join(" | ") + " |");
console.log("|---|---|" + BANDS.map(() => "---").join("|") + "|");
for (const tf of ["15m", "30m"]) {
  const { train, test } = split(load(tf));
  for (const t of TRIGGERS) {
    const cells = BANDS.map((flowBand) => {
      const a = run(train.k, flowGateV3(train.k, t, { flowBand }, train.start).exposure, train.start, FEE, SLIP, FUNDING);
      const b = run(test.k, flowGateV3(test.k, t, { flowBand }, test.start).exposure, test.start, FEE, SLIP, FUNDING);
      return `${a.returnPct > 0 && b.returnPct > 0 ? "✅ " : ""}${f2(a.returnPct, 0)}/${f2(b.returnPct, 0)}`;
    });
    console.log(`| ${tf} | ${t} | ${cells.join(" | ")} |`);
  }
}

// ══ 3) ตรวจข้ามเหรียญ ════════════════════════════════════════
if (!fs.existsSync(COIN_DIR)) {
  console.log(`\n(ข้าม: ยังไม่มีโฟลเดอร์ ${COIN_DIR} — รัน scripts/download-crosscoin.ts ก่อน)`);
  process.exit(0);
}
console.log("\n## 3. ตรวจข้ามเหรียญ ETH/SOL/BNB/XRP — ค่าทุกตัวมาจาก BTCUSDT เท่านั้น\n");
const cells: Record<string, boolean[]> = {};
for (const tf of ["15m", "30m"]) {
  const files = fs.readdirSync(COIN_DIR).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort();
  console.log(`\n### ${tf}\n`);
  console.log("| ตัวเร็ว | band | " + files.map((f) => f.split("-")[0].replace("USDT", "")).join(" | ") + " | **พอร์ต ก่อน** | **พอร์ต หลัง** |");
  console.log("|---|---|" + files.map(() => "---:").join("|") + "|---:|---:|");
  for (const t of passed.length ? passed : TRIGGERS) {
    for (const flowBand of BANDS) {
      const per: string[] = [];
      const curves: { before: number[]; after: number[] }[] = [];
      for (const file of files) {
        const k = fs.readFileSync(path.join(COIN_DIR, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
        const warm = k.findIndex((b) => b.openTime >= EVAL_FROM);
        const cut = k.findIndex((b) => b.openTime >= SPLIT_AT);
        const trainK = k.slice(0, cut);
        const a = run(trainK, flowGateV3(trainK, t, { flowBand }, warm).exposure, warm, FEE, SLIP, FUNDING);
        const b = run(k, flowGateV3(k, t, { flowBand }, cut).exposure, cut, FEE, SLIP, FUNDING);
        per.push(`${f2(a.returnPct, 0)}/${f2(b.returnPct, 0)}`);
        curves.push({ before: a.equity, after: b.equity });
      }
      const blend = (key: "before" | "after") => {
        const len = Math.min(...curves.map((x) => x[key].length));
        let last = 0;
        for (let i = 0; i < len; i++) last = curves.reduce((s, x) => s + x[key][i], 0) / curves.length;
        return last;
      };
      const before = blend("before"), after = blend("after");
      (cells[t] ??= []).push(before > 0 && after > 0);
      console.log(`| ${t} | ${flowBand} | ${per.join(" | ")} | **${f2(before)}%** | **${f2(after)}%** |`);
    }
  }
}
console.log("\n### คำตัดสินตามเกณฑ์ที่ประกาศไว้ก่อนเห็นผล\n");
for (const t of Object.keys(cells))
  console.log(`- \`${t}\` — ข้อ 1: ${stage1[`15m|${t}`] && stage1[`30m|${t}`] ? "ผ่าน" : "ไม่ผ่าน"} · ข้อ 3: ${cells[t].filter(Boolean).length}/${cells[t].length} ช่อง`);
