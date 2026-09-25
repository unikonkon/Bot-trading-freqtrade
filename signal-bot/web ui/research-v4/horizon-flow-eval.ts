/**
 * วัดผล Horizon Flow v4 ทั้ง 3 รหัส ด้วยวิธีเดียวกับงานวิจัย v3
 *   • BTCUSDT 5m / 15m / 30m แบ่ง train (8 เดือนแรก) / test (4 เดือนท้าย) ที่ SPLIT_AT
 *   • ข้ามเหรียญ ETH / SOL / BNB / XRP ที่ 15m / 30m (ไม่เคยใช้เลือกค่าใด ๆ)
 *   • ต้นทุน futures taker: fee 0.05% + slippage 0.03% ต่อขา + funding 0.01% ต่อ 8 ชม.
 *   • รายงาน "gross" (ไม่หักต้นทุน) คู่กัน เพื่อแยกว่าขาดทุนมาจากไม่มี edge หรือจากค่าธรรมเนียม
 * ไม่มีการปรับค่าใด ๆ ในสคริปต์นี้ ทุกรหัสใช้ค่าตั้งต้นของทะเบียน
 *
 * รัน: npx tsx "signal-bot/web ui/research-v4/horizon-flow-eval.ts"
 */
import fs from "node:fs";
import path from "node:path";
import type { KlineData } from "../../../lib/types/kline";
import { computeV3 } from "../../../lib/indicators-v3";
import { V4_STRATEGY_IDS, type HorizonFlowV4Result } from "../../../lib/indicators-v4-inYutube";
import { simulateExposure, type Simulation } from "../engine";
import { load, split, SPLIT_AT, f2 } from "../research-v3/lib";

const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const CROSS_DIR = "data-test/crosscoin";
const CROSS = ["ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

function sim(k: KlineData[], start: number, id: (typeof V4_STRATEGY_IDS)[number], gross = false) {
  const r = computeV3(id, k, {}, start) as HorizonFlowV4Result;
  const s = simulateExposure(k, r.exposure, start, gross ? 0 : FEE, gross ? 0 : SLIP, gross ? 0 : FUNDING,
    "next_open", { price: r.exitFill, reason: r.reason });
  // R ต่อไม้ (ก่อนต้นทุน) = กำไร % ÷ ระยะเสี่ยง % ของไม้นั้น
  const Rs = s.trades.map(t => t.pnlPct / (r.riskPct![t.entryIdx] ?? NaN)).filter(Number.isFinite);
  return { s, avgR: Rs.length ? Rs.reduce((a, b) => a + b, 0) / Rs.length : 0 };
}
const row = (s: Simulation) =>
  `${String(s.totalTrades).padStart(4)} ไม้  win ${f2(s.winRate, 0).padStart(3)}%  ` +
  `ret ${f2(s.returnPct).padStart(7)}%  pf ${s.profitFactor == null ? " inf" : f2(s.profitFactor).padStart(4)}  dd ${f2(s.maxDrawdownPct).padStart(6)}%`;

console.log(`ต้นทุน: fee ${FEE}% + slip ${SLIP}% ต่อขา, funding ${FUNDING}%/8ชม. · split ${new Date(SPLIT_AT).toISOString().slice(0, 10)}\n`);
console.log("══ BTCUSDT ══ (net = หักต้นทุน · gross = ไม่หัก)");
for (const tf of ["5m", "15m", "30m"]) {
  const all = load(tf);
  const { train, test } = split(all);
  for (const id of V4_STRATEGY_IDS) {
    for (const [name, w] of [["train", train], ["test ", test]] as const) {
      const net = sim(w.k, w.start, id), gross = sim(w.k, w.start, id, true);
      console.log(`${tf.padEnd(3)} ${id.padEnd(23)} ${name} net ${row(net.s)} | gross ret ${f2(gross.s.returnPct).padStart(7)}% avgR ${f2(gross.avgR).padStart(5)}`);
    }
  }
  console.log("");
}

console.log("══ ข้ามเหรียญ (net, ทั้งสองช่วง) ══");
for (const tf of ["15m", "30m"]) {
  for (const id of V4_STRATEGY_IDS) {
    const cells: string[] = [];
    let positive = 0, total = 0;
    for (const sym of CROSS) {
      const k = fs.readFileSync(path.join(CROSS_DIR, `${sym}-${tf}.jsonl`), "utf8").trim().split("\n").map(l => JSON.parse(l) as KlineData);
      const cut = k.findIndex(b => b.openTime >= SPLIT_AT);
      const tr = sim(k.slice(0, cut), 400, id).s, te = sim(k, cut, id).s;
      positive += (tr.returnPct > 0 ? 1 : 0) + (te.returnPct > 0 ? 1 : 0); total += 2;
      cells.push(`${sym.replace("USDT", "")} ${f2(tr.returnPct, 1)}/${f2(te.returnPct, 1)}`);
    }
    console.log(`${tf.padEnd(3)} ${id.padEnd(23)} บวก ${positive}/${total} ช่อง · ${cells.join("  ")}`);
  }
}
