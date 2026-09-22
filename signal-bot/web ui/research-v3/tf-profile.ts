/** โปรไฟล์เชิงสถิติของแต่ละ timeframe เพื่อใช้วางแผนเข้า-ออก (ไม่ผูกกับกลยุทธ์ใด) */
import { load, TFS, split, f2, tstat } from "./lib";
import type { KlineData } from "../../../lib/types/kline";

const num = (s: string) => parseFloat(s);
const MIN: Record<string, number> = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30 };

function atrSeries(k: KlineData[], p = 14) {
  const tr: number[] = [], out: number[] = new Array(k.length).fill(NaN);
  for (let i = 0; i < k.length; i++) {
    const h = num(k[i].high), l = num(k[i].low), pc = i ? num(k[i - 1].close) : num(k[i].open);
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    if (i >= p - 1) {
      let s = 0; for (let j = i - p + 1; j <= i; j++) s += tr[j];
      out[i] = s / p;
    }
  }
  return out;
}
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };

console.log("# โปรไฟล์ timeframe — BTCUSDT 17 ก.ย. 2025 – 17 ก.ย. 2026 (warm-up 1000 แท่ง)\n");

// ---------- 1) ขนาดแท่งเทียบต้นทุน ----------
console.log("## 1. ATR(14) เป็น % ของราคา และต้นทุนคิดเป็นกี่ ATR");
console.log("| tf | แท่ง | ATR% p25 | ATR% กลาง | ATR% p75 | ต้นทุน fut 0.16% = กี่ ATR | ต้นทุน spot 0.31% = กี่ ATR |");
console.log("|---|---:|---:|---:|---:|---:|---:|");
const store: Record<string, { k: KlineData[]; atrPct: number[]; ret: number[] }> = {};
for (const tf of TFS) {
  const k = load(tf), a = atrSeries(k);
  const atrPct: number[] = [], ret: number[] = [];
  for (let i = 1000; i < k.length; i++) { atrPct.push((a[i] / num(k[i].close)) * 100); ret.push((num(k[i].close) / num(k[i - 1].close) - 1) * 100); }
  store[tf] = { k, atrPct, ret };
  const m = q(atrPct, 0.5);
  console.log(`| ${tf} | ${k.length - 1000} | ${f2(q(atrPct, .25), 3)} | **${f2(m, 3)}** | ${f2(q(atrPct, .75), 3)} | ${f2(0.16 / m, 2)} | ${f2(0.31 / m, 2)} |`);
}

// ---------- 2) โครงสร้างผลตอบแทน: momentum หรือ reversion ----------
console.log("\n## 2. ผลตอบแทนแท่งถัดไปสัมพันธ์กับแท่งปัจจุบันอย่างไร (train / test)");
console.log("| tf | สหสัมพันธ์ lag-1 train | test | P(แท่งถัดไปทิศเดียวกัน) train | test |");
console.log("|---|---:|---:|---:|---:|");
for (const tf of TFS) {
  const { k } = store[tf], { train, test } = split(k);
  const seg = (kk: KlineData[], s: number, e: number) => {
    const r: number[] = [];
    for (let i = s; i < e; i++) r.push(num(kk[i].close) / num(kk[i - 1].close) - 1);
    let sameSign = 0, n = 0;
    for (let i = 1; i < r.length; i++) { if (r[i] !== 0 && r[i - 1] !== 0) { n++; if (Math.sign(r[i]) === Math.sign(r[i - 1])) sameSign++; } }
    const mu = r.reduce((a, b) => a + b, 0) / r.length;
    let c = 0, v = 0;
    for (let i = 1; i < r.length; i++) c += (r[i] - mu) * (r[i - 1] - mu);
    for (let i = 0; i < r.length; i++) v += (r[i] - mu) ** 2;
    return { ac: c / v, same: (sameSign / n) * 100, n };
  };
  const a = seg(train.k, train.start, train.k.length), b = seg(test.k, test.start, test.k.length);
  console.log(`| ${tf} | ${f2(a.ac, 4)} | ${f2(b.ac, 4)} | ${f2(a.same, 1)}% | ${f2(b.same, 1)}% |`);
}

