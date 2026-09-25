/**
 * "ยิ่งแท่งเยอะ ยิ่งเทรดเยอะ" — วัดว่าถ้าหน้าต่างของกลยุทธ์นับเป็น **แท่ง** แทนวัน
 * จำนวนไม้จะโตตามจำนวนแท่งจริงไหม และกำไรโตตามไหม
 *
 * ตระกูล OrderFlow / FlowGate นับหน้าต่างเป็นวัน ความถี่จึงเท่ากันทุก timeframe
 * ไฟล์นี้ตรึงหน้าต่างเป็นจำนวนแท่งที่ค่าตั้งต้นของ 30m (สะสม 240 แท่ง · ลบอคติ 5,760 แท่ง)
 * แล้วใช้ **จำนวนแท่งเดียวกัน** ทุก timeframe — ที่ 30m ผลจึงเท่ากับรหัสที่ลงทะเบียนอยู่ทุกตัวเลข
 * ส่วน Horizon Flow v4 นับเป็นแท่งอยู่แล้ว (EMA 100 แท่ง) จึงวัดตามค่าตั้งต้นเลย
 *
 * แต่ละแถวแยกสามอย่างที่ต้องแยกให้ออก
 *   gross/ไม้   กำไรเฉลี่ยต่อไม้ **ก่อน** ต้นทุน = ความได้เปรียบของสัญญาณจริง ๆ
 *   net taker   หักต้นทุน futures taker (0.05% + slip 0.03% ต่อขา = 0.16% ไป–กลับ)
 *   net maker   หักต้นทุนถ้าเข้า–ออกด้วย limit order (0.02% ต่อขา ไม่มี slip = 0.04% ไป–กลับ)
 * ถ้า gross/ไม้ ต่ำกว่าต้นทุนไป–กลับ เพิ่มจำนวนไม้เท่าไรก็ขาดทุนเร็วขึ้นเท่านั้น
 *
 *   NODE_OPTIONS=--max-old-space-size=8192 npx tsx "signal-bot/web ui/research-v3/bar-scaling.ts" [ไฟล์ 1s.jsonl]
 */
import fs from "node:fs";
import { load, split, f2 } from "./lib";
import type { KlineData } from "../../../lib/types/kline";
import { computeV3, type V3StrategyId } from "../../../lib/indicators-v3";
import { simulateExposure } from "../engine";

