/**
 * ผลเต็มปีของ shortTradeV3 (ตระกูล SMC ที่ถอดออกจากทะเบียนแล้ว) ทุก timeframe และสองโครงสร้างต้นทุน
 * ไม่ได้ลงทะเบียนเป็นกลยุทธ์อีกแล้ว จึงเรียกอินดิเคเตอร์ตรงและกำหนดทิศเอง
 */
import { load, TFS, run, f2, tstat } from "./lib";
import { shortTradeV3 } from "../../../lib/indicators-v3-ShortTrade";
const WARM = 1000;
const COSTS = [
  { name: "spot-taker  (0.10+0.05/ขา)", fee: 0.1, slip: 0.05 },
  { name: "fut-taker   (0.05+0.03/ขา)", fee: 0.05, slip: 0.03 },
] as const;
for (const tf of TFS) {
  const k = load(tf);
  const r = shortTradeV3(k, {}, WARM);
  const bars = k.length - WARM;
  const gross = run(k, r.exposure, WARM, 0, 0, 0);
  const g = tstat(gross.trades.map(t => t.pnlPct));
  const avgH = gross.trades.reduce((a, t) => a + t.bars, 0) / Math.max(1, gross.trades.length) * r.timeframeMinutes / 60;
  const exits: Record<string, number> = {};
  for (const t of gross.trades) { const key = (r.reason[t.exitIdx - 1] ?? "").split(" ")[1] ?? "?"; exits[key] = (exits[key] ?? 0) + 1; }
  console.log(`\n##### ${tf} — ${bars} แท่ง · ถือเฉลี่ย ${f2(avgH, 1)} ชม. · hold ${r.resolvedHoldBars} แท่ง = ${r.resolvedHoldBars * r.timeframeMinutes} นาที`);
  console.log(`  gross ${f2(gross.returnPct).padStart(7)}% · pf ${f2(gross.profitFactor ?? 99)} · เฉลี่ย/ไม้ ${f2(g.mean, 4)}% · t=${f2(g.t, 2)}`);
  console.log(`  เหตุผลออก: ${Object.entries(exits).map(([x, n]) => `${x} ${n}`).join(" · ")}`);
  for (const c of COSTS) {
    const cells = ([[1, 1], [1, 0], [0, 1]] as const).map(([allowLong, allowShort]) => {
      const s = run(k, shortTradeV3(k, { allowLong, allowShort }, WARM).exposure, WARM, c.fee, c.slip, 0.01);
      return `${String(s.totalTrades).padStart(4)} / ${f2(s.returnPct).padStart(7)}%`;
    });
    console.log(`  ${c.name}  สองทาง ${cells[0]} | ซื้อ ${cells[1]} | ขาย ${cells[2]}`);
  }
}
