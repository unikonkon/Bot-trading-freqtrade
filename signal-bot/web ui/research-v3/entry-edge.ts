/**
 * การทดสอบที่ชี้ขาด: จังหวะเข้ามีความได้เปรียบหรือไม่ โดยไม่เกี่ยวกับกฎการออก
 *
 * วัดผลตอบแทนล่วงหน้า N แท่งในทิศที่สัญญาณบอก เทียบกับค่าเฉลี่ยของทุกแท่งในทิศเดียวกัน
 * ถ้าค่านี้ไม่ต่างจากศูนย์ทั้ง train และ test แปลว่าไม่มีกฎการออกหรือขนาดไม้ใด
 * ที่จะทำให้กลยุทธ์เป็นบวกได้ เพราะต้นทุนเป็นค่าคงที่ที่หักจากศูนย์
 */
import { load, split, TFS, f2, tstat } from "./lib";
import { shortTradeV3 } from "../../../lib/indicators-v3-ShortTrade";
import { closes } from "../../../lib/indicators-v2";

const HORIZONS = [5, 10, 20, 40, 80];
for (const tf of TFS) {
  const all = load(tf);
  const { train, test } = split(all);
  console.log(`\n##### ${tf}`);
  for (const [label, w] of [["train", train], ["test", test]] as const) {
    const r = shortTradeV3(w.k, {}, w.start);
    const c = closes(w.k);
    const entries: { i: number; side: number }[] = [];
    for (let i = w.start; i < w.k.length; i++)
      if (r.signal[i] === "BUY" || r.signal[i] === "SHORT")
        entries.push({ i, side: r.signal[i] === "BUY" ? 1 : -1 });
    const parts: string[] = [];
    for (const N of HORIZONS) {
      // ผลตอบแทนในทิศที่เข้า เป็น % (ยังไม่หักต้นทุน)
      const xs = entries.filter(e => e.i + N < c.length)
        .map(e => (e.side * (c[e.i + N] - c[e.i]) / c[e.i]) * 100);
      // เส้นฐาน: ทุกแท่งในทิศเดียวกัน เพื่อหักผลของทิศทางตลาดโดยรวมออก
      const longShare = entries.length ? entries.filter(e => e.side === 1).length / entries.length : 0;
      const base: number[] = [];
      for (let i = w.start; i + N < c.length; i++) {
        const ret = ((c[i + N] - c[i]) / c[i]) * 100;
        base.push(longShare * ret + (1 - longShare) * -ret);
      }
      const s = tstat(xs), b = tstat(base);
      parts.push(`N=${String(N).padStart(3)}: ${f2(s.mean, 4).padStart(8)}% (t=${f2(s.t, 2).padStart(5)}) vs เส้นฐาน ${f2(b.mean, 4).padStart(8)}%`);
    }
    console.log(`  ${label} (${entries.length} จังหวะเข้า, ซื้อ ${entries.filter(e => e.side === 1).length})`);
    for (const p of parts) console.log(`    ${p}`);
  }
}
