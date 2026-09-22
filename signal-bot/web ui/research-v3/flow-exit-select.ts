/**
 * เลือก "กฎการออก" ของตระกูล OrderFlow ให้ถูกวิธี แล้วตัดสินว่าควรลงทะเบียนหรือไม่
 *
 * ที่มา: `tradeplan-eval.ts` ข้อ D พบโดยบังเอิญว่าการไม่ออกเป็นสถานะว่างเลย
 * (ถือจนกว่าสัญญาณจะกลับข้าง) ให้ผลดีกว่ากฎเดิมมากบนช่วง test ของ BTCUSDT
 * แต่ค่านั้นถูกเลือกโดย **การมองผลบน test** ซึ่งเป็นความผิดพลาดที่เอกสาร v3 หัวข้อ 7.2
 * วัดได้ว่าทำให้สหสัมพันธ์ train↔test ติดลบ ไฟล์นี้จึงทำใหม่ทั้งหมดตามลำดับที่ถูกต้อง
 *
 * ═══ เกณฑ์ตัดสิน ประกาศไว้ก่อนเห็นผล ═══════════════════════════════════
 * ลงทะเบียนรหัสใหม่ก็ต่อเมื่อครบทุกข้อ
 *   1) ค่าที่ชนะบน train ของ BTCUSDT (วัดด้วย **ค่ามัธยฐาน** ของผลตอบแทนทั่วทั้งย่าน
 *      พารามิเตอร์ ไม่ใช่ค่าสูงสุด) ต้องไม่ใช่ค่าตั้งต้นเดิม 0.5
 *   2) บนเหรียญที่ไม่เคยถูกใช้เลือกค่าเลย พอร์ตแบ่งทุนเท่ากันต้องเป็นบวก
 *      **ทั้งสองช่วงเวลา ทั้ง 15m และ 30m ทุกค่า band (6 จาก 6 ช่อง)**
 *      ซึ่งเป็นด่านเดียวกับที่ OrderFlow V3 ต้องผ่านก่อนได้ลงทะเบียน
 *   3) บนเหรียญชุดเดียวกันนั้น ต้องดีกว่ากฎเดิม (0.5) ในทั้งสองช่วงเวลา
 *      มิฉะนั้นการเพิ่มรหัสใหม่ไม่มีเหตุผลรองรับ
 * ถ้าไม่ครบทุกข้อ ให้รายงานตัวเลขและไม่ลงทะเบียน
 *
 *   npx tsx "signal-bot/web ui/research-v3/flow-exit-select.ts" [โฟลเดอร์เหรียญอื่น]
 */
import fs from "node:fs";
import path from "node:path";
import { load, split, run, f2, tstat, SPLIT_AT } from "./lib";
import { orderFlowV3 } from "../../../lib/indicators-v3";
import type { KlineData } from "../../../lib/types/kline";

const COIN_DIR = process.argv[2] ?? "data-test/crosscoin";
/**
 * วันแรกที่เริ่มนับผลของเหรียญอื่น ตั้งให้ตรงกับวันแรกของชุด BTCUSDT (17 ก.ย. 2025)
 * ไฟล์ของเหรียญอื่นย้อนไปไกลกว่านั้น 4 เดือนครึ่งเพื่อใช้เป็นช่วงสะสม 125 วัน
 * ทั้งสองชุดจึงถูกวัดบนหน้าต่างเวลาเดียวกันเป๊ะ ไม่ใช่หน้าต่างที่สั้นกว่า
 */
const EVAL_FROM = Date.UTC(2025, 8, 17, 12);
const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const EXITS = [1, 0.75, 0.5, 0.25, 0, -0.5, -1];
const TFS = ["5m", "15m", "30m"];
const LOOKS = [3, 5, 8], BANDS = [0.005, 0.01, 0.02];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

console.log("# เลือกกฎการออกของ OrderFlow จาก train เท่านั้น แล้วตรวจข้ามเหรียญ\n");

