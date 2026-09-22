/**
 * วัดตระกูล TradePlan **ก่อน** ลงทะเบียน ตามลำดับในเอกสาร trade-planning หัวข้อ 5.1
 *
 *   A) จังหวะเข้ามีข้อมูลเชิงทิศทางไหม (ไม่เกี่ยวกับกฎการออก) — ถ้าไม่มี จบตรงนี้
 *   B) ผลเต็มรูปแบบพร้อมต้นทุน แยก train/test และเทียบเส้นฐาน "ถือฝั่งเดียวตลอดเวลา"
 *   C) ที่ราบของพารามิเตอร์ — ต้องเป็นบวกในย่านต่อเนื่อง ไม่ใช่ยอดแหลม
 *
 * ค่าพารามิเตอร์ทุกตัวถูกเลือกจากเหตุผลเชิงโครงสร้าง (เลขคณิตของต้นทุน) ไม่ได้ค้นหาจาก train
 * รันเฉพาะ timeframe ที่ให้เป็นอาร์กิวเมนต์: `npx tsx tradeplan-eval.ts 15m,30m`
 */
import { load, split, f2, tstat, run } from "./lib";
import { tradePlanV3, orderFlowV3, type PlanSourceId } from "../../../lib/indicators-v3";
import { closes } from "../../../lib/indicators-v2";
import type { KlineData } from "../../../lib/types/kline";

const TFS = (process.argv[2] ?? "5m,15m,30m").split(",");
const SOURCES: PlanSourceId[] = ["flow", "breakout"];
// ต้นทุน futures taker VIP 0 ซึ่งเป็นโครงสร้างที่เอกสารใช้ตลอด
const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;

type Window = { k: KlineData[]; start: number };
const dirs = [
  { label: "สองทาง", p: { allowLong: 1, allowShort: 1 } },
  { label: "ซื้อ", p: { allowLong: 1, allowShort: 0 } },
  { label: "ขาย", p: { allowLong: 0, allowShort: 1 } },
];

console.log("# TradePlan V3 — วัดก่อนลงทะเบียน (BTCUSDT เต็มปี, futures taker)\n");

// ══ A) จังหวะเข้ามีข้อมูลเชิงทิศทางไหม ══════════════════════════
console.log("## A. ผลตอบแทนล่วงหน้าหลังจังหวะเข้า (%, ยังไม่หักต้นทุน) — ต้นทุนไป-กลับคือ 0.16%\n");
console.log("| tf | แหล่ง | ช่วง | จังหวะเข้า | N=10 | N=20 | N=40 | N=80 |");
console.log("|---|---|---|---:|---|---|---|---|");
for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  for (const source of SOURCES) {
    for (const [label, w] of [["train", train], ["test", test]] as [string, Window][]) {
      const r = tradePlanV3(w.k, source, {}, w.start);
      const c = closes(w.k);
      const entries: { i: number; side: number }[] = [];
      for (let i = w.start; i < w.k.length; i++)
        if (r.signal[i] === "BUY" || r.signal[i] === "SHORT")
          entries.push({ i, side: r.signal[i] === "BUY" ? 1 : -1 });
      const cells = [10, 20, 40, 80].map((N) => {
        const xs = entries.filter((e) => e.i + N < c.length)
          .map((e) => (e.side * (c[e.i + N] - c[e.i]) / c[e.i]) * 100);
        if (xs.length < 5) return "-";
        const s = tstat(xs);
        return `${f2(s.mean, 3)} (t ${f2(s.t, 1)})`;
      });
      console.log(`| ${tf} | ${source} | ${label} | ${entries.length} | ${cells.join(" | ")} |`);
    }
  }
}

