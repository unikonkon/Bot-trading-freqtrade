/**
 * เส้นขอบเขตความถี่–กำไร: ที่ความถี่สัญญาณแต่ละระดับ ทำกำไรได้ดีที่สุดเท่าไร
 *
 * คำสั่งคือ "ให้มีสัญญาณมากที่สุดเท่าที่จะทำได้" ซึ่งถ้าตีความตรงตัวจะได้ค่าที่ขาดทุน −98%
 * ไฟล์นี้จึงตีความว่า **ถี่ที่สุดเท่าที่ยังคุ้มค่าจะเทรด** แล้วหาเส้นขอบเขตให้เห็นทั้งเส้น
 * เพื่อให้เลือกจุดบนเส้นได้ด้วยตัวเลข ไม่ใช่ด้วยความรู้สึก
 *
 * กวาดสี่แกนพร้อมกัน เพราะความถี่ไม่ได้ขึ้นกับหน้าต่างอย่างเดียว
 *   flowLookbackDays  หน้าต่างสะสม — สั้นลง = แกว่งบ่อยขึ้น
 *   flowDebiasDays    หน้าต่างลบอคติ
 *   flowBand          เกณฑ์เข้า — ต่ำลง = ข้ามเกณฑ์บ่อยขึ้น
 *   flowExitMult      เกณฑ์ออก — สูงขึ้น = ออกไวขึ้น = ครบรอบบ่อยขึ้น
 *
 * ทุกตัวเลขในไฟล์นี้มาจาก **train ของ BTCUSDT เท่านั้น** ยังไม่แตะ test และยังไม่แตะเหรียญอื่น
 *
 *   npx tsx "signal-bot/web ui/research-v3/frequency-frontier.ts"
 */
import { load, split, run, f2 } from "./lib";
import { orderFlowV3 } from "../../../lib/indicators-v3";

const FEE = 0.05, SLIP = 0.03, FUNDING = 0.01;
const TFS = ["15m", "30m"];
const PER_DAY: Record<string, number> = { "1m": 1440, "3m": 480, "5m": 288, "15m": 96, "30m": 48 };
const LOOKS = [0.5, 1, 1.5, 2, 3, 4, 5];
const DEBIAS = [3, 5, 10, 20, 40, 120];
const BANDS = [0.002, 0.005, 0.01, 0.02];
const EXITS = [1, 0.5, 0];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const trains = Object.fromEntries(TFS.map((tf) => [tf, split(load(tf)).train]));
type Row = { l: number; d: number; b: number; e: number; ret: number; sig: number; trades: number };
const rows: Row[] = [];

for (const l of LOOKS) for (const d of DEBIAS) {
  if (l >= d) continue;
  for (const b of BANDS) for (const e of EXITS) {
    const rs: number[] = [], sg: number[] = [], td: number[] = [];
    for (const tf of TFS) {
      const w = trains[tf];
      const r = orderFlowV3(w.k, { flowLookbackDays: l, flowDebiasDays: d, flowBand: b, flowExitMult: e }, w.start);
      const s = run(w.k, r.exposure, w.start, FEE, SLIP, FUNDING);
      rs.push(s.returnPct);
      sg.push(r.signal.filter(Boolean).length / ((w.k.length - w.start) / PER_DAY[tf]));
      td.push(s.totalTrades);
    }
    rows.push({ l, d, b, e, ret: median(rs), sig: median(sg), trades: median(td) });
  }
}

console.log("# เส้นขอบเขตความถี่–กำไร (BTCUSDT train เท่านั้น · หักต้นทุน futures taker)\n");
console.log(`กวาด ${rows.length} ชุดค่า · ค่ากลางข้าม 15m และ 30m\n`);

// ══ เส้นขอบเขต: ที่แต่ละช่วงความถี่ เอาชุดที่กำไรสูงสุด ══════════════════
const BUCKETS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 20];
console.log("## 1. จุดที่ดีที่สุดในแต่ละช่วงความถี่\n");
console.log("| สัญญาณ/วัน | ชุดค่าที่ดีที่สุด (look/debias/band/exit) | ผลตอบแทน train | ไม้ | ค่าธรรมเนียม/ปี |");
console.log("|---:|---|---:|---:|---:|");
const frontier: Row[] = [];
for (let i = 0; i < BUCKETS.length; i++) {
  const lo = i ? BUCKETS[i - 1] : 0, hi = BUCKETS[i];
  const inBucket = rows.filter((r) => r.sig > lo && r.sig <= hi);
  if (!inBucket.length) continue;
  const best = inBucket.reduce((a, b) => (b.ret > a.ret ? b : a));
  frontier.push(best);
  const perYear = best.sig * 365 / 2; // สองสัญญาณ = หนึ่งไม้ครบรอบ
  console.log(`| ${lo}–${hi} | ${best.l} / ${best.d} / ${best.b} / ${best.e} | ${best.ret > 0 ? "**" : ""}${f2(best.ret)}%${best.ret > 0 ? "**" : ""} | ${best.trades} | ${f2(perYear * 0.16, 0)}% |`);
}

console.log("\n## 2. ชุดค่าที่ถี่ที่สุดซึ่งยังเป็นบวกบน train\n");
const positive = rows.filter((r) => r.ret > 0).sort((a, b) => b.sig - a.sig);
console.log("| อันดับ | look | debias | band | exit | สัญญาณ/วัน | train | แท่งอุ่นเครื่อง 1m / 5m / 30m |");
console.log("|---:|---:|---:|---:|---:|---:|---:|---|");
for (const [i, r] of positive.slice(0, 12).entries())
  console.log(`| ${i + 1} | ${r.l} | ${r.d} | ${r.b} | ${r.e} | **${f2(r.sig, 2)}** | ${f2(r.ret)}% | ${["1m", "5m", "30m"].map((tf) => Math.round((r.l + r.d) * PER_DAY[tf]).toLocaleString()).join(" / ")} |`);

console.log("\n## 3. ที่ราบของผู้สมัครถี่สุด 5 อันดับแรก (เพื่อนบ้านทุกแกนต้องไม่ติดลบหนัก)\n");
const at = (l: number, d: number, b: number, e: number) => rows.find((r) => r.l === l && r.d === d && r.b === b && r.e === e);
console.log("| ชุดค่า | สัญญาณ/วัน | เอง | เพื่อนบ้าน look | debias | band | exit | ที่ราบ |");
console.log("|---|---:|---:|---|---|---|---|---|");
for (const c of positive.slice(0, 5)) {
  const nb = (xs: number[], key: "l" | "d" | "b" | "e") => {
    const i = xs.indexOf(c[key]);
    return [i - 1, i + 1].filter((j) => j >= 0 && j < xs.length).map((j) => {
      const q = { l: c.l, d: c.d, b: c.b, e: c.e, [key]: xs[j] } as { l: number; d: number; b: number; e: number };
      const r = at(q.l, q.d, q.b, q.e);
      return r ? f2(r.ret, 0) : "—";
    });
  };
  const all = [nb(LOOKS, "l"), nb(DEBIAS, "d"), nb(BANDS, "b"), nb(EXITS, "e")];
  const ok = all.flat().filter((x) => x !== "—").every((x) => Number(x) > -5);
  console.log(`| ${c.l}/${c.d}/${c.b}/${c.e} | ${f2(c.sig, 2)} | ${f2(c.ret, 0)} | ${all[0].join(" ")} | ${all[1].join(" ")} | ${all[2].join(" ")} | ${all[3].join(" ")} | ${ok ? "✅" : "❌"} |`);
}
