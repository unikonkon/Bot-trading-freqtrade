/**
 * เลือกกฎการออกของตระกูล FlowGate ให้ถูกวิธี แล้วตัดสินว่าควรลงทะเบียนหรือไม่
 *
 * ที่มา: `flowgate-transfer.ts` ตรวจสมมติฐาน "ค่าตัวเร็วเหมาะกับความผันผวนของ BTC
 * เท่านั้น" แล้ว **ตกทั้งสองทาง** — ตัวเร็วยิงถี่เท่ากันทุกเหรียญ (ข้อ B) และไม่ได้
 * เลือกแท่งผิด (ข้อ C) จากนั้น `flowgate-ladder.ts` แยกสาเหตุทีละขั้นและพบว่า
 * **กฎการออกที่ band คือตัวปัญหา**: OrderFlow เปล่า ๆ ที่ใช้กฎเดียวกันนี้ติดลบเกือบทุกช่อง
 * และเทรด 706 ครั้งเทียบกับ 166 ครั้งของกฎออกที่ศูนย์
 *
 * ไฟล์นี้จึงเปิดพารามิเตอร์ `gateExitMult` แล้วเลือกค่าด้วยลำดับเดียวกับหัวข้อ 10
 *
 * ═══ เกณฑ์ตัดสิน ประกาศไว้ก่อนเห็นผล ═══════════════════════════════════
 * ลงทะเบียนก็ต่อเมื่อครบทุกข้อ
 *   1) ค่า `gateExitMult` ถูกเลือกจาก **train ของ BTCUSDT เท่านั้น** ด้วย
 *      **ค่ามัธยฐาน** ของผลตอบแทนทั่วย่านพารามิเตอร์ (lookback × band × timeframe)
 *      ไม่ใช่ค่าสูงสุด และค่าข้างเคียงต้องเป็นบวกด้วย (ที่ราบ ไม่ใช่ยอดแหลม)
 *   2) บน BTCUSDT ด้วยค่าที่เลือกได้ ต้องบวกทั้ง train และ test ทั้ง 15m และ 30m
 *   3) พอร์ต ETH/SOL/BNB/XRP ที่ไม่เคยถูกใช้เลือกค่าเลย ต้องบวกทั้งสองช่วงเวลา
 *      ทั้ง 15m และ 30m ทุกค่า band (6 จาก 6 ช่อง) — ด่านเดียวกับที่ OrderFlow V3 ผ่าน
 *   4) ต้อง **ชนะ `orderflow_v3_zero` ที่ลงทะเบียนไว้แล้ว** บนพอร์ตนั้นทั้งสองช่วงเวลา
 *      มิฉะนั้นการเพิ่มรหัสใหม่ไม่มีเหตุผลรองรับ ต่อให้ตัวเลขเป็นบวก
 * ไม่ครบทุกข้อ = รายงานตัวเลขแล้วไม่ลงทะเบียน
 *
 *   npx tsx "signal-bot/web ui/research-v3/flowgate-exit-select.ts"
 */
import fs from "node:fs";
import path from "node:path";
import { load, split, run, f2, SPLIT_AT } from "./lib";
import { flowGateV3, orderFlowV3, type FlowGateTrigger } from "../../../lib/indicators-v3";
import type { KlineData } from "../../../lib/types/kline";

const COIN_DIR = "data-test/crosscoin";
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const EXITS = [1, 0.75, 0.5, 0.25, 0, -0.5, -1];
const TRIGGERS: FlowGateTrigger[] = ["trendlines", "ema", "emaFiltered", "utbot", "confluence"];
const TFS = ["15m", "30m"];
const LOOKS = [3, 5, 8], BANDS = [0.005, 0.01, 0.02];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

console.log("# เลือกกฎการออกของ FlowGate — วัดก่อนลงทะเบียน\n");

// ══ 1) เลือกจาก train ของ BTCUSDT เท่านั้น ═══════════════════════════════
console.log("## 1. ค่ามัธยฐานของผลตอบแทนบน **train ของ BTCUSDT เท่านั้น** (18 ชุดพารามิเตอร์ต่อช่อง)\n");
console.log("| ตัวเร็ว | " + EXITS.map((e) => `exit ${e}`).join(" | ") + " | ค่าที่ชนะ |");
console.log("|---|" + EXITS.map(() => "---:").join("|") + "|---|");
const trainCurves: Record<string, number[]> = {};
const chosen: Record<string, number> = {};
const btc = Object.fromEntries(TFS.map((tf) => [tf, split(load(tf))]));
for (const t of TRIGGERS) {
  const meds = EXITS.map((gateExitMult) => {
    const rs: number[] = [];
    for (const tf of TFS) for (const flowLookbackDays of LOOKS) for (const flowBand of BANDS) {
      const { train } = btc[tf];
      rs.push(run(train.k, flowGateV3(train.k, t, { gateExitMult, flowLookbackDays, flowBand }, train.start).exposure,
        train.start, FEE, SLIP, FUNDING).returnPct);
    }
    return median(rs);
  });
  trainCurves[t] = meds;
  const best = EXITS[meds.indexOf(Math.max(...meds))];
  chosen[t] = best;
  console.log(`| ${t} | ${meds.map((m, i) => (EXITS[i] === best ? `**${f2(m)}**` : f2(m))).join(" | ")} | \`${best}\` |`);
}
console.log("\n**ที่ราบ** — ค่าข้างเคียงของค่าที่ชนะต้องเป็นบวกด้วย:");
for (const t of TRIGGERS) {
  const i = EXITS.indexOf(chosen[t]);
  const nb = [i - 1, i, i + 1].filter((j) => j >= 0 && j < EXITS.length);
  console.log(`- \`${t}\` เลือก ${chosen[t]} · ข้างเคียง ${nb.map((j) => `${EXITS[j]}:${f2(trainCurves[t][j], 1)}`).join(" ")} → ${nb.every((j) => trainCurves[t][j] > 0) ? "ผ่าน" : "**ไม่ผ่าน**"}`);
}

