/** เวลาที่ราคาใช้จริงกว่าจะเดินทางถึงระยะ stop ที่ต้นทุนบังคับ (วัดบนแท่ง 1 นาที) */
import { load, f2 } from "./lib";
const num = (s: string) => parseFloat(s);
const k = load("1m");
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
console.log("| ระยะ (ไป-กลับของต้นทุน × 5) | ค่ากลาง | p75 | p90 | ถึงภายใน 1 ชม. |");
console.log("|---|---:|---:|---:|---:|");
const CAP = 60 * 24 * 3;
for (const [label, pct] of [["0.35% (maker 0.07%)", 0.35], ["0.80% (fut taker 0.16%)", 0.80], ["1.55% (spot 0.31%)", 1.55]] as const) {
  const mins: number[] = [];
  for (let i = 1000; i < k.length - 1; i += 7) {   // สุ่มทุก 7 แท่งเพื่อลดการซ้อนทับ
    const e = num(k[i].close); let n = CAP;
    for (let j = i + 1; j < Math.min(k.length, i + CAP); j++) {
      if ((num(k[j].high) - e) / e * 100 >= pct || (e - num(k[j].low)) / e * 100 >= pct) { n = j - i; break; }
    }
    mins.push(n);
  }
  const hr = (m: number) => m >= 60 ? `${f2(m / 60, 1)} ชม.` : `${m} น.`;
  console.log(`| ${label} | ${hr(q(mins, .5))} | ${hr(q(mins, .75))} | ${hr(q(mins, .9))} | ${f2(mins.filter(m => m <= 60).length / mins.length * 100, 0)}% |`);
}