// ══ B) ผลเต็มรูปแบบพร้อมต้นทุน ═════════════════════════════════
console.log("\n## B. ผลหลังหักต้นทุน (net%) · เทียบ OrderFlow V3 เดิมและเส้นฐานถือฝั่งเดียว\n");
console.log("| tf | กลยุทธ์ | train | test | เทรด train/test | ชนะ test | dd test |");
console.log("|---|---|---:|---:|---:|---:|---:|");
for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  const row = (name: string, exposureOf: (w: Window) => number[]) => {
    const a = run(train.k, exposureOf(train), train.start, FEE, SLIP, FUNDING);
    const b = run(test.k, exposureOf(test), test.start, FEE, SLIP, FUNDING);
    console.log(`| ${tf} | ${name} | ${f2(a.returnPct)}% | ${f2(b.returnPct)}% | ${a.totalTrades}/${b.totalTrades} | ${f2(b.winRate, 0)}% | ${f2(b.maxDrawdownPct)}% |`);
  };
  for (const source of SOURCES)
    for (const d of dirs)
      row(`TradePlan ${source} (${d.label})`, (w) => tradePlanV3(w.k, source, d.p, w.start).exposure);
  row("OrderFlow V3 (สองทาง)", (w) => orderFlowV3(w.k, {}, w.start).exposure);
  // เส้นฐาน: ถือฝั่งเดียวตลอดเวลา ซึ่งในปีขาลงจะดูดีโดยไม่ต้องทำนายถูกเลย
  row("เส้นฐาน: ขายตลอดเวลา", (w) => w.k.map(() => -1));
  row("เส้นฐาน: ซื้อตลอดเวลา", (w) => w.k.map(() => 1));
}

// ══ C) ที่ราบของพารามิเตอร์ ════════════════════════════════════
console.log("\n## C. ที่ราบของพารามิเตอร์ (train/test net%, ✅ = บวกทั้งสองช่วง) — แหล่ง flow สองทาง\n");
for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  console.log(`\n**${tf}** · แถว = เป้า (R) · คอลัมน์ = เวลาถือสูงสุด (ชม.)`);
  const holds = [8, 24, 72, 168];
  console.log(`| เป้า | ${holds.map((h) => `${h} ชม.`).join(" | ")} |`);
  console.log(`|---|${holds.map(() => "---").join("|")}|`);
  for (const targetR of [1.5, 2, 3]) {
    const cells = holds.map((planMaxHoldHours) => {
      const p = { planTargetR: targetR, planMaxHoldHours };
      const a = run(train.k, tradePlanV3(train.k, "flow", p, train.start).exposure, train.start, FEE, SLIP, FUNDING);
      const b = run(test.k, tradePlanV3(test.k, "flow", p, test.start).exposure, test.start, FEE, SLIP, FUNDING);
      const ok = a.returnPct > 0 && b.returnPct > 0 ? "✅ " : "";
      return `${ok}${f2(a.returnPct, 0)}/${f2(b.returnPct, 0)}`;
    });
    console.log(`| ${targetR}R | ${cells.join(" | ")} |`);
  }
  // ด่านความผันผวนมีผลจริงไหม
  const volCells = [0, 0.8, 1, 1.2].map((planMinVolRatio) => {
    const a = run(train.k, tradePlanV3(train.k, "flow", { planMinVolRatio }, train.start).exposure, train.start, FEE, SLIP, FUNDING);
    const b = run(test.k, tradePlanV3(test.k, "flow", { planMinVolRatio }, test.start).exposure, test.start, FEE, SLIP, FUNDING);
    return `${f2(a.returnPct, 0)}/${f2(b.returnPct, 0)} (${a.totalTrades}/${b.totalTrades} ไม้)`;
  });
  console.log(`\nด่านความผันผวน (0 = ปิด / 0.8 / 1.0 / 1.2): ${volCells.join(" · ")}`);
}