// ══ 2) BTCUSDT ด้วยค่าที่เลือกได้ ════════════════════════════════════════
console.log("\n## 2. BTCUSDT ด้วยค่าที่เลือกได้ (band 0.01 · หักต้นทุนแล้ว)\n");
console.log("| tf | ตัวเร็ว | gateExitMult | train | test | เทรด train/test |");
console.log("|---|---|---|---:|---:|---:|");
const stage2: Record<string, boolean> = {};
for (const tf of TFS) {
  const { train, test } = btc[tf];
  for (const t of TRIGGERS) {
    const g = (w: typeof train) => flowGateV3(w.k, t, { gateExitMult: chosen[t] }, w.start).exposure;
    const a = run(train.k, g(train), train.start, FEE, SLIP, FUNDING);
    const b = run(test.k, g(test), test.start, FEE, SLIP, FUNDING);
    stage2[`${tf}|${t}`] = a.returnPct > 0 && b.returnPct > 0;
    console.log(`| ${tf} | ${t} | ${chosen[t]} | ${f2(a.returnPct)}% | ${f2(b.returnPct)}% | ${a.totalTrades}/${b.totalTrades} |`);
  }
}

// ══ 3–4) เหรียญที่ไม่เคยถูกใช้เลือกค่า ═══════════════════════════════════
type W = { k: KlineData[]; start: number };
function coinWindows(tf: string) {
  return fs.readdirSync(COIN_DIR).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort().map((file) => {
    const k = fs.readFileSync(path.join(COIN_DIR, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
    const warm = k.findIndex((b) => b.openTime >= EVAL_FROM);
    const cut = k.findIndex((b) => b.openTime >= SPLIT_AT);
    return { name: file.split("-")[0].replace("USDT", ""), before: { k: k.slice(0, cut), start: warm } as W, after: { k, start: cut } as W };
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
  return { before: blend("before"), after: blend("after") };
}

console.log("\n## 3. พอร์ต ETH/SOL/BNB/XRP — ค่าทุกตัวมาจาก BTCUSDT เท่านั้น (ก่อน/หลัง 17 พ.ค.)\n");
console.log("| ตัวเร็ว | " + TFS.flatMap((tf) => BANDS.map((b) => `${tf} band ${b}`)).join(" | ") + " | ช่องที่ผ่าน |");
console.log("|---|" + TFS.flatMap(() => BANDS.map(() => "---:")).join("|") + "|---|");
const stage3: Record<string, number> = {};
const zeroRef: Record<string, { before: number; after: number }> = {};
for (const tf of TFS) for (const flowBand of BANDS)
  zeroRef[`${tf}|${flowBand}`] = portfolio(tf, (w) => orderFlowV3(w.k, { flowBand, flowExitMult: 0 }, w.start).exposure);
for (const t of TRIGGERS) {
  let ok = 0;
  const cells = TFS.flatMap((tf) => BANDS.map((flowBand) => {
    const r = portfolio(tf, (w) => flowGateV3(w.k, t, { flowBand, gateExitMult: chosen[t] }, w.start).exposure);
    const pass = r.before > 0 && r.after > 0;
    if (pass) ok++;
    return `${pass ? "✅ " : ""}${f2(r.before)}/${f2(r.after)}`;
  }));
  stage3[t] = ok;
  console.log(`| ${t} | ${cells.join(" | ")} | **${ok}/6** |`);
}
console.log("| **`orderflow_v3_zero` (เส้นฐานที่ลงทะเบียนแล้ว)** | " +
  TFS.flatMap((tf) => BANDS.map((b) => `${f2(zeroRef[`${tf}|${b}`].before)}/${f2(zeroRef[`${tf}|${b}`].after)}`)).join(" | ") + " | — |");

console.log("\n## 4. คำตัดสินตามเกณฑ์ที่ประกาศไว้ก่อนเห็นผล\n");
for (const t of TRIGGERS) {
  const c2 = TFS.every((tf) => stage2[`${tf}|${t}`]);
  const beats = TFS.every((tf) => {
    const r = portfolio(tf, (w) => flowGateV3(w.k, t, { flowBand: 0.01, gateExitMult: chosen[t] }, w.start).exposure);
    const z = zeroRef[`${tf}|0.01`];
    return r.before > z.before && r.after > z.after;
  });
  const all = c2 && stage3[t] === 6 && beats;
  console.log(`- \`${t}\` (exit ${chosen[t]}) — ข้อ 2: ${c2 ? "ผ่าน" : "ไม่ผ่าน"} · ข้อ 3: ${stage3[t]}/6 · ข้อ 4 ชนะ zero: ${beats ? "ผ่าน" : "ไม่ผ่าน"} → **${all ? "ลงทะเบียนได้" : "ไม่ลงทะเบียน"}**`);
}
