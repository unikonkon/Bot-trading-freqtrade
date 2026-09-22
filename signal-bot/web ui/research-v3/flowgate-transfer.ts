/**
 * ทำไมชั้นจังหวะของ FlowGate ย้ายข้ามเหรียญไม่ได้ — ไล่ทีละสมมติฐาน
 *
 * สมมติฐานที่ตั้งไว้: ค่าตั้งต้นของตัวเร็ว (EMA 20/50, ATR 10, pivot 14) เหมาะกับ
 * ความผันผวนของ BTCUSDT แต่ไม่เหมาะกับเหรียญที่ผันผวนต่างออกไป จึงควรปรับตาม ATR
 *
 * ═══ ลำดับการตรวจ ประกาศไว้ก่อนเห็นผล ══════════════════════════════════
 *   A) **ประตูทิศทางเองย้ายข้ามเหรียญได้ไหม** — ทำตาราง "เห็นด้วย/ค้าน" ซ้ำบน
 *      ETH/SOL/BNB/XRP ถ้ากลุ่ม "ค้าน" ไม่ติดลบเป็นระบบบนเหรียญอื่น แปลว่าปัญหา
 *      อยู่ที่ประตู ไม่ใช่สเกลของตัวเร็ว → สมมติฐานตก ไม่ต้องไปต่อ
 *   B) **มีความไม่เข้ากันของสเกลจริงไหม** — ATR% และความถี่ที่ตัวเร็วยิงต่อ 1000 แท่ง
 *      ถ้าทุกเหรียญยิงถี่พอ ๆ กัน แปลว่าไม่มีอะไรให้ปรับ → สมมติฐานตก
 *   C) **การเลือกแท่งของตัวเร็วทำร้ายหรือแค่ลดการถือครอง** — ในบรรดาแท่งที่ชั้นทิศทาง
 *      เปิดทางอยู่แล้ว เทียบผลตอบแทนของแท่งที่ตัวเร็วพาเข้า กับแท่งที่ตัวเร็วทำให้พลาด
 *        · พลาด > เข้า  → ตัวเร็วเลือกผิดจริง การปรับสเกลมีโอกาสช่วย
 *        · พลาด ≈ เข้า  → ตัวเร็วเป็นแค่สัญญาณรบกวนที่ลดเวลาถือครอง ปรับสเกลไม่ช่วย
 *
 *   npx tsx "signal-bot/web ui/research-v3/flowgate-transfer.ts"
 */
import fs from "node:fs";
import path from "node:path";
import { load, f2, tstat, SPLIT_AT } from "./lib";
import { flowGateV3, type FlowGateTrigger } from "../../../lib/indicators-v3";
import { atr, closes } from "../../../lib/indicators-v2";
import type { KlineData } from "../../../lib/types/kline";

const COIN_DIR = "data-test/crosscoin";
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
const BAND = 0.01;
const HORIZON = 80;
const TRIGGERS: FlowGateTrigger[] = ["trendlines", "ema", "utbot", "confluence"];
const TFS = ["15m", "30m"];

type Coin = { name: string; k: KlineData[]; start: number; cut: number };

