/**
 * ยืนยัน `flowgate_utbot_v3` ก่อนลงทะเบียน — กันการเข้าใจผิดสองแบบ
 *
 * แบบที่หนึ่ง **ยอดแหลม**: `flowgate-exit-select.ts` คัดผู้สมัคร 5 ตัวแล้วผ่าน 1 ตัว
 * โอกาสที่ตัวหนึ่งผ่าน 6/6 ด้วยความบังเอิญจึงไม่เล็กพอจะมองข้าม ถ้าเป็นของจริง
 * ช่องข้างเคียงทุกทิศต้องยังเป็นบวก ไม่ใช่แค่ช่องที่เลือก
 *
 * แบบที่สอง **ได้กำไรเพราะเอียงตามตลาด**: ต้องชนะเส้นฐานถือฝั่งเดียวตลอดเวลา
 *
 *   npx tsx "signal-bot/web ui/research-v3/flowgate-confirm.ts"
 */
import fs from "node:fs";
import path from "node:path";
import { load, split, run, f2, SPLIT_AT } from "./lib";
import { flowGateV3 } from "../../../lib/indicators-v3";
import type { KlineData } from "../../../lib/types/kline";

const COIN_DIR = "data-test/crosscoin";
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const TFS = ["15m", "30m"], BANDS = [0.005, 0.01, 0.02];
type W = { k: KlineData[]; start: number };

function coinWindows(tf: string) {
  return fs.readdirSync(COIN_DIR).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort().map((file) => {
    const k = fs.readFileSync(path.join(COIN_DIR, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
    return { name: file.split("-")[0].replace("USDT", ""),
      before: { k: k.slice(0, k.findIndex((b) => b.openTime >= SPLIT_AT)), start: k.findIndex((b) => b.openTime >= EVAL_FROM) } as W,
      after: { k, start: k.findIndex((b) => b.openTime >= SPLIT_AT) } as W };
  });
}
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
  return { before: blend("before"), after: blend("after"), per: cs.map((x, i) => ({ name: coinWindows(tf)[i].name, a: x.before.returnPct, b: x.after.returnPct })) };
}
const grid = (label: string, over: Record<string, number>) => {
  let ok = 0;
  const cells = TFS.flatMap((tf) => BANDS.map((flowBand) => {
    const r = portfolio(tf, (w) => flowGateV3(w.k, "utbot", { flowBand, gateExitMult: 0, ...over }, w.start).exposure);
    const pass = r.before > 0 && r.after > 0;
    if (pass) ok++;
    return `${pass ? "✅ " : ""}${f2(r.before, 1)}/${f2(r.after, 1)}`;
  }));
  console.log(`| ${label} | ${cells.join(" | ")} | **${ok}/6** |`);
  return ok;
};

console.log("# ยืนยัน FlowGate utbot ก่อนลงทะเบียน\n");
console.log("## 1. ช่องข้างเคียงบนพอร์ต 4 เหรียญ — เปลี่ยนทีละค่าจากค่าที่เลือก\n");
console.log("| ค่าที่เปลี่ยน | " + TFS.flatMap((tf) => BANDS.map((b) => `${tf}·${b}`)).join(" | ") + " | ผ่าน |");
console.log("|---|" + TFS.flatMap(() => BANDS.map(() => "---:")).join("|") + "|---|");
grid("**ค่าที่เลือก** (exit 0, ATR 10, key 1)", {});
for (const gateExitMult of [0.5, 0.25, -0.5, -1]) grid(`gateExitMult ${gateExitMult}`, { gateExitMult });
for (const utBotAtrLength of [5, 7, 14, 20]) grid(`utBotAtrLength ${utBotAtrLength}`, { utBotAtrLength });
for (const utBotKeyValue of [0.5, 0.75, 1.5, 2]) grid(`utBotKeyValue ${utBotKeyValue}`, { utBotKeyValue });
for (const flowDebiasDays of [60, 90, 150]) grid(`flowDebiasDays ${flowDebiasDays}`, { flowDebiasDays });

console.log("\n## 2. รายเหรียญที่ค่าตั้งต้น band 0.01 (ก่อน/หลัง)\n");
console.log("| tf | " + coinWindows("15m").map((c) => c.name).join(" | ") + " |");
console.log("|---|" + coinWindows("15m").map(() => "---:").join("|") + "|");
for (const tf of TFS) {
  const r = portfolio(tf, (w) => flowGateV3(w.k, "utbot", { gateExitMult: 0 }, w.start).exposure);
  console.log(`| ${tf} | ${r.per.map((p) => `${f2(p.a, 1)}/${f2(p.b, 1)}`).join(" | ")} |`);
}

console.log("\n## 3. เส้นฐานบน BTCUSDT ช่วง test\n");
console.log("| tf | FlowGate utbot | ซื้อตลอดเวลา | ขายตลอดเวลา |");
console.log("|---|---:|---:|---:|");
for (const tf of TFS) {
  const { test } = split(load(tf));
  const g = run(test.k, flowGateV3(test.k, "utbot", { gateExitMult: 0 }, test.start).exposure, test.start, FEE, SLIP, FUNDING);
  const L = run(test.k, test.k.map(() => 1), test.start, FEE, SLIP, FUNDING);
  const S = run(test.k, test.k.map(() => -1), test.start, FEE, SLIP, FUNDING);
  console.log(`| ${tf} | **${f2(g.returnPct)}%** | ${f2(L.returnPct)}% | ${f2(S.returnPct)}% |`);
}

console.log("\n## 4. ไม่มองอนาคต — ตัดข้อมูลท้ายแล้วค่าที่คำนวณไว้ต้องไม่เปลี่ยน\n");
const k = load("30m");
const full = flowGateV3(k, "utbot", { gateExitMult: 0 }, 1000);
let bad = 0, checked = 0;
for (let cut = k.length - 1; cut > k.length - 400; cut -= 137) {
  const part = flowGateV3(k.slice(0, cut), "utbot", { gateExitMult: 0 }, 1000);
  for (let i = 1000; i < cut; i++) { checked++; if (part.exposure[i] !== full.exposure[i]) bad++; }
}
console.log(`ตรวจ ${checked} ค่า · ไม่ตรง ${bad} ค่า → ${bad === 0 ? "**ผ่าน**" : "**ไม่ผ่าน**"}`);