const MIN: Record<string, number> = { "1s": 1 / 60, "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30 };
const COSTS = {
  gross: { fee: 0, slip: 0, funding: 0 },
  taker: { fee: 0.05, slip: 0.03, funding: 0.01 },
  maker: { fee: 0.02, slip: 0, funding: 0.01 },
};
/** หน้าต่างของค่าตั้งต้นที่ 30m คิดเป็นแท่ง: 5 วัน = 240 แท่ง · 120 วัน = 5,760 แท่ง */
const ANCHOR = { lookbackBars: 240, debiasBars: 5760 };
const FLOW_IDS: V3StrategyId[] = ["orderflow_v3", "orderflow_v3_zero", "flowgate_utbot_v3"];
const V4_IDS: V3StrategyId[] = ["horizon_flow_v4", "horizon_flow_v4_strict", "horizon_flow_v4_trail"];

/** หน้าต่างแบบนับแท่ง — ส่งตรงทุกครั้ง ไม่พึ่งค่าตั้งต้นของทะเบียน เพื่อให้ผลของไฟล์นี้ไม่เปลี่ยนตามค่าตั้งต้น */
const barParams = (id: V3StrategyId, _tf: string): Record<string, number> =>
  FLOW_IDS.includes(id) ? { flowLookbackBars: ANCHOR.lookbackBars, flowDebiasBars: ANCHOR.debiasBars } : {};

function measure(id: V3StrategyId, k: KlineData[], start: number, tf: string) {
  const r = computeV3(id, k, barParams(id, tf), start);
  const levels = r.exitFill ? { price: r.exitFill, reason: r.reason } : undefined;
  const run = (c: (typeof COSTS)[keyof typeof COSTS]) =>
    simulateExposure(k, r.exposure, start, c.fee, c.slip, c.funding, "next_open", levels);
  const g = run(COSTS.gross), t = run(COSTS.taker), m = run(COSTS.maker);
  const days = ((k.length - start) * MIN[tf]) / 1440;
  const perTrade = g.trades.length ? g.trades.reduce((a, x) => a + x.pnlPct, 0) / g.trades.length : 0;
  return { trades: g.totalTrades, perDay: g.totalTrades / days, perTrade, gross: g.returnPct, taker: t.returnPct, maker: m.returnPct };
}

const header = "| กลยุทธ์ | tf | ช่วง | ไม้ | ไม้/วัน | gross/ไม้ | gross | **net taker** | net maker |";
const sep = "|---|---|---|---:|---:|---:|---:|---:|---:|";
const line = (id: string, tf: string, label: string, x: ReturnType<typeof measure>) =>
  `| ${id} | ${tf} | ${label} | ${x.trades} | ${f2(x.perDay, 2)} | ${f2(x.perTrade, 3)}% | ${f2(x.gross, 1)}% | **${f2(x.taker, 1)}%** | ${f2(x.maker, 1)}% |`;

console.log("# หน้าต่างนับเป็นแท่ง — จำนวนไม้โตตามจำนวนแท่ง แล้วกำไรโตตามไหม (BTCUSDT)\n");
console.log(`ต้นทุนไป–กลับ: taker 0.16% · maker 0.04% · ตระกูล flow ใช้ ${ANCHOR.lookbackBars}/${ANCHOR.debiasBars} แท่งทุก timeframe\n`);
console.log(header);
console.log(sep);
/** ตั้ง ONLY_1S=1 เพื่อรันเฉพาะส่วน 1s (ส่วนหลักใช้เวลาหลายนาที) */
const TFS = process.env.ONLY_1S ? [] : ["1m", "3m", "5m", "15m", "30m"];
for (const id of TFS.length ? [...FLOW_IDS, ...V4_IDS] : []) {
  for (const tf of TFS) {
    const all = load(tf);
    const { train, test } = split(all);
    // flow แบบนับแท่งต้องมีแท่งอุ่นเครื่องพอ: ช่วง train เริ่มนับเมื่อชั้นทิศทางพร้อม
    const warm = FLOW_IDS.includes(id) ? Math.max(train.start, ANCHOR.lookbackBars + ANCHOR.debiasBars) : train.start;
    if (warm >= train.k.length) { console.log(`| ${id} | ${tf} | train | — | ข้อมูลไม่พอ | | | | |`); continue; }
    console.log(line(id, tf, "train", measure(id, train.k, warm, tf)));
    console.log(line(id, tf, "test", measure(id, test.k, test.start, tf)));
  }
}

// ══ 1s: ข้อมูลไม่กี่วัน ใช้ดูสเกลของความถี่และ gross ต่อไม้เท่านั้น ไม่ใช่หลักฐานกำไร ══
const oneSec = process.argv[2];
if (oneSec && fs.existsSync(oneSec)) {
  const k = fs.readFileSync(oneSec, "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
  const days = (k.length / 86400).toFixed(1);
  console.log(`\n## 1s · ${k.length.toLocaleString()} แท่ง (${days} วัน) — เล็กเกินกว่าจะสรุปเรื่องกำไร ดูแค่สเกล\n`);
  console.log(header);
  console.log(sep);
  for (const id of [...FLOW_IDS, ...V4_IDS]) {
    const warm = FLOW_IDS.includes(id) ? ANCHOR.lookbackBars + ANCHOR.debiasBars : 1000;
    console.log(line(id, "1s", "ทั้งหมด", measure(id, k, warm, "1s")));
  }
}