// ══ D) ปิดข้อจำกัดทีละข้อ — ข้อไหนเป็นตัวทำลายผล ═══════════════
console.log("\n## D. ปิดข้อจำกัดทีละข้อ (flow สองทาง) — train/test net% · จำนวนไม้\n");
const ablations: [string, Record<string, number>][] = [
  ["ค่าตั้งต้น (ทุกข้อเปิด)", {}],
  ["ปิดด่านความผันผวน", { planMinVolRatio: 0 }],
  ["ปิดงบจำนวนไม้", { planMaxTradesPerYear: 9999 }],
  ["ถือได้ไม่จำกัด (1 ปี)", { planMaxHoldHours: 8760 }],
  ["ปิด stop/เป้า (กว้างจนไม่โดน)", { planStopAtr: 0, planRiskCostMult: 50, planTargetR: 50 }],
  ["ปิดทุกข้อ = เหลือแต่ทิศของสัญญาณ", { planMinVolRatio: 0, planMaxTradesPerYear: 9999, planMaxHoldHours: 8760, planStopAtr: 0, planRiskCostMult: 50, planTargetR: 50 }],
];
console.log("| tf | ปิดอะไร | train | test | ไม้ train/test |");
console.log("|---|---|---:|---:|---:|");
for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  for (const [label, p] of ablations) {
    const a = run(train.k, tradePlanV3(train.k, "flow", p, train.start).exposure, train.start, FEE, SLIP, FUNDING);
    const b = run(test.k, tradePlanV3(test.k, "flow", p, test.start).exposure, test.start, FEE, SLIP, FUNDING);
    console.log(`| ${tf} | ${label} | ${f2(a.returnPct)}% | ${f2(b.returnPct)}% | ${a.totalTrades}/${b.totalTrades} |`);
  }
}

// ══ E) ตรวจ lead ที่โผล่จากข้อ D — "ถือจนกว่าสัญญาณจะกลับข้าง" ══
/**
 * ข้อ D พบว่าเมื่อปิดข้อจำกัดทุกข้อ เหลือแต่ทิศของสัญญาณ ผลกลับเป็นบวกสูง
 * ก่อนจะเรียกสิ่งนี้ว่าความได้เปรียบ ต้องผ่านสองด่านตามบทเรียนหัวข้อ 7.4 และ 8.2 ของเอกสาร v3
 *   1) เป็นที่ราบของพารามิเตอร์หรือยอดแหลม
 *   2) ดีกว่าเส้นฐาน "ถือฝั่งเดียวตลอดเวลา" หรือแค่เอียงไปทางที่ตลาดเดินอยู่แล้ว
 */
const FLIP = { planMinVolRatio: 0, planMaxTradesPerYear: 9999, planMaxHoldHours: 8760, planStopAtr: 0, planRiskCostMult: 50, planTargetR: 50 };
console.log("\n## E. lead จากข้อ D: ที่ราบของพารามิเตอร์ และสัดส่วนเวลาถือแต่ละฝั่ง\n");
for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  console.log(`\n**${tf}** · train/test net% · ✅ = บวกทั้งสองช่วง · แถว = สะสม (วัน) · คอลัมน์ = band`);
  const bands = [0.005, 0.01, 0.02, 0.04];
  console.log(`| สะสม | ${bands.join(" | ")} |`);
  console.log(`|---|${bands.map(() => "---").join("|")}|`);
  for (const flowLookbackDays of [3, 5, 8, 12]) {
    const cells = bands.map((flowBand) => {
      const p = { ...FLIP, flowLookbackDays, flowBand };
      const a = run(train.k, tradePlanV3(train.k, "flow", p, train.start).exposure, train.start, FEE, SLIP, FUNDING);
      const b = run(test.k, tradePlanV3(test.k, "flow", p, test.start).exposure, test.start, FEE, SLIP, FUNDING);
      return `${a.returnPct > 0 && b.returnPct > 0 ? "✅ " : ""}${f2(a.returnPct, 0)}/${f2(b.returnPct, 0)}`;
    });
    console.log(`| ${flowLookbackDays} วัน | ${cells.join(" | ")} |`);
  }
  for (const [label, w] of [["train", train], ["test", test]] as [string, Window][]) {
    const e = tradePlanV3(w.k, "flow", FLIP, w.start).exposure.slice(w.start);
    const long = e.filter((x) => x > 0).length, short = e.filter((x) => x < 0).length;
    const pct = (x: number) => f2((x / e.length) * 100, 0);
    console.log(`สัดส่วนเวลาถือ ${label}: ซื้อ ${pct(long)}% · ขาย ${pct(short)}% · ว่าง ${pct(e.length - long - short)}%`);
  }
}
