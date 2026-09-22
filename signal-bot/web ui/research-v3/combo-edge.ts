/**
 * คำถามที่ชี้ขาดก่อนเขียนอินดิเคเตอร์ผสมใด ๆ:
 * **การเอา OrderFlow มาเป็นชั้นทิศทาง แล้วให้ตัวเร็วเป็นชั้นจังหวะ เพิ่มข้อมูลเชิงทิศทางจริงไหม**
 *
 * วัดผลตอบแทนล่วงหน้า N แท่งในทิศที่ตัวเร็วบอก โดยยังไม่มีกฎการออกเลย แล้วแยกสามกลุ่ม
 *   ทั้งหมด        — จังหวะเข้าของตัวเร็วล้วน ๆ (เส้นฐาน)
 *   flow เห็นด้วย  — เฉพาะแท่งที่แรงซื้อขายสุทธิชี้ทางเดียวกับตัวเร็ว
 *   flow ค้าน      — เฉพาะแท่งที่ชี้สวนทางกัน
 *
 * ถ้าชั้นทิศทางมีประโยชน์จริง กลุ่ม "เห็นด้วย" ต้องดีกว่า "ทั้งหมด" อย่างสม่ำเสมอ
 * ทั้ง train และ test ไม่ใช่แค่ดีขึ้นเพราะจำนวนไม้ลดลง (เอกสาร v3 หัวข้อ 6.3)
 *
 *   npx tsx "signal-bot/web ui/research-v3/combo-edge.ts" 5m,15m,30m
 */
import { load, split, f2, tstat } from "./lib";
import { orderFlowV3 } from "../../../lib/indicators-v3";
import { smcV2, emaV2, supertrendV2, utBotV2, macdV2, type V2Base } from "../../../lib/indicators-v2";
import { trendlinesWithBreaks } from "../../../lib/indicators";
import { closes } from "../../../lib/indicators-v2";
import type { KlineData } from "../../../lib/types/kline";

const TFS = (process.argv[2] ?? "5m,15m,30m").split(",");
const BAND = 0.01;
const HORIZONS = [20, 40, 80];

/** ทิศที่ตัวเร็วเสนอรายแท่ง: 1 ซื้อ, −1 ขาย, 0 ไม่เสนอ */
function triggers(k: KlineData[]): Record<string, number[]> {
  const n = k.length;
  const zero = () => new Array(n).fill(0);
  const tl = trendlinesWithBreaks(k, 14, 1, "Atr", true);
  const ema = emaV2(k, {}, 0);
  // ผู้สมัครแทน smc_v2 ซึ่งวัดแล้วสลับเครื่องหมาย train→test — เลือกผู้ชนะจาก train เท่านั้น
  const others: [string, V2Base][] = [
    ["smc_v2", smcV2(k, {}, 0)],
    ["supertrend_v2", supertrendV2(k, {}, 0)],
    ["ut_bot_v2", utBotV2(k, {}, 0)],
    ["macd_v2", macdV2(k, {}, 0)],
  ];
  const out: Record<string, number[]> = {
    "trendlines(break)": zero(), "ema_v2": zero(), "ema_v2_filtered": zero(),
  };
  for (const [name] of others) out[name] = zero();
  for (let i = 0; i < n; i++) {
    if (tl.breakUp[i]) out["trendlines(break)"][i] = 1;
    else if (tl.breakDown[i]) out["trendlines(break)"][i] = -1;
    const e = ema.signal[i];
    out["ema_v2"][i] = e === "BUY" ? 1 : e === "SELL" ? -1 : 0;
    const f = ema.signalFiltered[i];
    out["ema_v2_filtered"][i] = f === "BUY" ? 1 : f === "SELL" ? -1 : 0;
    for (const [name, r] of others) {
      const v = r.signal[i];
      out[name][i] = v === "BUY" ? 1 : v === "SELL" ? -1 : 0;
    }
  }
  return out;
}

console.log("# ชั้นทิศทางจาก OrderFlow เพิ่มข้อมูลให้ตัวเร็วไหม (BTCUSDT, % ต่อไม้ ก่อนหักต้นทุน)\n");
console.log("ต้นทุนไป-กลับ futures taker = 0.16% · ค่าที่ต่ำกว่านี้แปลว่าเข้าไปก็ขาดทุน\n");
for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  console.log(`\n## ${tf}\n`);
  console.log("| ตัวเร็ว | กลุ่ม | ไม้ train | N=20 train/test | N=40 train/test | N=80 train/test |");
  console.log("|---|---|---:|---|---|---|");
  const cache = new Map<string, { trig: Record<string, number[]>; bias: number[]; c: number[] }>();
  for (const [label, w] of [["train", train], ["test", test]] as const) {
    const flow = orderFlowV3(w.k, {}, w.start).signalValue;
    const bias = flow.map((v) => (v === null ? 0 : v > BAND ? 1 : v < -BAND ? -1 : 0));
    cache.set(label, { trig: triggers(w.k), bias, c: closes(w.k) });
  }
  for (const name of Object.keys(cache.get("train")!.trig)) {
    for (const group of ["ทั้งหมด", "flow เห็นด้วย", "flow ค้าน"] as const) {
      const cells: string[] = [];
      let nTrain = 0;
      for (const N of HORIZONS) {
        const per: string[] = [];
        for (const label of ["train", "test"] as const) {
          const { trig, bias, c } = cache.get(label)!;
          const w = label === "train" ? train : test;
          const xs: number[] = [];
          for (let i = w.start; i + N < w.k.length; i++) {
            const d = trig[name][i];
            if (d === 0) continue;
            if (group === "flow เห็นด้วย" && bias[i] !== d) continue;
            if (group === "flow ค้าน" && bias[i] !== -d) continue;
            xs.push((d * (c[i + N] - c[i]) / c[i]) * 100);
          }
          if (label === "train") nTrain = xs.length;
          const s = tstat(xs);
          per.push(xs.length < 10 ? "-" : `${f2(s.mean, 3)} (t ${f2(s.t, 1)})`);
        }
        cells.push(per.join(" / "));
      }
      console.log(`| ${name} | ${group} | ${nTrain} | ${cells.join(" | ")} |`);
    }
  }
}