// ══ 1) เลือกจาก train ของ BTCUSDT เท่านั้น ═════════════════════
console.log("## 1. คะแนนบนช่วง train ของ BTCUSDT (27 ชุดค่า = 3 timeframe x 3 ช่วงย้อนหลัง x 3 band)\n");
console.log("| flowExitMult | ความหมาย | มัธยฐาน train | แย่ที่สุด | ดีที่สุด | บวกกี่ชุด |");
console.log("|---:|---|---:|---:|---:|---:|");
const meaning: Record<number, string> = {
  1: "ออกทันทีที่หลุดเกณฑ์", 0.75: "ออกที่ 3/4 เกณฑ์", 0.5: "ออกที่ครึ่งเกณฑ์ (ค่าเดิม)",
  0.25: "ออกที่ 1/4 เกณฑ์", 0: "ออกเมื่อข้ามศูนย์", [-0.5]: "ออกที่ครึ่งเกณฑ์ฝั่งตรงข้าม",
  [-1]: "ไม่ออกเลย ถือจนกลับข้าง",
};
const btc = Object.fromEntries(TFS.map((tf) => [tf, split(load(tf))])) as Record<string, ReturnType<typeof split>>;
const trainScore = new Map<number, number>();
for (const flowExitMult of EXITS) {
  const rets: number[] = [];
  for (const tf of TFS)
    for (const flowLookbackDays of LOOKS)
      for (const flowBand of BANDS) {
        const w = btc[tf].train;
        const e = orderFlowV3(w.k, { flowExitMult, flowLookbackDays, flowBand }, w.start).exposure;
        rets.push(run(w.k, e, w.start, FEE, SLIP, FUNDING).returnPct);
      }
  trainScore.set(flowExitMult, median(rets));
  console.log(`| ${flowExitMult} | ${meaning[flowExitMult]} | **${f2(median(rets))}%** | ${f2(Math.min(...rets))}% | ${f2(Math.max(...rets))}% | ${rets.filter((x) => x > 0).length}/27 |`);
}
const chosen = [...trainScore.entries()].sort((a, b) => b[1] - a[1])[0][0];
console.log(`\n**ค่าที่ชนะบน train: flowExitMult = ${chosen}** (เลือกด้วยค่ามัธยฐาน ไม่ใช่ค่าสูงสุด เพื่อไม่ให้ยอดแหลมชนะ)`);

// ══ 2) รายงาน test ครั้งเดียว ═══════════════════════════════════
console.log("\n## 2. ผลบนช่วง test ของ BTCUSDT ที่ค่าตั้งต้นอื่นเดิมทั้งหมด (รายงานครั้งเดียว)\n");
console.log("| tf | กฎการออก | train | test | เทรด train/test | dd test | เวลาถือซื้อ/ขาย/ว่าง (test) |");
console.log("|---|---|---:|---:|---:|---:|---|");
for (const tf of TFS) {
  for (const flowExitMult of [0.5, chosen]) {
    const parts: string[] = [];
    let line = "";
    for (const [label, w] of [["train", btc[tf].train], ["test", btc[tf].test]] as const) {
      const e = orderFlowV3(w.k, { flowExitMult }, w.start).exposure;
      const s = run(w.k, e, w.start, FEE, SLIP, FUNDING);
      parts.push(`${f2(s.returnPct)}%`);
      if (label === "test") {
        const seg = e.slice(w.start);
        const pct = (x: number) => f2((x / seg.length) * 100, 0);
        line = `${seg.filter((x) => x > 0).length}|${seg.filter((x) => x < 0).length}|${seg.filter((x) => x === 0).length}`;
        const [l, sh, fl] = line.split("|").map(Number);
        line = `${pct(l)}% / ${pct(sh)}% / ${pct(fl)}%`;
      }
      parts.push(String(s.totalTrades), f2(s.maxDrawdownPct) + "%");
    }
    const tag = flowExitMult === 0.5 ? "เดิม 0.5" : `ที่เลือก ${chosen}`;
    console.log(`| ${tf} | ${tag} | ${parts[0]} | ${parts[3]} | ${parts[1]}/${parts[4]} | ${parts[5]} | ${line} |`);
  }
}

// ══ 3) ตรวจกับเส้นฐานถือฝั่งเดียว ═══════════════════════════════
console.log("\n## 3. เทียบเส้นฐาน — ได้กำไรเพราะทำนายถูก หรือเพราะเอียงไปทางที่ตลาดเดินอยู่แล้ว\n");
console.log("| tf | ช่วง | กฎเดิม 0.5 | ที่เลือก | ขายตลอดเวลา | ซื้อตลอดเวลา |");
console.log("|---|---|---:|---:|---:|---:|");
for (const tf of TFS)
  for (const [label, w] of [["train", btc[tf].train], ["test", btc[tf].test]] as const) {
    const netOf = (m: number) => f2(run(w.k, orderFlowV3(w.k, { flowExitMult: m }, w.start).exposure, w.start, FEE, SLIP, FUNDING).returnPct) + "%";
    const flatOf = (d: number) => f2(run(w.k, w.k.map(() => d), w.start, FEE, SLIP, FUNDING).returnPct) + "%";
    console.log(`| ${tf} | ${label} | ${netOf(0.5)} | ${netOf(chosen)} | ${flatOf(-1)} | ${flatOf(1)} |`);
  }

