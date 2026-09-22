/** ตารางกำแพงราคา: เข้าไม้แบบสุ่มทุกแท่ง แล้ววัดว่ากฎ stop/target แบบไหนให้ผลอย่างไรก่อนมีสัญญาณ */
import { load, TFS, f2 } from "./lib";
import type { KlineData } from "../../../lib/types/kline";

const num = (s: string) => parseFloat(s);
function atrSeries(k: KlineData[], p = 14) {
  const tr: number[] = [], out: number[] = new Array(k.length).fill(NaN);
  for (let i = 0; i < k.length; i++) {
    const h = num(k[i].high), l = num(k[i].low), pc = i ? num(k[i - 1].close) : num(k[i].open);
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    if (i >= p - 1) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += tr[j]; out[i] = s / p; }
  }
  return out;
}
const HOLD: Record<string, number> = { "1m": 60, "3m": 40, "5m": 36, "15m": 24, "30m": 16 };
const COST = 0.16; // ไป-กลับ futures taker (fee 0.05 + slip 0.03 ต่อขา)

console.log("# กำแพงราคาแบบเข้าไม้สุ่ม — BTCUSDT เต็มปี (ทิศซื้อ, ต้นทุนไป-กลับ 0.16%)\n");
console.log("stop = 1 ATR เสมอ · หมดเวลาแล้วปิดที่ราคาปิด · ผลเป็น % ต่อไม้ (หักต้นทุนแล้ว)\n");
console.log("| tf | เป้า (ATR) | เป้า/stop เป็น % | ถึงเป้าก่อน | โดน stop ก่อน | หมดเวลา | กำไรเฉลี่ย/ไม้ | ชนะที่ต้องได้เพื่อเสมอ |");
console.log("|---|---:|---|---:|---:|---:|---:|---:|");
for (const tf of TFS) {
  const k = load(tf), a = atrSeries(k), N = HOLD[tf];
  for (const T of [1, 1.5, 2, 3]) {
    let win = 0, loss = 0, to = 0, sum = 0, n = 0, sumAtr = 0;
    for (let i = 1000; i + N < k.length; i++) {
      const e = num(k[i].close), atr = a[i]; if (!(atr > 0)) continue;
      const up = e + T * atr, dn = e - atr; let r: number | null = null;
      for (let j = i + 1; j <= i + N; j++) {
        const hi = num(k[j].high), lo = num(k[j].low);
        if (lo <= dn && hi >= up) { r = -atr; break; }        // ชนทั้งสองฝั่งในแท่งเดียว = นับเป็นแพ้
        if (hi >= up) { r = T * atr; break; }
        if (lo <= dn) { r = -atr; break; }
      }
      const exit = r == null ? num(k[i + N].close) - e : r;
      if (r == null) to++; else if (r > 0) win++; else loss++;
      sum += (exit / e) * 100 - COST; n++; sumAtr += (atr / e) * 100;
    }
    const atrPct = sumAtr / n, be = 1 / (1 + T) * 100, beCost = (1 + COST / atrPct) / (1 + T) * 100;
    console.log(`| ${tf} | ${T} | ${f2(T * atrPct, 2)}% / ${f2(atrPct, 2)}% | ${f2((win / n) * 100, 1)}% | ${f2((loss / n) * 100, 1)}% | ${f2((to / n) * 100, 1)}% | ${f2(sum / n, 3)}% | ${f2(be, 1)}% → **${f2(beCost, 1)}%** |`);
  }
}

console.log("\n# เข้าเฉพาะช่วง 13:00–17:00 UTC เทียบกับนอกช่วง (stop 1 ATR / เป้า 1.5 ATR)\n");
console.log("| tf | ช่วง | ไม้ | ถึงเป้าก่อน | กำไรเฉลี่ย/ไม้ | ATR% เฉลี่ยตอนเข้า |");
console.log("|---|---|---:|---:|---:|---:|");
for (const tf of TFS) {
  const k = load(tf), a = atrSeries(k), N = HOLD[tf], T = 1.5;
  for (const inSes of [true, false]) {
    let win = 0, sum = 0, n = 0, sumAtr = 0;
    for (let i = 1000; i + N < k.length; i++) {
      const h = new Date(k[i].openTime).getUTCHours();
      if ((h >= 13 && h < 17) !== inSes) continue;
      const e = num(k[i].close), atr = a[i]; if (!(atr > 0)) continue;
      const up = e + T * atr, dn = e - atr; let r: number | null = null;
      for (let j = i + 1; j <= i + N; j++) {
        const hi = num(k[j].high), lo = num(k[j].low);
        if (lo <= dn && hi >= up) { r = -atr; break; }
        if (hi >= up) { r = T * atr; break; }
        if (lo <= dn) { r = -atr; break; }
      }
      const exit = r == null ? num(k[i + N].close) - e : r;
      if (r != null && r > 0) win++;
      sum += (exit / e) * 100 - COST; n++; sumAtr += (atr / e) * 100;
    }
    console.log(`| ${tf} | ${inSes ? "13–17 UTC" : "นอกช่วง"} | ${n} | ${f2((win / n) * 100, 1)}% | ${f2(sum / n, 3)}% | ${f2(sumAtr / n, 3)}% |`);
  }
}
