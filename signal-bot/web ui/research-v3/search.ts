/**
 * ค้นหาค่าบนช่วง train แล้ววัดบนช่วง test ที่ไม่ถูกใช้เลือกค่า
 * รายงานสหสัมพันธ์ train–test ซึ่งเป็นตัวบอกว่าการปรับค่ามีความหมายหรือเป็นเพียง noise
 * ประเมินสามโครงสร้างต้นทุน เพราะต้นทุนเป็นตัวแปรที่ใหญ่กว่าพารามิเตอร์ทุกตัวรวมกัน
 */
import { load, split, run, f2, tstat } from "./lib";
import { shortTradeV3 } from "./shorttrade-baseline";

const TF = process.argv[2] ?? "30m";
const all = load(TF);
const { train, test } = split(all);

/** ไป–กลับ: spot taker 0.30% · futures taker 0.16% · futures maker 0.06% */
const COSTS = [
  { name: "spot-taker", fee: 0.1, slip: 0.05 },
  { name: "fut-taker", fee: 0.05, slip: 0.03 },
  { name: "fut-maker", fee: 0.02, slip: 0.01 },
] as const;

const grid: Record<string, number[]> = {
  stopAtr: [1.2, 2, 3],
  riskCostMult: [0, 1, 2],
  costPct: [0.06, 0.16, 0.31],
  minNetRewardRisk: [0.4, 0.75, 1.2],
  trailStartR: [1, 2, 99],
  giveUpMinutes: [0, 240],
  holdMinutes: [240, 720, 1440],
  sessionMode: [0, 2],
  minVolumeRatio: [0.7, 1.2],
};
let combos: Record<string, number>[] = [{}];
for (const [key, values] of Object.entries(grid))
  combos = combos.flatMap(base => values.map(v => ({ ...base, [key]: v })));

function evalWindow(w: { k: any[]; start: number }, p: Record<string, number>) {
  const exp = shortTradeV3(w.k, p, w.start).exposure;
  const gross = run(w.k, exp, w.start, 0, 0, 0);
  const byCost = Object.fromEntries(COSTS.map(c => [c.name, run(w.k, exp, w.start, c.fee, c.slip, 0.01)]));
  return { gross, byCost, gt: tstat(gross.trades.map(t => t.pnlPct)) };
}
const pearson = (a: number[], b: number[]) => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
};

const rows = [];
for (const p of combos) {
  const tr = evalWindow(train, p);
  if (tr.byCost["fut-taker"].totalTrades < 25) continue;
  const te = evalWindow(test, p);
  rows.push({ p, tr, te });
}
console.log(`\n##### ${TF} · train ${train.k.length - train.start} แท่ง / test ${test.k.length - test.start} แท่ง · ${rows.length}/${combos.length} combos ผ่านขั้นต่ำ 25 เทรด`);

for (const c of COSTS) {
  const trN = rows.map(r => r.tr.byCost[c.name].returnPct);
  const teN = rows.map(r => r.te.byCost[c.name].returnPct);
  const trPos = trN.filter(x => x > 0).length, tePos = teN.filter(x => x > 0).length;
  const best = rows[trN.indexOf(Math.max(...trN))];
  const top10 = [...rows].sort((a, b) => b.tr.byCost[c.name].returnPct - a.tr.byCost[c.name].returnPct).slice(0, 10);
  const top10TestPos = top10.filter(r => r.te.byCost[c.name].returnPct > 0).length;
  console.log(`\n--- ต้นทุน ${c.name} (fee ${c.fee} slip ${c.slip}) ---`);
  console.log(`  train บวก ${trPos}/${rows.length} (${f2((trPos / rows.length) * 100, 0)}%) · test บวก ${tePos}/${rows.length} (${f2((tePos / rows.length) * 100, 0)}%)`);
  console.log(`  สหสัมพันธ์ผลตอบแทน train↔test = ${f2(pearson(trN, teN), 3)}`);
  console.log(`  ค่าที่ดีที่สุดบน train: ${f2(best.tr.byCost[c.name].returnPct)}% → test ${f2(best.te.byCost[c.name].returnPct)}%`);
  console.log(`  10 อันดับแรกของ train ที่ test เป็นบวกด้วย: ${top10TestPos}/10`);
}
// ความได้เปรียบก่อนต้นทุน ซึ่งไม่ขึ้นกับโครงสร้างค่าธรรมเนียม
const gtr = rows.map(r => r.tr.gross.returnPct), gte = rows.map(r => r.te.gross.returnPct);
console.log(`\n--- ก่อนหักต้นทุน ---`);
console.log(`  train บวก ${gtr.filter(x => x > 0).length}/${rows.length} · test บวก ${gte.filter(x => x > 0).length}/${rows.length} · สหสัมพันธ์ ${f2(pearson(gtr, gte), 3)}`);
const bestG = rows[gtr.indexOf(Math.max(...gtr))];
console.log(`  gross ดีที่สุดบน train ${f2(Math.max(...gtr))}% (t=${f2(bestG.tr.gt.t, 2)}) → test ${f2(bestG.te.gross.returnPct)}% (t=${f2(bestG.te.gt.t, 2)})`);