// ---------- 3) MFE / MAE หลังเข้าแบบสุ่ม ----------
console.log("\n## 3. ระยะที่ราคาวิ่งได้จริงหลังเข้าไม้ N แท่ง (หน่วย ATR, ค่ากลางของทุกแท่ง, ทิศขึ้น)");
console.log("| tf | N | MFE กลาง | MAE กลาง | MFE p75 | P(MFE≥1ATR) | P(แตะ +1ATR ก่อน −1ATR) |");
console.log("|---|---:|---:|---:|---:|---:|---:|");
for (const tf of TFS) {
  const { k } = store[tf], a = atrSeries(k);
  for (const N of [5, 10, 20, 40]) {
    const mfe: number[] = [], mae: number[] = []; let winFirst = 0, decided = 0;
    for (let i = 1000; i + N < k.length; i++) {
      const e = num(k[i].close), atr = a[i]; if (!(atr > 0)) continue;
      let up = 0, dn = 0, first = 0;
      for (let j = i + 1; j <= i + N; j++) {
        up = Math.max(up, (num(k[j].high) - e) / atr); dn = Math.min(dn, (num(k[j].low) - e) / atr);
        if (!first) { if (up >= 1 && dn <= -1) first = -1; else if (up >= 1) first = 1; else if (dn <= -1) first = -1; }
      }
      mfe.push(up); mae.push(dn);
      if (first) { decided++; if (first > 0) winFirst++; }
    }
    const hit = mfe.filter(x => x >= 1).length / mfe.length * 100;
    console.log(`| ${tf} | ${N} | ${f2(q(mfe, .5), 2)} | ${f2(q(mae, .5), 2)} | ${f2(q(mfe, .75), 2)} | ${f2(hit, 1)}% | ${decided ? f2((winFirst / decided) * 100, 1) : "-"}% |`);
  }
}

// ---------- 4) กี่แท่งกว่าราคาจะวิ่งเกินต้นทุน ----------
console.log("\n## 4. จำนวนแท่ง (และนาที) กว่าราคาจะวิ่งเกินต้นทุนไป-กลับ นับจากราคาปิด");
console.log("| tf | ค่ากลาง fut 0.16% | p75 | ค่ากลาง spot 0.31% | p75 |");
console.log("|---|---|---|---|---|");
for (const tf of TFS) {
  const { k } = store[tf];
  const bars = (cost: number) => {
    const out: number[] = [];
    for (let i = 1000; i < k.length - 1; i++) {
      const e = num(k[i].close); let n = 0;
      for (let j = i + 1; j < Math.min(k.length, i + 400); j++) {
        n = j - i;
        if ((num(k[j].high) - e) / e * 100 >= cost || (e - num(k[j].low)) / e * 100 >= cost) break;
      }
      out.push(n);
    }
    return out;
  };
  const f = bars(0.16), s = bars(0.31);
  const fmt = (b: number) => `${b} แท่ง (${b * MIN[tf]} น.)`;
  console.log(`| ${tf} | ${fmt(q(f, .5))} | ${fmt(q(f, .75))} | ${fmt(q(s, .5))} | ${fmt(q(s, .75))} |`);
}

// ---------- 5) ชั่วโมงของวัน ----------
console.log("\n## 5. ช่วงเวลาของวัน (วัดบนแท่ง 5m ตลอดปี)");
{
  const { k } = store["5m"];
  const rng = new Array(24).fill(0), vol = new Array(24).fill(0), cnt = new Array(24).fill(0);
  for (let i = 1000; i < k.length; i++) {
    const h = new Date(k[i].openTime).getUTCHours();
    rng[h] += (num(k[i].high) - num(k[i].low)) / num(k[i].close) * 100; vol[h] += num(k[i].quoteAssetVolume); cnt[h]++;
  }
  const avgR = rng.map((x, i) => x / cnt[i]), totV = vol.reduce((a, b) => a + b, 0);
  const mean = avgR.reduce((a, b) => a + b, 0) / 24;
  console.log("| ชม. UTC | ชม. ไทย | ช่วงราคาเฉลี่ย/แท่ง | เทียบค่าเฉลี่ยทั้งวัน | ส่วนแบ่ง volume |");
  console.log("|---|---|---:|---:|---:|");
  for (let h = 0; h < 24; h++)
    console.log(`| ${String(h).padStart(2, "0")} | ${String((h + 7) % 24).padStart(2, "0")} | ${f2(avgR[h], 4)}% | ${f2((avgR[h] / mean) * 100, 0)}% | ${f2((vol[h] / totV) * 100, 1)}% |`);
}

// ---------- 6) ต้นทุนสะสมตามความถี่ ----------
console.log("\n## 6. ภาระต้นทุนต่อปีตามจำนวนไม้ต่อวัน (ไป-กลับ)");
console.log("| ไม้/วัน | ไม้/ปี | fut taker 0.16% | fut maker 0.07% | spot 0.31% |");
console.log("|---:|---:|---:|---:|---:|");
for (const n of [1, 2, 5, 10, 20, 50]) {
  const y = n * 365;
  console.log(`| ${n} | ${y} | ${f2(y * 0.16, 0)}% | ${f2(y * 0.07, 0)}% | ${f2(y * 0.31, 0)}% |`);
}
