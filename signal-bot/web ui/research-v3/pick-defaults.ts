/** เลือกค่าตั้งต้นของกลไกใหม่จากช่วง train เท่านั้น แล้วรายงานผลบน test */
import { load, split, TFS, run, f2 } from "./lib";
import { shortTradeV3 } from "./shorttrade-baseline";
const FEE = 0.05, SLIP = 0.03;
for (const key of ["trailStartR", "riskCostMult", "giveUpMinutes"] as const) {
  const values = key === "trailStartR" ? [1, 1.5, 2, 3, 99]
    : key === "riskCostMult" ? [0, 0.5, 1, 1.5, 2] : [0, 240, 480, 960];
  console.log(`\n##### ${key} — train / test (เทรด, net%)`);
  for (const tf of TFS) {
    const { train, test } = split(load(tf));
    const cells = values.map(v => {
      const a = run(train.k, shortTradeV3(train.k, { [key]: v }, train.start).exposure, train.start, FEE, SLIP, 0.01);
      const b = run(test.k, shortTradeV3(test.k, { [key]: v }, test.start).exposure, test.start, FEE, SLIP, 0.01);
      return `${String(v).padStart(3)}: ${f2(a.returnPct, 0).padStart(4)}/${f2(b.returnPct, 0).padStart(4)}`;
    });
    console.log(`  ${tf.padEnd(4)} ` + cells.join("  "));
  }
}