// ══ 4) ตรวจข้ามเหรียญ — ข้อมูลที่ไม่เคยถูกใช้เลือกอะไรเลย ════════
if (!fs.existsSync(COIN_DIR)) {
  console.log(`\n(ข้าม: ยังไม่มีโฟลเดอร์ ${COIN_DIR} — รัน scripts/download-crosscoin.ts ก่อน)`);
  process.exit(0);
}
console.log("\n## 4. ตรวจข้ามเหรียญ (ETH/SOL/BNB/XRP) — ค่าทุกตัวมาจาก BTCUSDT ช่วง train เท่านั้น\n");
const pass: Record<string, boolean[]> = { chosen: [], old: [] };
/** เก็บผลพอร์ตรายช่อง เพื่อตัดสินเกณฑ์ข้อ 3 แบบตรวจสอบได้ ไม่ใช่อ่านตารางด้วยตา */
const duel: { tf: string; band: number; window: "ก่อน" | "หลัง"; chosen: number; old: number }[] = [];
for (const tf of ["15m", "30m"]) {
  const files = fs.readdirSync(COIN_DIR).filter((f) => f.endsWith(`-${tf}.jsonl`)).sort();
  console.log(`\n### ${tf} · ${files.length} เหรียญ\n`);
  console.log("| band | กฎ | " + files.map((f) => f.split("-")[0].replace("USDT", "")).join(" | ") + " | **พอร์ต ก่อน 17 พ.ค.** | **พอร์ต หลัง 17 พ.ค.** |");
  console.log("|---|---|" + files.map(() => "---:").join("|") + "|---:|---:|");
  for (const flowBand of BANDS) {
    for (const [tag, m] of [["เดิม 0.5", 0.5], ["ที่เลือก " + chosen, chosen]] as [string, number][]) {
      const perCoin: string[] = [];
      const curves: { before: number[]; after: number[] }[] = [];
      for (const file of files) {
        const k = fs.readFileSync(path.join(COIN_DIR, file), "utf8").trim().split("\n").map((l) => JSON.parse(l) as KlineData);
        const tfm = (k[1].openTime - k[0].openTime) / 60000;
        const warm = Math.max(
          Math.round(((5 + 120) * 1440) / tfm),
          k.findIndex((b) => b.openTime >= EVAL_FROM),
        );
        const cut = k.findIndex((b) => b.openTime >= SPLIT_AT);
        const trainK = k.slice(0, cut);
        const a = run(trainK, orderFlowV3(trainK, { flowExitMult: m, flowBand }, warm).exposure, warm, FEE, SLIP, FUNDING);
        const b = run(k, orderFlowV3(k, { flowExitMult: m, flowBand }, cut).exposure, cut, FEE, SLIP, FUNDING);
        perCoin.push(`${f2(a.returnPct, 0)}/${f2(b.returnPct, 0)}`);
        curves.push({ before: a.equity, after: b.equity });
      }
      const blend = (key: "before" | "after") => {
        const len = Math.min(...curves.map((c) => c[key].length));
        let last = 0;
        for (let i = 0; i < len; i++) last = curves.reduce((s, c) => s + c[key][i], 0) / curves.length;
        return last;
      };
      const before = blend("before"), after = blend("after");
      pass[m === chosen ? "chosen" : "old"].push(before > 0 && after > 0);
      for (const [window, v] of [["ก่อน", before], ["หลัง", after]] as const) {
        const row = duel.find((d) => d.tf === tf && d.band === flowBand && d.window === window);
        if (row) row[m === chosen ? "chosen" : "old"] = v;
        else duel.push({ tf, band: flowBand, window, chosen: m === chosen ? v : NaN, old: m === chosen ? NaN : v });
      }
      console.log(`| ${flowBand} | ${tag} | ${perCoin.join(" | ")} | **${f2(before)}%** | **${f2(after)}%** |`);
    }
  }
}
const ok2 = pass.chosen.every(Boolean);
console.log(`\n**ด่าน 2 (พอร์ตบวกทั้งสองช่วง ทุก band ทั้ง 15m/30m)**: ที่เลือก ${pass.chosen.filter(Boolean).length}/${pass.chosen.length} · กฎเดิม ${pass.old.filter(Boolean).length}/${pass.old.length}`);
console.log(`\n### คำตัดสินตามเกณฑ์ที่ประกาศไว้ก่อนเห็นผล`);
console.log(`- ข้อ 1 ค่าที่ชนะบน train ไม่ใช่ 0.5: ${chosen !== 0.5 ? "ผ่าน" : "ไม่ผ่าน"} (ได้ ${chosen})`);
console.log(`- ข้อ 2 พอร์ตบวก 6/6 ช่อง: ${ok2 ? "ผ่าน" : "ไม่ผ่าน"}`);
const wins = (w: "ก่อน" | "หลัง") => {
  const rows = duel.filter((d) => d.window === w);
  return `${rows.filter((d) => d.chosen > d.old).length}/${rows.length}`;
};
console.log(`- ข้อ 3 ดีกว่ากฎเดิมบนเหรียญที่ไม่เคยใช้เลือกค่า:`);
console.log(`    • ช่วง "หลัง 17 พ.ค." (ไม่เคยถูกใช้เลือกค่าทั้งเหรียญและเวลา): ชนะ ${wins("หลัง")} ช่อง`);
console.log(`    • ช่วง "ก่อน 17 พ.ค." (ไม่เคยถูกใช้เลือกค่าเฉพาะเหรียญ ส่วนเวลาทับกับ train ของ BTCUSDT): ชนะ ${wins("ก่อน")} ช่อง`);