function coins(tf: string): Coin[] {
  const out: Coin[] = [];
  const btc = load(tf);
  out.push({ name: "BTC", k: btc, start: 1000, cut: btc.findIndex((b) => b.openTime >= SPLIT_AT) });
  for (const file of fs.readdirSync(COIN_DIR).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort()) {
    const k = fs.readFileSync(path.join(COIN_DIR, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
    out.push({
      name: file.split("-")[0].replace("USDT", ""),
      k, start: k.findIndex((b) => b.openTime >= EVAL_FROM), cut: k.findIndex((b) => b.openTime >= SPLIT_AT),
    });
  }
  return out;
}

/** ผลตอบแทนล่วงหน้า HORIZON แท่ง เป็น % ในทิศ d */
const fwd = (c: number[], i: number, d: number) =>
  i + HORIZON < c.length ? ((c[i + HORIZON] - c[i]) / c[i]) * 100 * d : null;

console.log("# FlowGate ย้ายข้ามเหรียญไม่ได้เพราะอะไร\n");
console.log(`ทุกตัวเลขก่อนหักต้นทุน · ขอบเขต ${HORIZON} แท่ง · band ${BAND} · ค่าตัวเร็วเป็นค่าตั้งต้นเดิมทั้งหมด\n`);

// ══ A) ประตูทิศทางเองย้ายข้ามเหรียญได้ไหม ═══════════════════════════════
console.log("## A. ตาราง \"เห็นด้วย / ค้าน\" ซ้ำบนเหรียญอื่น (% ต่อไม้ · ก่อน/หลัง 17 พ.ค.)\n");
const agreeOk: Record<string, number> = {};
for (const tf of TFS) {
  console.log(`\n### ${tf}\n`);
  console.log("| ตัวเร็ว | เหรียญ | N | เห็นด้วย ก่อน | เห็นด้วย หลัง | ค้าน ก่อน | ค้าน หลัง | ค้านติดลบทั้งคู่ |");
  console.log("|---|---|---:|---:|---:|---:|---:|---|");
  for (const t of TRIGGERS) {
    for (const co of coins(tf)) {
      const g = flowGateV3(co.k, t, { flowBand: BAND }, co.start);
      const c = closes(co.k);
      const buckets = { agreeA: [] as number[], agreeB: [] as number[], disA: [] as number[], disB: [] as number[] };
      for (let i = co.start; i < co.k.length; i++) {
        const d = g.triggerDir![i] as number, v = g.signalValue[i];
        if (!d || v === null) continue;
        const bias = v > BAND ? 1 : v < -BAND ? -1 : 0;
        if (!bias) continue;
        const rr = fwd(c, i, d);
        if (rr === null) continue;
        const before = i < co.cut;
        if (bias === d) (before ? buckets.agreeA : buckets.agreeB).push(rr);
        else (before ? buckets.disA : buckets.disB).push(rr);
      }
      const m = (xs: number[]) => (xs.length ? tstat(xs).mean : NaN);
      const dA = m(buckets.disA), dB = m(buckets.disB);
      const ok = dA < 0 && dB < 0;
      if (ok) agreeOk[`${tf}|${t}`] = (agreeOk[`${tf}|${t}`] ?? 0) + 1;
      console.log(`| ${t} | ${co.name} | ${buckets.agreeA.length + buckets.agreeB.length} | ${f2(m(buckets.agreeA))} | ${f2(m(buckets.agreeB))} | ${f2(dA)} | ${f2(dB)} | ${ok ? "✅" : "❌"} |`);
    }
  }
}
console.log("\n**สรุปข้อ A** — จำนวนเหรียญ (จาก 5) ที่กลุ่ม \"ค้าน\" ติดลบทั้งสองช่วง:");
for (const tf of TFS) for (const t of TRIGGERS) console.log(`- ${tf} \`${t}\`: ${agreeOk[`${tf}|${t}`] ?? 0}/5`);

// ══ B) สเกลของแต่ละเหรียญ ═══════════════════════════════════════════════
console.log("\n## B. ความผันผวนและความถี่ที่ตัวเร็วยิง\n");
for (const tf of TFS) {
  console.log(`\n### ${tf}\n`);
  console.log("| เหรียญ | ATR(14) กลาง % | เทียบ BTC | " + TRIGGERS.map((t) => `${t} ยิง/1k`).join(" | ") + " |");
  console.log("|---|---:|---:|" + TRIGGERS.map(() => "---:").join("|") + "|");
  let btcAtr = 0;
  for (const co of coins(tf)) {
    const a = atr(co.k, 14), c = closes(co.k);
    const pcts = [] as number[];
    for (let i = co.start; i < co.k.length; i++) if (a[i] !== null) pcts.push((a[i]! / c[i]) * 100);
    pcts.sort((x, y) => x - y);
    const med = pcts[Math.floor(pcts.length / 2)];
    if (co.name === "BTC") btcAtr = med;
    const bars = co.k.length - co.start;
    const fires = TRIGGERS.map((t) => {
      const g = flowGateV3(co.k, t, { flowBand: BAND }, co.start);
      let n = 0;
      for (let i = co.start; i < co.k.length; i++) if (g.triggerDir![i]) n++;
      return f2((n / bars) * 1000, 1);
    });
    console.log(`| ${co.name} | ${f2(med, 3)} | ${f2(med / btcAtr)}× | ${fires.join(" | ")} |`);
  }
}

// ══ C) ตัวเร็วเลือกผิด หรือแค่ลดเวลาถือครอง ════════════════════════════
console.log("\n## C. ในบรรดาแท่งที่ชั้นทิศทางเปิดทางอยู่แล้ว — แท่งที่ตัวเร็วพาเข้า เทียบ แท่งที่พลาด\n");
console.log("ผลตอบแทนแท่งถัดไปในทิศของ bias (% ต่อแท่ง · ทั้งช่วง) · **พลาด > เข้า = ตัวเร็วเลือกผิดจริง**\n");
for (const tf of TFS) {
  console.log(`\n### ${tf}\n`);
  console.log("| ตัวเร็ว | เหรียญ | แท่งที่เข้า | ผลเมื่อเข้า | แท่งที่พลาด | ผลเมื่อพลาด | ส่วนต่าง | t ส่วนต่าง |");
  console.log("|---|---|---:|---:|---:|---:|---:|---:|");
  for (const t of TRIGGERS) {
    for (const co of coins(tf)) {
      const g = flowGateV3(co.k, t, { flowBand: BAND }, co.start);
      const c = closes(co.k);
      const inside: number[] = [], missed: number[] = [];
      for (let i = co.start; i < co.k.length - 1; i++) {
        const v = g.signalValue[i];
        if (v === null) continue;
        const bias = v > BAND ? 1 : v < -BAND ? -1 : 0;
        if (!bias) continue;
        const rr = ((c[i + 1] - c[i]) / c[i]) * 100 * bias;
        if (g.direction[i] === bias) inside.push(rr); else missed.push(rr);
      }
      const A = tstat(inside), B = tstat(missed);
      // t ของส่วนต่างสองกลุ่มอิสระ
      const se = Math.sqrt(A.sd ** 2 / Math.max(1, A.n) + B.sd ** 2 / Math.max(1, B.n));
      const diff = A.mean - B.mean;
      console.log(`| ${t} | ${co.name} | ${A.n} | ${f2(A.mean, 4)} | ${B.n} | ${f2(B.mean, 4)} | ${f2(diff, 4)} | ${f2(se > 0 ? diff / se : 0)} |`);
    }
  }
}
