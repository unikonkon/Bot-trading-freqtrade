/**
 * ผลของกลยุทธ์ที่ลงทะเบียนจริงทั้งสามรหัส ผ่านเส้นทางโค้ดเดียวกับที่เว็บใช้
 * จุดประสงค์ของการมีสามรหัส: เทียบในรอบเดียวว่าฝั่งไหนสร้างผลตอบแทน
 * และตรวจว่าผลบวกไม่ได้มาจากอคติฝั่งใดฝั่งหนึ่งเพียงอย่างเดียว
 */
import fs from "node:fs";
import path from "node:path";
import { load, run, f2, tstat, SPLIT_AT } from "./lib";
import { computeV3, V3_STRATEGY_IDS, V3_REGISTRY } from "../../../lib/indicators-v3";
import type { KlineData } from "../../../lib/types/kline";

const ALT = process.argv[2];
const FEE = 0.05, SLIP = 0.03;
const LABEL: Record<string, string> = { orderflow_v3: "สองทาง", orderflow_v3_long: "ซื้อ  ", orderflow_v3_short: "ขาย  " };

function report(name: string, k: KlineData[], warmBars: number) {
  const cut = k.findIndex(b => b.openTime >= SPLIT_AT);
  console.log(`\n##### ${name}`);
  const curves: Record<string, number[]> = {};
  for (const id of V3_STRATEGY_IDS) {
    const parts: string[] = [];
    for (const [label, from, to] of [["ก่อน", warmBars, cut], ["หลัง", cut, k.length], ["ทั้งชุด", warmBars, k.length]] as const) {
      if (from >= to) { parts.push(`${label} ข้อมูลไม่พอ`); continue; }
      const win = k.slice(0, to);
      const s = run(win, computeV3(id, win, {}, from).exposure, from, FEE, SLIP, 0.01);
      const t = tstat(s.trades.map(v => v.pnlPct));
      parts.push(`${label} ${f2(s.returnPct).padStart(7)}% (n${String(s.totalTrades).padStart(3)} pf ${f2(s.profitFactor ?? 99)} dd ${f2(s.maxDrawdownPct).padStart(5)}% t=${f2(t.t, 2).padStart(5)})`);
      if (label === "หลัง") curves[id] = s.equity;
    }
    console.log(`  ${LABEL[id] ?? id}  ${parts.join(" · ")}`);
  }
  return curves;
}
for (const tf of ["15m", "30m"]) {
  const k = load(tf);
  const tfm = (k[1].openTime - k[0].openTime) / 60000;
  report(`BTCUSDT-${tf} (ใช้เลือกค่า) · B&H ${f2((+k.at(-1)!.close / +k[Math.round((125 * 1440) / tfm)].close - 1) * 100)}%`, k, Math.round((125 * 1440) / tfm));
}
if (ALT && fs.existsSync(ALT)) {
  for (const tf of ["15m", "30m"]) {
    const files = fs.readdirSync(ALT).filter(f => f.endsWith(`-${tf}.jsonl`)).sort();
    const perId: Record<string, number[][]> = {};
    for (const file of files) {
      const k = fs.readFileSync(path.join(ALT, file), "utf8").trim().split("\n").map(l => JSON.parse(l) as KlineData);
      const tfm = (k[1].openTime - k[0].openTime) / 60000;
      const curves = report(`${file.replace(".jsonl", "")} (ไม่เคยใช้เลือกค่า)`, k, Math.round((125 * 1440) / tfm));
      for (const [id, eq] of Object.entries(curves)) (perId[id] ??= []).push(eq);
    }
    console.log(`\n  >>> พอร์ตแบ่งทุนเท่ากัน ${files.length} เหรียญ ${tf} ช่วงหลัง 17 พ.ค.`);
    for (const id of V3_STRATEGY_IDS) {
      const cs = perId[id] ?? [];
      if (!cs.length) continue;
      const len = Math.min(...cs.map(c => c.length));
      const blended: number[] = [];
      for (let i = 0; i < len; i++) blended.push(cs.reduce((s, c) => s + c[i], 0) / cs.length);
      let peak = 0, dd = 0;
      for (const v of blended) { peak = Math.max(peak, v); dd = Math.max(dd, peak - v); }
      console.log(`      ${LABEL[id] ?? id}  ${f2(blended.at(-1) ?? 0).padStart(7)}% · dd ${f2(dd)}%`);
    }
  }
}
