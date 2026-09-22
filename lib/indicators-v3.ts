/**
 * indicators-v3.ts — กลยุทธ์เวอร์ชัน 3 ทั้งหมดในไฟล์เดียว
 *
 * ไฟล์นี้มีสี่ส่วน เรียงตามลำดับที่ควรอ่าน
 *   1) สัญญาของผลลัพธ์ — ชนิด `V3Result` ที่กลยุทธ์ v3 ทุกตัวต้องคืน
 *   2) ตระกูล OrderFlow — กลยุทธ์เดียวที่ผ่านการวัดแล้วเป็นบวก (ดูหัวข้อถัดไป)
 *   3) ตระกูล TradePlan — ชั้นแผนเทรดที่บังคับข้อจำกัดเรื่องต้นทุนกับแหล่งสัญญาณใดก็ได้
 *   4) ทะเบียน `V3_REGISTRY` — จุดต่อขยายเดียวที่ระบบทั้งหมดอ่านค่าจากมัน
 *
 * ═══ ทำไมสัญญาณมาจาก order flow ไม่ใช่รูปแบบราคา ══════════════════════════
 * ตระกูลสัญญาณ SMC เดิม (ShortTrade V3) วัดแล้วว่า **ไม่มีข้อมูลเชิงทิศทางเลย**
 * ผลตอบแทนล่วงหน้า 5–80 แท่งในทิศที่สัญญาณบอก มีค่า t ระหว่าง −2.15 ถึง +2.10
 * และสลับเครื่องหมายระหว่างช่วง train กับ test ทุกครั้ง เมื่อจังหวะเข้าไม่มีความ
 * ได้เปรียบ ไม่มีกฎการออกหรือขนาดไม้ใดทำให้เป็นบวกได้ จึงถอดออกจากทะเบียน
 * และเปลี่ยน "ที่มาของสัญญาณ" แทนการปรับค่าของสัญญาณเดิม
 * (อินดิเคเตอร์ตัวนั้นย้ายไปเป็นเส้นฐานงานวิจัยที่
 *  `signal-bot/web ui/research-v3/shorttrade-baseline.ts` รายละเอียดอยู่ในเอกสารหัวข้อ 7)
 *
 * ข้อมูลที่ใช้คือ `takerBuyBaseVolume` ซึ่งมีอยู่ในทุกแท่งอยู่แล้วแต่ไม่เคยถูกใช้:
 * ปริมาณที่ฝั่งซื้อเป็นผู้เคาะราคา เทียบกับปริมาณทั้งหมด บอกว่าใครเป็นฝ่ายเร่ง
 *
 * ═══ สัญญาณ ═════════════════════════════════════════════════════════════
 *   ofi(t) = Σ(2·takerBuyBase − volume) / Σ(volume)   ย้อนหลัง lookbackDays วัน
 *   signal(t) = ofi(t) − ค่าเฉลี่ยเคลื่อนที่ของ ofi เอง debiasDays วัน
 *
 * การลบค่าเฉลี่ยของตัวเองเป็นส่วนที่ขาดไม่ได้ ไม่ใช่การตกแต่ง: วัดบน BTCUSDT
 * เต็มปีได้ค่าเฉลี่ยของ ofi = −0.0191 ไม่ใช่ศูนย์ ถ้าไม่ลบออก กลยุทธ์จะถือฝั่งขาย
 * 51–57% ของเวลาเทียบกับฝั่งซื้อ 25–35% ซึ่งทำกำไรได้เพราะปีที่ทดสอบเป็นขาลง
 * ไม่ใช่เพราะทำนายถูก หลังลบค่าเฉลี่ยแล้วสัดส่วนเวลาถือกลับมาสมดุล (ซื้อ 40% / ขาย 41%)
 * และยังให้ผลบวกทั้งสองช่วง
 *
 * ═══ หลักฐานที่ใช้เลือกค่า ═══════════════════════════════════════════════
 * เลือกค่าจาก BTCUSDT ช่วง train (ถึง 17 พ.ค. 2026) เท่านั้น
 *  • ย้อนหลัง 5 วัน เป็นบวกทั้ง train และ test ครบทั้ง 5 timeframe และทั้ง 3 ค่า band
 *    (15 จาก 15 ช่อง) ส่วน 12 วันเป็น train บวกแต่ test ลบทุกช่อง คือโซน overfit
 *    จึงเลือก 5 วันเพราะเป็นกลางของพื้นที่ที่เป็นบวกต่อเนื่อง ไม่ใช่เพราะให้ค่าสูงสุด
 *  • ทดสอบข้ามเหรียญที่ไม่เคยถูกใช้เลือกค่าเลย (ETH / SOL / BNB / XRP)
 *    พอร์ตแบ่งทุนเท่ากันเป็นบวกทั้งสองช่วง ทุก band ทั้ง 15m และ 30m (6 จาก 6)
 *
 * ═══ ข้อจำกัดที่ต้องรู้ก่อนใช้ ═══════════════════════════════════════════
 * • **ยังไม่มีนัยสำคัญทางสถิติ** ค่า t ของพอร์ตอยู่ที่ 0.15–1.59 จากข้อมูลหนึ่งปี
 *   ผลที่วัดได้สอดคล้องกันหลายมิติ แต่ยังไม่พอจะสรุปว่าเป็นความได้เปรียบถาวร
 * • **ไม่มีฝั่งใดเป็นบวกทั้งสองช่วงเวลา** ฝั่งขายทำกำไรทั้งหมดในช่วงตลาดลง
 *   และฝั่งซื้อทำกำไรทั้งหมดในช่วงตลาดขึ้น รหัสฝั่งเดียวจึงเป็นเครื่องมือวินิจฉัย
 *   ไม่ใช่ตัวที่ควรนำไปใช้ (เอกสารหัวข้อ 8.7)
 * • ผลรายเหรียญไม่สม่ำเสมอ — XRP ขาดทุนตลอดชุด ส่วน ETH แทบเสมอตัว
 *   **ต้องกระจายหลายเหรียญ** ผลของเหรียญเดียวมีความผันผวนสูงเกินกว่าจะพึ่งได้
 * • drawdown ของพอร์ตอยู่ที่ 14–18% ซึ่งสูงเมื่อเทียบกับผลตอบแทน
 * • ต้องมีข้อมูลย้อนหลังราว flowLookbackDays + flowDebiasDays (ค่าตั้งต้น = 125 วัน)
 *   ก่อนจึงจะเริ่มให้สัญญาณ ช่วงก่อนหน้านั้นจะเป็นสถานะว่างและบอกเหตุผลไว้
 * • ใช้ taker volume ของตลาด Spot ส่วนการเปิด Short ต้องทำบน perpetual futures
 *   ซึ่งมี order flow คนละชุด
 * • ถือสถานะเฉลี่ยหลายวัน จึงเป็นกลยุทธ์ swing ที่ใช้แท่ง 15m/30m เป็นตัวสุ่มสัญญาณ
 *   ไม่ใช่การเทรดรายวัน
 */
import type { KlineData } from "@/lib/types/kline";
import { atr, ema, closes, type Series } from "@/lib/indicators-v2";

// ══ 1) สัญญาของผลลัพธ์ ═════════════════════════════════════════
/** สัญญาณของ v3 รองรับสองทาง: เปิด/ปิด ทั้งฝั่งซื้อและฝั่งขาย */
export type V3Signal = "BUY" | "SELL" | "SHORT" | "COVER" | null;

/**
 * รูปแบบผลลัพธ์ที่กลยุทธ์ v3 ทุกตัวต้องคืน ไม่ว่าจะใช้สัญญาณจากแหล่งใด
 *
 * ช่องบังคับมีเฉพาะที่ทุกกลยุทธ์มีค่าจริง — เวอร์ชันก่อนมีอีก 14 ช่อง (stop, target, rsi,
 * adx, แนวรับ/ต้าน ฯลฯ) ที่ตกทอดมาจากตระกูล SMC และเป็น null ทุกแท่งตลอดกาล
 * ซึ่งถูกเขียนลงไฟล์ Export เป็นคอลัมน์ว่างเปล่า จึงตัดออกทั้งหมด
 *
 * ช่องของการจัดการไม้ (`stop` ลงไป) กลับมาพร้อมตระกูล TradePlan ซึ่งใช้ stop ตามราคาจริง
 * และประกาศเป็น **ช่องทางเลือก**: กลยุทธ์ที่ไม่มี stop ตามราคา (OrderFlow) จะไม่ใส่ค่าเลย
 * จึงไม่มีคอลัมน์ว่างเปล่าโผล่ในไฟล์ Export ของมัน ซึ่งเป็นเหตุผลเดิมที่ตัดช่องพวกนี้ออกไป
 */
export interface V3Result {
  /**
   * สัดส่วนพอร์ตเป้าหมายรายแท่ง: บวก = ถือซื้อ, ลบ = ถือขาย, 0 = ว่าง
   * ตัวจำลอง simulateExposure อ่านค่านี้เป็นหลัก ไม่ได้อ่านจาก signal
   */
  exposure: number[];
  /** สัญญาณสำหรับแสดงผลและสำหรับบอทสัญญาณ */
  signal: V3Signal[];
  /** เหตุผลรายแท่ง ใช้ตรวจว่าทำไมเข้าหรือไม่เข้า */
  reason: string[];
  regime: ("warmup" | "range" | "uptrend" | "downtrend")[];
  /** ทิศของสถานะที่ถืออยู่: 1 = ซื้อ, -1 = ขาย, 0 = ว่าง */
  direction: number[];
  /** ขนาดไม้ที่ใช้จริง (สัดส่วนพอร์ต 0–1) */
  size: Series;
  /** คะแนนความมั่นใจ 0–1 */
  confidence: Series;
  /** ค่าสัญญาณหลักของกลยุทธ์รายแท่ง (OrderFlow = แรงซื้อขายสุทธิหลังลบอคติ) */
  signalValue: Series;
  atr: Series;
  fastEMA: Series;
  trendEMA: Series;
  /** ชั่วโมง UTC ของแท่ง */
  utcHour: Series;
  /** timeframe ที่ตรวจพบ (นาที) และหน้าต่างที่แปลงจากวันเป็นจำนวนแท่งแล้ว */
  timeframeMinutes: number;
  resolvedLookbackBars: number;
  resolvedDebiasBars: number;

  // ── ช่องของการจัดการไม้ มีเฉพาะกลยุทธ์ที่ใช้ stop ตามราคา (ตระกูล TradePlan) ──
  /** ราคาตัดขาดทุนของสถานะที่ถืออยู่ (null เมื่อว่าง) */
  stop?: Series;
  /** ราคาเป้าหมายของสถานะที่ถืออยู่ */
  target?: Series;
  /** ระยะ stop เป็น % ของราคาเข้า = 1R ของไม้นั้น */
  riskPct?: Series;
  /** ถือมาแล้วกี่แท่ง */
  holdBars?: Series;
  /** ATR% ปัจจุบันเป็นกี่เท่าของค่าปกติของตัวเอง — ด่านความผันผวนที่ใช้แทนตัวกรองเวลา */
  volRatio?: Series;
}

/**
 * อ่านระยะห่างเวลาระหว่างแท่งแล้วคืนเป็นจำนวนนาที
 * ใช้ค่ามัธยฐานเพื่อไม่ให้ช่วงข้อมูลขาดหายทำให้อ่านผิด
 * คืน 0 เมื่อข้อมูลน้อยเกินกว่าจะสรุปได้ ซึ่งจะทำให้ใช้ค่าสำรองแทน
 */
export function detectTimeframeMinutes(k: KlineData[]): number {
  if (k.length < 3) return 0;
  const gaps: number[] = [];
  const sampleTo = Math.min(k.length - 1, 200);
  for (let i = 1; i <= sampleTo; i++) {
    const gap = k[i].openTime - k[i - 1].openTime;
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] / 60000;
}

// ══ 2) ตระกูล OrderFlow ════════════════════════════════════════
export const ORDER_FLOW_V3_DEFAULTS = {
  /** 1 = อนุญาตฝั่งซื้อ, 0 = ปิด */
  allowLong: 1,
  /** 1 = อนุญาตฝั่งขาย (ต้องเทรดบน futures), 0 = ปิด */
  allowShort: 1,
  /** สะสมแรงซื้อขายสุทธิย้อนหลังกี่วัน */
  flowLookbackDays: 5,
  /** ลบค่าเฉลี่ยของตัวเองย้อนหลังกี่วัน เพื่อไม่ให้มีอคติไปข้างเดียวถาวร */
  flowDebiasDays: 120,
  /** ระดับที่ถือว่าแรงพอจะเข้า */
  flowBand: 0.01,
  /**
   * ออกเป็นสถานะว่างเมื่อค่าสัญญาณกลับเข้ามาถึงกี่เท่าของ `flowBand`
   *
   * เป็นครอบครัวต่อเนื่องค่าเดียวที่ครอบกฎการออกทุกแบบ ตั้งแต่ไวที่สุดถึงช้าที่สุด
   *   +1   = ออกทันทีที่ค่าหลุดเกณฑ์เข้า
   *   +0.5 = ออกที่ครึ่งเกณฑ์ (ค่าตั้งต้นเดิมและยังเป็นค่าตั้งต้นอยู่)
   *    0   = ออกเมื่อค่าข้ามศูนย์
   *   −1   = ไม่ออกเป็นสถานะว่างเลย ถือจนกว่าจะกลับข้างเต็มเกณฑ์
   *
   * ค่านี้เป็นพารามิเตอร์ตัวเดียวที่แยกรหัส `orderflow_v3` ออกจาก `orderflow_v3_hold`
   * หลักฐานที่ใช้เลือกอยู่ใน `research-v3/flow-exit-select.ts` และเอกสาร
   * `trade-planning-1m-30m-th.md` หัวข้อ 10
   */
  flowExitMult: 0.5,
  /** ขนาดไม้เป็น % ของพอร์ต */
  flowSizePct: 100,
  /** ช่วง ATR ที่ใช้รายงานความผันผวนอ้างอิง (ไม่ใช่ stop จริง) */
  atrPeriod: 14,
  /** EMA ที่ใช้แสดงผลเท่านั้น */
  fastPeriod: 21,
  trendPeriod: 55,
};
export type OrderFlowV3Params = typeof ORDER_FLOW_V3_DEFAULTS;

/**
 * แรงซื้อขายสุทธิสะสม L แท่ง เป็นสัดส่วนของปริมาณทั้งหมดในหน้าต่างเดียวกัน
 * ค่า +1 = ฝั่งซื้อเคาะทั้งหมด, −1 = ฝั่งขายเคาะทั้งหมด, 0 = สมดุล
 */
export function orderFlowImbalance(k: KlineData[], L: number): Series {
  const n = k.length;
  const out: Series = new Array(n).fill(null);
  if (L < 1) return out;
  let signed = 0, total = 0;
  const signedAt = (i: number) => 2 * +k[i].takerBuyBaseVolume - +k[i].volume;
  for (let i = 0; i < n; i++) {
    signed += signedAt(i);
    total += +k[i].volume;
    if (i >= L) { signed -= signedAt(i - L); total -= +k[i - L].volume; }
    if (i >= L - 1 && total > 0) out[i] = signed / total;
  }
  return out;
}

/** ลบค่าเฉลี่ยเคลื่อนที่ M ค่าล่าสุดของตัวเองออก ใช้เฉพาะค่าที่เกิดขึ้นแล้ว */
export function removeOwnMean(x: Series, M: number): Series {
  const n = x.length;
  const out: Series = new Array(n).fill(null);
  if (M < 1) return x.slice();
  const window: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (v !== null) {
      window.push(v); sum += v;
      if (window.length > M) sum -= window.shift()!;
      if (window.length === M) out[i] = v - sum / M;
    }
  }
  return out;
}

export function orderFlowV3(
  k: KlineData[],
  overrides: Partial<OrderFlowV3Params> | Record<string, number> = {},
  startIndex = 0,
): V3Result {
  const p = { ...ORDER_FLOW_V3_DEFAULTS, ...overrides } as OrderFlowV3Params;
  for (const [key, v] of Object.entries(p))
    // flowExitMult เป็นค่าเดียวที่ติดลบได้ เพราะ −1 คือ "ไม่ออกจนกว่าจะกลับข้าง"
    if (!Number.isFinite(v) || (v < 0 && key !== "flowExitMult"))
      throw new Error(`Invalid OrderFlow V3 parameter: ${key}`);
  if (p.flowLookbackDays <= 0 || p.flowDebiasDays <= 0)
    throw new Error("OrderFlow V3 requires positive lookback and debias windows");
  if (p.flowLookbackDays >= p.flowDebiasDays)
    throw new Error("OrderFlow V3 requires flowLookbackDays < flowDebiasDays");
  if (p.flowBand <= 0 || p.flowBand >= 1)
    throw new Error("OrderFlow V3 requires 0 < flowBand < 1");
  if (p.flowExitMult > 1 || p.flowExitMult < -1)
    throw new Error("OrderFlow V3 requires -1 <= flowExitMult <= 1");
  if (p.flowSizePct <= 0 || p.flowSizePct > 100)
    throw new Error("OrderFlow V3 requires 0 < flowSizePct <= 100");
  if (p.allowLong < 0.5 && p.allowShort < 0.5)
    throw new Error("OrderFlow V3 requires at least one direction enabled");
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > k.length)
    throw new Error("Invalid OrderFlow V3 startIndex");

  const n = k.length;
  const c = closes(k);
  const tfMinutes = detectTimeframeMinutes(k);
  const perDay = tfMinutes > 0 ? 1440 / tfMinutes : 1;
  const L = Math.max(1, Math.round(p.flowLookbackDays * perDay));
  const M = Math.max(2, Math.round(p.flowDebiasDays * perDay));

  const flow = removeOwnMean(orderFlowImbalance(k, L), M);
  const size = p.flowSizePct / 100;
  const exit = p.flowBand * p.flowExitMult;

  const blank = (): Series => new Array(n).fill(null);
  const r: V3Result = {
    exposure: new Array(n).fill(0),
    signal: new Array(n).fill(null) as V3Signal[],
    reason: new Array(n).fill("รอสะสมแรงซื้อขายสุทธิให้ครบหน้าต่าง"),
    regime: new Array(n).fill("warmup"),
    direction: new Array(n).fill(0),
    size: blank(),
    confidence: blank(),
    signalValue: flow,
    atr: atr(k, Math.max(2, Math.round(p.atrPeriod))),
    fastEMA: ema(c, Math.max(2, Math.round(p.fastPeriod))),
    trendEMA: ema(c, Math.max(3, Math.round(p.trendPeriod))),
    utcHour: blank(),
    timeframeMinutes: tfMinutes,
    resolvedLookbackBars: L,
    resolvedDebiasBars: M,
  };

  let dir = 0;
  for (let i = 0; i < n; i++) {
    r.utcHour[i] = new Date(k[i].openTime).getUTCHours();
    const v = flow[i];
    if (v === null) { dir = 0; continue; }
    r.regime[i] = v > 0 ? "uptrend" : v < 0 ? "downtrend" : "range";
    if (i < startIndex) { r.reason[i] = "warmup (no position)"; dir = 0; continue; }

    const prev = dir;
    if (dir === 0) {
      if (v > p.flowBand && p.allowLong >= 0.5) dir = 1;
      else if (v < -p.flowBand && p.allowShort >= 0.5) dir = -1;
    } else if (dir === 1 && v < exit) {
      dir = v < -p.flowBand && p.allowShort >= 0.5 ? -1 : 0;
    } else if (dir === -1 && v > -exit) {
      dir = v > p.flowBand && p.allowLong >= 0.5 ? 1 : 0;
    }

    r.direction[i] = dir;
    r.exposure[i] = dir * size;
    if (dir !== 0) { r.size[i] = size; r.confidence[i] = Math.min(1, Math.abs(v) / (p.flowBand * 4)); }
    const pct = (v * 100).toFixed(2);
    if (dir !== prev) {
      if (prev !== 0 && dir === 0) {
        r.signal[i] = prev === 1 ? "SELL" : "COVER";
        r.reason[i] = `ออก: แรงซื้อขายสุทธิอ่อนลงเหลือ ${pct}%`;

      } else {
        r.signal[i] = dir === 1 ? "BUY" : "SHORT";
        r.reason[i] = `${dir === 1 ? "ซื้อ" : "ขาย"}: แรงซื้อขายสุทธิ ${pct}% ${dir === 1 ? "เกิน" : "ต่ำกว่า"}เกณฑ์`;
      }
    } else {
      r.reason[i] = dir === 0
        ? `ว่าง: แรงซื้อขายสุทธิ ${pct}% ยังไม่ถึงเกณฑ์`
        : `ถือ${dir === 1 ? "ซื้อ" : "ขาย"}: แรงซื้อขายสุทธิ ${pct}%`;
    }
  }
  return r;
}

export const ORDER_FLOW_RULE_TH =
  "OrderFlow V3 เทรดสองทางโดยใช้แรงซื้อขายสุทธิ (order-flow imbalance) จากคอลัมน์ takerBuyBaseVolume " +
  "ซึ่งมีอยู่ในทุกแท่งแต่กลยุทธ์อื่นในโปรเจกต์นี้ไม่เคยใช้. " +
  "สัญญาณ: ofi = ผลรวม(2 x takerBuyBase - volume) หารด้วย ผลรวม(volume) ย้อนหลัง flowLookbackDays วัน " +
  "แล้วลบค่าเฉลี่ยเคลื่อนที่ของ ofi เอง flowDebiasDays วันออก. " +
  "การลบค่าเฉลี่ยเป็นส่วนที่ขาดไม่ได้ เพราะวัดบน BTCUSDT เต็มปีได้ค่าเฉลี่ยของ ofi = -0.0191 ไม่ใช่ศูนย์ " +
  "ถ้าไม่ลบออก กลยุทธ์จะถือฝั่งขาย 51-57% ของเวลาเทียบกับฝั่งซื้อ 25-35% " +
  "แล้วทำกำไรเพราะปีที่ทดสอบเป็นขาลง ไม่ใช่เพราะทำนายถูก. " +
  "เข้าเมื่อค่าสัญญาณเกิน flowBand (ซื้อ) หรือต่ำกว่า -flowBand (ขาย) " +
  "ออกเป็นสถานะว่างเมื่อค่ากลับเข้ามาถึง flowExitMult เท่าของเกณฑ์ และกลับข้างทันทีเมื่อค่าข้ามไปอีกฝั่งเต็มเกณฑ์. " +
  "ไม่มี stop loss ตามราคา เพราะสัญญาณเป็นตัวกำหนดการออกทั้งหมด. " +
  "ค่าทุกตัวเลือกจาก BTCUSDT ช่วงก่อน 17 พ.ค. 2026 เท่านั้น: ย้อนหลัง 5 วันเป็นบวกทั้งช่วงเลือกค่าและช่วงทดสอบ " +
  "ครบทั้ง 5 timeframe และทั้ง 3 ค่า band (15/15 ช่อง) ส่วน 12 วันเป็นบวกเฉพาะช่วงเลือกค่าแต่ติดลบทุกช่องในช่วงทดสอบ. " +
  "ทดสอบข้ามเหรียญที่ไม่เคยถูกใช้เลือกค่า (ETH/SOL/BNB/XRP) พอร์ตแบ่งทุนเท่ากันเป็นบวกทั้งสองช่วง ทุก band ทั้ง 15m และ 30m. " +
  "ข้อจำกัด: ยังไม่มีนัยสำคัญทางสถิติ (t ของพอร์ต 0.15-1.59 จากข้อมูลหนึ่งปี); " +
  "ไม่มีฝั่งใดเป็นบวกทั้งสองช่วงเวลา ฝั่งขายทำกำไรทั้งหมดในช่วงตลาดลงและฝั่งซื้อทำกำไรทั้งหมดในช่วงตลาดขึ้น; " +
  "ผลรายเหรียญไม่สม่ำเสมอ XRP ขาดทุนตลอดชุดและ ETH แทบเสมอตัว จึงต้องกระจายหลายเหรียญ; " +
  "drawdown ของพอร์ต 14-18%; ต้องมีข้อมูลย้อนหลังราว flowLookbackDays + flowDebiasDays วันก่อนเริ่มให้สัญญาณ; " +
  "ใช้ taker volume ของตลาด Spot ขณะที่การเปิด Short ต้องทำบน perpetual futures ซึ่งมี order flow คนละชุด; " +
  "ถือสถานะเฉลี่ยหลายวัน จึงเป็นกลยุทธ์ swing ที่ใช้แท่ง 15m/30m เป็นตัวสุ่มสัญญาณ ไม่ใช่การเทรดรายวัน";

// ══ 3) ตระกูล TradePlan — ชั้นแผนเทรดที่ครอบแหล่งสัญญาณใดก็ได้ ═══
/**
 * ═══ ทำไมต้องมีชั้นนี้ ═══════════════════════════════════════════════════
 * เอกสาร `trade-planning-1m-30m-th.md` วัดบน BTCUSDT เต็มปีทั้ง 5 timeframe แล้วพบว่า
 * **ต้นทุนเป็นตัวกำหนดรูปร่างของแผน ก่อนที่สัญญาณจะมีสิทธิ์พูด** ตัวเลขที่บังคับโครงสร้าง:
 *
 *  • เข้าไม้แบบสุ่มทุกแท่งตลอดปี ได้กำไรเฉลี่ย −0.16% ต่อไม้พอดีทุก timeframe และทุก
 *    อัตราส่วนเป้า/stop คือผลตอบแทนก่อนต้นทุนเท่ากับศูนย์เป๊ะ เหลือแต่ต้นทุนล้วน ๆ
 *  • ที่ stop 1 ATR / เป้า 1 ATR บน 1m ต้องชนะ **182%** ของไม้จึงเสมอตัว ซึ่งไม่มีอยู่จริง
 *    แผนแบบนั้นตายตั้งแต่ก่อนมีสัญญาณ ไม่ใช่เพราะสัญญาณไม่ดี
 *  • เมื่อบังคับให้ stop ยาว ≥ 5 เท่าของต้นทุนไป–กลับ อัตราชนะที่ต้องได้จะเท่ากันทุก
 *    timeframe (48% ที่ 1.5R · 40% ที่ 2R · 30% ที่ 3R) เพราะต้นทุนถูกกลืนเข้าไปในนิยามของ R
 *  • งบต้นทุนคือเพดานจำนวนไม้: ยอมให้ค่าธรรมเนียมกิน 20% ต่อปี = 125 ไม้/ปี ที่ futures taker
 *  • ตัวกรองเวลาไม่ได้เพิ่มความแม่นของทิศทาง (เข้าช่วง 13–17 UTC ถึงเป้า 41.3% เทียบกับ
 *    นอกช่วง 41.9% บน 1m) สิ่งที่มันให้คือ ATR ที่ใหญ่ขึ้น **จึงกรองด้วย ATR% เทียบค่าปกติ
 *    ของตัวเอง ไม่ใช่กรองด้วยนาฬิกา**
 *
 * ชั้นนี้จึงไม่ใช่กลยุทธ์ แต่เป็น "กฎของแผน" ที่บังคับข้อจำกัดเหล่านั้นกับแหล่งสัญญาณใดก็ได้
 * แหล่งสัญญาณบอกแค่ทิศ ส่วนขนาด stop เป้าหมาย ความถี่ และเวลาถือมาจากชั้นนี้ทั้งหมด
 * ประโยชน์ที่ตรวจสอบได้: เปลี่ยนแหล่งสัญญาณแล้ววัดซ้ำได้ทันทีโดยกฎการออกไม่เปลี่ยน
 * จึงแยกได้ว่าผลต่างมาจากสัญญาณ ไม่ใช่จากการจัดการไม้
 *
 * ═══ สิ่งที่ชั้นนี้ไม่ได้ทำ ═══════════════════════════════════════════════
 * ชั้นนี้ **ไม่สร้างความได้เปรียบ** มันบังคับได้แค่ว่าแผนจะไม่ตายด้วยเลขคณิตของต้นทุน
 * ถ้าแหล่งสัญญาณไม่รู้ทิศทาง ผลลัพธ์จะยังเป็นลบ เพียงแต่ลบช้าลงเพราะเทรดน้อยลง
 * (เอกสาร v3 หัวข้อ 6.3: เมื่อกำไรต่อไม้เป็นศูนย์ ตัวกรองใดก็ตามที่ลดจำนวนไม้จะ "ดูดีเสมอ")
 *
 * ═══ สถานะ: วัดแล้ว ไม่ผ่าน จึงยังไม่อยู่ในทะเบียน ═══════════════════════
 * `research-v3/tradeplan-eval.ts` วัดบน BTCUSDT เต็มปีแล้ว ผลอยู่ใน
 * `trade-planning-1m-30m-th.md` หัวข้อ 9 สรุปสามข้อ
 *
 *  1) **จังหวะเข้าของทั้งสองแหล่งไม่มีข้อมูลเชิงทิศทาง** ผลตอบแทนล่วงหน้า 20–80 แท่ง
 *     สลับเครื่องหมายระหว่าง train กับ test ทุกช่อง และไม่มีช่องไหน |t| ถึง 2 ทั้งสองช่วง
 *     ส่วน `breakout` ติดลบอย่างเป็นระบบบน train (t ถึง −2.0) ตามที่คาดไว้ล่วงหน้า
 *  2) **แหล่ง `flow` ใช้สัญญาณเดียวกับ OrderFlow V3 เป๊ะ ต่างแค่กฎการออก** แล้วผลพลิกจาก
 *     +18.79%/+23.13% เป็น −13.50%/−3.86% บน 15m — การบังคับเป้า 2R กับสัญญาณที่ต้องใช้
 *     เวลาหลายวันคือการตัดไม้ทิ้งกลางทาง
 *  3) **ด่านความผันผวน (`planMinVolRatio`) ทำร้ายผล ไม่ได้ช่วย** ปิดแล้วดีขึ้นทั้งสองช่วง
 *     และทั้งสอง timeframe ซึ่งหักล้างข้อเสนอในเอกสารหัวข้อ 3.1 ที่เป็นต้นทางของด่านนี้
 *     ส่วน `planMaxTradesPerYear` เป็นข้อจำกัดที่ถูกต้อง (ปิดแล้วเทรด 215 ไม้และแย่ลงมาก)
 *
 * โค้ดนี้จึงอยู่ที่นี่ในฐานะ **เส้นฐานที่วัดผลแล้ว** ไม่ใช่กลยุทธ์ที่รอเปิดใช้
 * มีเทสต์ใน `indicators-v3.test.ts` บังคับไว้ว่ารหัส `tradeplan*` ต้องไม่โผล่ในทะเบียน
 * จนกว่าจะมีหลักฐานว่าจังหวะเข้ามีข้อมูลเชิงทิศทาง — ถ้าวันนั้นมาถึง ให้ลบเทสต์นั้นพร้อมกัน
 */
export const TRADE_PLAN_V3_DEFAULTS = {
  /** 1 = อนุญาตฝั่งซื้อ, 0 = ปิด (มาจากรหัสกลยุทธ์ ไม่ใช่ผู้ใช้) */
  allowLong: 1,
  /** 1 = อนุญาตฝั่งขาย (ต้องเทรดบน futures), 0 = ปิด */
  allowShort: 1,

  // ── ชั้นสัญญาณ: ใช้เฉพาะค่าที่ตรงกับแหล่งของรหัสกลยุทธ์ ──
  /** flow: สะสมแรงซื้อขายสุทธิย้อนหลังกี่วัน */
  flowLookbackDays: 5,
  /** flow: ลบค่าเฉลี่ยของตัวเองย้อนหลังกี่วัน */
  flowDebiasDays: 120,
  /** flow: ระดับที่ถือว่าแรงพอจะเสนอทิศ */
  flowBand: 0.01,
  /** breakout: ราคาปิดต้องทะลุกรอบสูง/ต่ำของกี่แท่งก่อนหน้า */
  breakoutBars: 40,

  // ── ชั้นแผน: บังคับกับทุกแหล่งสัญญาณเหมือนกัน ──
  /**
   * ต้นทุนไป–กลับที่ใช้คำนวณพื้นของ stop (ตั้งแยกจาก fee/slippage ของ engine
   * เพราะแผนต้องรู้ต้นทุนของตัวเองก่อนที่ engine จะหักจริง)
   * ค่าตั้งต้น 0.16% = futures taker VIP 0 (fee 0.05% + slippage 0.03% ต่อขา)
   */
  planCostPct: 0.16,
  /**
   * stop ต้องยาวอย่างน้อยกี่เท่าของ `planCostPct`
   * ค่า 5 = ต้นทุนกินไม่เกิน 20% ของสิ่งที่ยอมเสี่ยงต่อไม้ (เอกสารหัวข้อ 1.2)
   * ค่านี้ไม่ได้มาจากการค้นหาที่ให้ผลสูงสุด แต่มาจากเลขคณิตของอัตราชนะที่ต้องได้
   */
  planRiskCostMult: 5,
  /** stop ตามความผันผวน = กี่เท่าของ ATR (ใช้ค่าที่กว้างกว่าระหว่างตัวนี้กับพื้นต้นทุน) */
  planStopAtr: 2,
  /** เป้าหมายเป็นกี่ R (R = ระยะ stop) — 2R ต้องการอัตราชนะ 40% */
  planTargetR: 2,
  /**
   * ATR% ปัจจุบันต้องเป็นกี่เท่าของค่าปกติของตัวเองจึงจะเข้าได้
   * 1 = ต้องไม่ต่ำกว่าค่าปกติ · 0 = ปิดตัวกรองนี้
   */
  planMinVolRatio: 1,
  /** หน้าต่างที่ใช้หา "ค่าปกติ" ของ ATR% (วัน) */
  planVolWindowDays: 20,
  /** งบจำนวนไม้ต่อปี แปลงเป็นระยะห่างขั้นต่ำระหว่างการเข้าสองครั้ง */
  planMaxTradesPerYear: 125,
  /** ถือได้นานสุดกี่ชั่วโมงจึงตัดใจออก */
  planMaxHoldHours: 24,
  /** ขนาดไม้เป็น % ของพอร์ต */
  planSizePct: 100,

  /** ช่วง ATR ที่ใช้ทั้งวัด stop และวัดความผันผวนเทียบค่าปกติ */
  atrPeriod: 14,
  /** EMA ที่ใช้แสดงผลเท่านั้น */
  fastPeriod: 21,
  trendPeriod: 55,
};
export type TradePlanV3Params = typeof TRADE_PLAN_V3_DEFAULTS;

/** แหล่งสัญญาณที่ชั้นแผนรองรับ — เลือกด้วยรหัสกลยุทธ์ ไม่ใช่พารามิเตอร์ */
export type PlanSourceId = "flow" | "breakout";

/** สิ่งที่แหล่งสัญญาณต้องคืน: ทิศที่เสนอรายแท่ง กับค่าที่ใช้อธิบาย */
interface PlanSourceOutput {
  /** 1 = เสนอซื้อ, −1 = เสนอขาย, 0 = ไม่เสนอ */
  dir: number[];
  /** ค่าสัญญาณดิบรายแท่ง ใช้แสดงผลและอธิบายเหตุผล */
  value: Series;
  /** ความมั่นใจ 0–1 รายแท่ง */
  confidence: Series;
  /** ข้อความอธิบายค่าของแท่งนั้น */
  describe: (i: number) => string;
}

/** ค่าสูงสุด/ต่ำสุดของ n แท่ง **ก่อนหน้า** แท่งปัจจุบัน (ไม่รวมแท่งปัจจุบัน จึงไม่มองอนาคต) */
function priorExtreme(values: number[], n: number, pick: "max" | "min"): Series {
  const out: Series = new Array(values.length).fill(null);
  if (n < 1) return out;
  for (let i = n; i < values.length; i++) {
    let best = values[i - n];
    for (let j = i - n + 1; j < i; j++)
      best = pick === "max" ? Math.max(best, values[j]) : Math.min(best, values[j]);
    out[i] = best;
  }
  return out;
}

/**
 * แหล่งสัญญาณ "แรงซื้อขายสุทธิ" — กฎเดียวกับ OrderFlow V3 ทุกข้อ
 * ต่างกันแค่ว่าที่นี่มันเสนอเฉพาะ **ทิศ** ส่วนการออกเป็นหน้าที่ของชั้นแผน
 */
function flowSource(k: KlineData[], p: TradePlanV3Params, perDay: number): PlanSourceOutput {
  const L = Math.max(1, Math.round(p.flowLookbackDays * perDay));
  const M = Math.max(2, Math.round(p.flowDebiasDays * perDay));
  const value = removeOwnMean(orderFlowImbalance(k, L), M);
  const dir = new Array(k.length).fill(0);
  const confidence: Series = new Array(k.length).fill(null);
  for (let i = 0; i < k.length; i++) {
    const v = value[i];
    if (v === null) continue;
    dir[i] = v > p.flowBand ? 1 : v < -p.flowBand ? -1 : 0;
    confidence[i] = Math.min(1, Math.abs(v) / (p.flowBand * 4));
  }
  return {
    dir, value, confidence,
    describe: (i) => {
      const v = value[i];
      return v === null ? "ยังสะสมแรงซื้อขายสุทธิไม่ครบ" : `แรงซื้อขายสุทธิ ${(v * 100).toFixed(2)}%`;
    },
  };
}

/**
 * แหล่งสัญญาณ "ทะลุกรอบ" — ราคาปิดเลยกรอบสูง/ต่ำของ `breakoutBars` แท่งก่อนหน้า
 *
 * ตัวนี้อยู่ที่นี่เพื่อเป็น **เส้นฐานราคาล้วน** ไม่ใช่เพราะคาดว่าจะกำไร เอกสารหัวข้อ 2.1
 * วัดสหสัมพันธ์ lag-1 ของผลตอบแทนได้ −0.032 ถึง +0.008 (ติดลบจาง ๆ คือมีแรงกลับตัว
 * ไม่ใช่โมเมนตัม) จึงคาดไว้ล่วงหน้าว่าตัวนี้จะไม่มีความได้เปรียบ
 * มันมีไว้ตอบคำถามว่า "ผลต่างระหว่างสองรหัสมาจากสัญญาณจริงไหม" เมื่อกฎการออกเหมือนกันหมด
 */
function breakoutSource(k: KlineData[], p: TradePlanV3Params, atrSeries: Series): PlanSourceOutput {
  const n = k.length;
  const N = Math.max(2, Math.round(p.breakoutBars));
  const hi = priorExtreme(k.map((x) => +x.high), N, "max");
  const lo = priorExtreme(k.map((x) => +x.low), N, "min");
  const dir = new Array(n).fill(0);
  const value: Series = new Array(n).fill(null);
  const confidence: Series = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const h = hi[i], l = lo[i], a = atrSeries[i], c = +k[i].close;
    if (h === null || l === null || a === null || a <= 0) continue;
    // ระยะที่ราคาปิดเลยกรอบออกไป วัดเป็น ATR — 0 เมื่อยังอยู่ในกรอบ
    const beyond = c > h ? (c - h) / a : c < l ? (c - l) / a : 0;
    value[i] = beyond;
    dir[i] = beyond > 0 ? 1 : beyond < 0 ? -1 : 0;
    confidence[i] = Math.min(1, Math.abs(beyond));
  }
  return {
    dir, value, confidence,
    describe: (i) => {
      const v = value[i];
      if (v === null) return "ยังสร้างกรอบราคาไม่ครบ";
      if (v === 0) return "ราคายังอยู่ในกรอบ";
      return `ปิดเลยกรอบ ${N} แท่งไป ${Math.abs(v).toFixed(2)} ATR`;
    },
  };
}

/**
 * ชั้นแผนเทรด: รับทิศจากแหล่งสัญญาณ แล้วบังคับข้อจำกัดของเอกสารทั้งหมด
 *
 * ลำดับการตัดสินใจในแต่ละแท่ง (ทั้งหมดใช้ข้อมูลถึงแท่งปัจจุบันเท่านั้น)
 *   1) ถ้าถือสถานะอยู่ ตรวจการออกก่อนเสมอ: ชน stop → ถึงเป้า → ครบเวลาถือ → สัญญาณกลับข้าง
 *   2) ถ้าว่าง ตรวจสามด่านก่อนเข้า: ทิศที่รหัสอนุญาต · ATR% ถึงเกณฑ์ · ครบระยะห่างตามงบไม้
 *   3) แท่งที่เพิ่งออก จะไม่เข้าใหม่ในแท่งเดียวกัน
 *
 * stop และเป้าถูกตรึงไว้ตั้งแต่แท่งที่เข้า และไม่ขยับอีกเลย — ไม่มี trailing เพราะยังไม่มี
 * หลักฐานว่ามันช่วย และการมีกลไกเพิ่มโดยไม่มีหลักฐานคือความผิดพลาดเดิมของตระกูล SMC
 *
 * ทุก stop/target เทียบ **ราคาปิด** ไม่ใช่คำสั่งระหว่างแท่ง ตัวจำลองจะ fill ที่ราคาเปิด
 * แท่งถัดไปพร้อม fee/slippage/funding ตัวเลขที่ได้จึงระวังตัวมากกว่าการวางคำสั่งจริง
 */
export function tradePlanV3(
  k: KlineData[],
  source: PlanSourceId,
  overrides: Partial<TradePlanV3Params> | Record<string, number> = {},
  startIndex = 0,
): V3Result {
  const p = { ...TRADE_PLAN_V3_DEFAULTS, ...overrides } as TradePlanV3Params;
  for (const [key, v] of Object.entries(p))
    if (!Number.isFinite(v) || v < 0) throw new Error(`Invalid TradePlan V3 parameter: ${key}`);
  if (p.flowLookbackDays >= p.flowDebiasDays)
    throw new Error("TradePlan V3 requires flowLookbackDays < flowDebiasDays");
  if (p.flowBand <= 0 || p.flowBand >= 1)
    throw new Error("TradePlan V3 requires 0 < flowBand < 1");
  if (p.planCostPct <= 0) throw new Error("TradePlan V3 requires planCostPct > 0");
  if (p.planTargetR <= 0) throw new Error("TradePlan V3 requires planTargetR > 0");
  if (p.planStopAtr <= 0 && p.planRiskCostMult <= 0)
    throw new Error("TradePlan V3 requires a stop: set planStopAtr or planRiskCostMult above zero");
  if (p.planMaxTradesPerYear <= 0) throw new Error("TradePlan V3 requires planMaxTradesPerYear > 0");
  if (p.planMaxHoldHours <= 0) throw new Error("TradePlan V3 requires planMaxHoldHours > 0");
  if (p.planSizePct <= 0 || p.planSizePct > 100)
    throw new Error("TradePlan V3 requires 0 < planSizePct <= 100");
  if (p.allowLong < 0.5 && p.allowShort < 0.5)
    throw new Error("TradePlan V3 requires at least one direction enabled");
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > k.length)
    throw new Error("Invalid TradePlan V3 startIndex");

  const n = k.length;
  const c = closes(k);
  const tfMinutes = detectTimeframeMinutes(k);
  const perDay = tfMinutes > 0 ? 1440 / tfMinutes : 1;
  const atrSeries = atr(k, Math.max(2, Math.round(p.atrPeriod)));

  const src = source === "flow"
    ? flowSource(k, p, perDay)
    : breakoutSource(k, p, atrSeries);

  // ATR% ของแต่ละแท่ง และค่าปกติของมันเอง — ใช้แทนตัวกรองเวลา (เอกสารหัวข้อ 3.1)
  const atrPct: Series = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const a = atrSeries[i];
    if (a !== null && c[i] > 0) atrPct[i] = (a / c[i]) * 100;
  }
  const volWindowBars = Math.max(2, Math.round(p.planVolWindowDays * perDay));
  const atrPctNormal = ema(atrPct, volWindowBars);

  // งบจำนวนไม้ต่อปี → ระยะห่างขั้นต่ำระหว่างการเข้าสองครั้ง (เอกสารหัวข้อ 1.4)
  const minGapBars = Math.max(1, Math.round((365 * perDay) / p.planMaxTradesPerYear));
  const maxHoldBars = Math.max(1, Math.round((p.planMaxHoldHours * 60) / (tfMinutes || 1)));
  const size = p.planSizePct / 100;

  const blank = (): Series => new Array(n).fill(null);
  // ช่องของการจัดการไม้เป็นช่องทางเลือกใน V3Result จึงถือเป็นตัวแปรท้องถิ่นระหว่างวนลูป
  // แล้วค่อยผูกเข้าผลลัพธ์ ไม่ต้องเช็ค undefined ทุกบรรทัด
  const stopSeries = blank(), targetSeries = blank();
  const riskPctSeries = blank(), holdBarsSeries = blank(), volRatioSeries = blank();
  const r: V3Result = {
    exposure: new Array(n).fill(0),
    signal: new Array(n).fill(null) as V3Signal[],
    reason: new Array(n).fill("รอให้แหล่งสัญญาณพร้อม"),
    regime: new Array(n).fill("warmup"),
    direction: new Array(n).fill(0),
    size: blank(),
    confidence: blank(),
    signalValue: src.value,
    atr: atrSeries,
    fastEMA: ema(c, Math.max(2, Math.round(p.fastPeriod))),
    trendEMA: ema(c, Math.max(3, Math.round(p.trendPeriod))),
    utcHour: blank(),
    timeframeMinutes: tfMinutes,
    resolvedLookbackBars: source === "flow" ? Math.max(1, Math.round(p.flowLookbackDays * perDay)) : Math.max(2, Math.round(p.breakoutBars)),
    resolvedDebiasBars: source === "flow" ? Math.max(2, Math.round(p.flowDebiasDays * perDay)) : volWindowBars,
    stop: stopSeries,
    target: targetSeries,
    riskPct: riskPctSeries,
    holdBars: holdBarsSeries,
    volRatio: volRatioSeries,
  };

  let dir = 0, entry = 0, stop = 0, target = 0, risk = 0, held = 0, lastEntryIdx = -Infinity;
  for (let i = 0; i < n; i++) {
    r.utcHour[i] = new Date(k[i].openTime).getUTCHours();
    const a = atrPct[i], normal = atrPctNormal[i];
    const ratio = a !== null && normal !== null && normal > 0 ? a / normal : null;
    volRatioSeries[i] = ratio;
    const srcDir = src.dir[i];
    r.regime[i] = srcDir > 0 ? "uptrend" : srcDir < 0 ? "downtrend" : "range";

    if (a === null) { dir = 0; continue; }
    if (i < startIndex) { r.reason[i] = "warmup (no position)"; dir = 0; continue; }

    const prev = dir;
    let exited = false;
    if (dir !== 0) {
      held++;
      const side = dir;
      const why = side * (c[i] - stop) <= 0 ? "ชน stop"
        : side * (c[i] - target) >= 0 ? "ถึงเป้าหมาย"
        : held >= maxHoldBars ? `ครบเวลาถือ ${p.planMaxHoldHours} ชม.`
        : srcDir === -side ? "สัญญาณกลับข้าง"
        : null;
      if (why) {
        dir = 0; held = 0; exited = true;
        r.signal[i] = side === 1 ? "SELL" : "COVER";
        r.reason[i] = `ออก (${why}): ${src.describe(i)}`;
      } else {
        r.reason[i] = `ถือ${side === 1 ? "ซื้อ" : "ขาย"} ${held}/${maxHoldBars} แท่ง: ${src.describe(i)}`;
      }
    }

    if (dir === 0 && !exited) {
      const wanted = srcDir > 0 && p.allowLong >= 0.5 ? 1 : srcDir < 0 && p.allowShort >= 0.5 ? -1 : 0;
      const volOk = p.planMinVolRatio <= 0 || (ratio !== null && ratio >= p.planMinVolRatio);
      const gapOk = i - lastEntryIdx >= minGapBars;
      if (wanted === 0) {
        r.reason[i] = `ว่าง: ${src.describe(i)}`;
      } else if (!volOk) {
        const shown = ratio === null ? "-" : ratio.toFixed(2);
        r.reason[i] = `ข้าม: ความผันผวนต่ำกว่าเกณฑ์ (ATR% เป็น ${shown} เท่าของค่าปกติ)`;
      } else if (!gapOk) {
        r.reason[i] = `ข้าม: ยังไม่ครบระยะห่างตามงบ ${p.planMaxTradesPerYear} ไม้/ปี (เหลือ ${minGapBars - (i - lastEntryIdx)} แท่ง)`;
      } else {
        dir = wanted; held = 0; lastEntryIdx = i;
        entry = c[i];
        // ระยะเสี่ยงคือค่าที่กว้างกว่าระหว่าง stop ตามความผันผวน กับพื้นที่ต้นทุนบังคับ
        risk = Math.max(p.planStopAtr * a, p.planRiskCostMult * p.planCostPct);
        stop = entry * (1 - dir * (risk / 100));
        target = entry * (1 + dir * ((risk * p.planTargetR) / 100));
        r.signal[i] = dir === 1 ? "BUY" : "SHORT";
        r.reason[i] = `${dir === 1 ? "ซื้อ" : "ขาย"}: ${src.describe(i)} · เสี่ยง ${risk.toFixed(2)}% เป้า ${p.planTargetR}R`;
      }
    }

    r.direction[i] = dir;
    r.exposure[i] = dir * size;
    if (dir !== 0) {
      r.size[i] = size;
      r.confidence[i] = src.confidence[i];
      stopSeries[i] = stop;
      targetSeries[i] = target;
      riskPctSeries[i] = risk;
      holdBarsSeries[i] = held;
    }
    if (dir === prev && dir === 0 && !exited && r.signal[i] === null && r.reason[i] === "รอให้แหล่งสัญญาณพร้อม")
      r.reason[i] = `ว่าง: ${src.describe(i)}`;
  }
  return r;
}

/** คำอธิบายกฎร่วมของชั้นแผน ใช้ประกอบกฎของทุกรหัสในตระกูลนี้ */
export const TRADE_PLAN_RULE_TH =
  "ชั้นแผนเทรด (TradePlan V3) บังคับข้อจำกัดที่วัดได้จาก trade-planning-1m-30m-th.md กับแหล่งสัญญาณใดก็ได้. " +
  "ระยะเสี่ยงต่อไม้ = ค่าที่กว้างกว่าระหว่าง planStopAtr x ATR กับ planRiskCostMult x planCostPct " +
  "ซึ่งพื้นชั้นหลังมาจากการวัดว่าถ้า stop แคบกว่าต้นทุนมาก อัตราชนะที่ต้องได้เพื่อเสมอตัวจะเกิน 100% " +
  "(บน 1m ที่ stop 1 ATR เป้า 1 ATR ต้องชนะ 182% ของไม้). " +
  "เป้าหมาย = planTargetR เท่าของระยะเสี่ยง ตรึงไว้ตั้งแต่แท่งที่เข้า ไม่มี trailing. " +
  "เข้าได้ต่อเมื่อ ATR% ปัจจุบันเป็นอย่างน้อย planMinVolRatio เท่าของค่าปกติของตัวเอง " +
  "(ใช้แทนตัวกรองเวลา เพราะวัดแล้วพบว่าการเข้าช่วง 13-17 UTC ให้อัตราถึงเป้า 41.3% เทียบกับนอกช่วง 41.9% " +
  "คือไม่ต่างกัน สิ่งที่ช่วงคึกให้คือ ATR ที่ใหญ่ขึ้น ไม่ใช่ทิศทางที่แม่นขึ้น). " +
  "จำนวนไม้ถูกจำกัดด้วยงบต้นทุน planMaxTradesPerYear โดยแปลงเป็นระยะห่างขั้นต่ำระหว่างการเข้าสองครั้ง " +
  "(125 ไม้/ปี ที่ต้นทุนไป-กลับ 0.16% = ค่าธรรมเนียมกินทุน 20% ต่อปี). " +
  "ออกเมื่อ: ราคาปิดชน stop, ถึงเป้าหมาย, ถือครบ planMaxHoldHours หรือแหล่งสัญญาณกลับข้าง. " +
  "ทุก stop/target เทียบราคาปิด ไม่ใช่คำสั่งระหว่างแท่ง engine จะ fill ที่ราคาเปิดแท่งถัดไปพร้อม fee/slippage/funding. " +
  "ชั้นนี้ไม่สร้างความได้เปรียบ มันบังคับได้แค่ว่าแผนจะไม่ตายด้วยเลขคณิตของต้นทุน " +
  "ถ้าแหล่งสัญญาณไม่รู้ทิศทาง ผลจะยังเป็นลบ เพียงแต่ลบช้าลงเพราะเทรดน้อยลง";

// ══ 4) ทะเบียนกลยุทธ์ v3 — จุดต่อขยายเดียวของทั้งระบบ ══════════
/**
 * ทุกอย่างที่ระบบต้องรู้เกี่ยวกับกลยุทธ์ v3 หนึ่งตัว อยู่ในรายการเดียวของ `V3_REGISTRY`
 * ส่วนฟังก์ชันที่ผู้เรียกใช้ (`v3Defaults`, `computeV3`, `V3_STRATEGY_INFO`, …)
 * ล้วนอ่านค่าจากตารางนี้ ไม่มีการเขียน `if (id === …)` กระจายอยู่ที่อื่น
 *
 * **วิธีเพิ่มกลยุทธ์ v3 ใหม่** (ทั้งหมดทำในไฟล์นี้)
 *   1) เขียนฟังก์ชันที่คืน `V3Result` ไว้ในส่วนของตระกูลตัวเอง
 *   2) เพิ่มรหัสใน `V3StrategyId`
 *   3) เพิ่มหนึ่งรายการใน `V3_REGISTRY` ให้ครบทุกช่องของ `V3Definition`
 *   4) ถ้ามีพารามิเตอร์ใหม่ เพิ่มป้ายและขอบเขตใน `V3_PARAM_META`
 * แล้วกลยุทธ์จะไปปรากฏเองใน `STRATEGIES`, `STRATEGY_FNS`, ปุ่มเลือกกลยุทธ์ในเว็บ,
 * ตารางผล, ไฟล์ Export และตัวตรวจคำขอ โดยไม่ต้องแก้ไฟล์อื่นเลย
 * (`lib/backtest.ts`, `engine.ts`, `data.ts`, `export-calculations.ts` วนจาก `V3_STRATEGY_IDS` ทั้งหมด)
 *
 * เทสต์ `V3 is wired into every registry the web UI depends on` บังคับข้อนี้ไว้:
 * ทุกรหัสต้องมีที่อยู่ในทุกทะเบียน มีป้ายพารามิเตอร์ครบ ค่าตั้งต้นอยู่ในขอบเขตของตัวเอง
 * และมีกฎสำหรับไฟล์ Export
 *
 * **สิ่งที่ต้องทำก่อนลงทะเบียน ไม่ใช่หลัง**: รันสัญญาณผ่าน `research-v3/entry-edge.ts`
 * ถ้าผลตอบแทนล่วงหน้าไม่ต่างจากศูนย์หรือสลับเครื่องหมายระหว่าง train กับ test
 * กลยุทธ์นั้นจะขาดทุนแน่นอนหลังหักต้นทุน การลงทะเบียนก่อนวัดคือความผิดพลาดเดิม
 * ที่ทำให้มีกลยุทธ์ที่ขาดทุนอยู่ในระบบตั้งสามตัว
 */
export type V3StrategyId =
  | "orderflow_v3"
  | "orderflow_v3_zero"
  | "orderflow_v3_long"
  | "orderflow_v3_short";

/** ทุกสิ่งที่ระบบต้องรู้เกี่ยวกับกลยุทธ์ v3 หนึ่งตัว */
export interface V3Definition {
  name: string;
  th: string;
  en: string;
  /** ป้ายกลุ่มที่แสดงข้างชื่อในเว็บ */
  group: string;
  /** เส้นที่วาดทับกราฟเป็นค่าเริ่มต้น เขียนเป็น `<คีย์อินดิเคเตอร์>.<ชื่อ series>` */
  overlay: string;
  /** ทิศที่รหัสนี้อนุญาต — ล็อกด้วยรหัส ไม่ใช่พารามิเตอร์ที่ผู้ใช้แก้ได้ */
  direction: { allowLong: number; allowShort: number };
  /** ค่าตั้งต้นที่ผู้ใช้ปรับได้ (ต้องไม่มี allowLong/allowShort) */
  defaults: Record<string, number>;
  compute: (k: KlineData[], params: Record<string, number>, startIndex: number) => V3Result;
  /** จำนวนแท่งอุ่นเครื่องที่ควรโหลดก่อนช่วงที่จะประเมินผล */
  warmupBars: (params: Record<string, number>) => number;
  /** ตรวจพารามิเตอร์ที่เกี่ยวพันกัน คืนข้อความเมื่อไม่ผ่าน */
  validate: (params: Record<string, number>) => string | null;
  /** กฎฉบับเต็มสำหรับไฟล์ Export */
  rule: string;
}

/** ค่าตั้งต้นของ OrderFlow โดยตัดทิศทางออก เพราะทิศมาจากรหัสกลยุทธ์ */
function orderFlowDefaults(overrides: Record<string, number> = {}): Record<string, number> {
  const { allowLong: _l, allowShort: _s, ...rest } = ORDER_FLOW_V3_DEFAULTS;
  return { ...rest, ...overrides };
}
function orderFlowValidate(p: Record<string, number>): string | null {
  if (p.flowLookbackDays >= p.flowDebiasDays)
    return "ช่วงสะสมต้องสั้นกว่าช่วงลบค่าเฉลี่ย มิฉะนั้นการลบค่าเฉลี่ยจะหักล้างสัญญาณทิ้ง";
  if (p.fastPeriod >= p.trendPeriod) return "EMA เร็วต้องสั้นกว่า EMA เทรนด์";
  return null;
}
/**
 * OrderFlow ต้องการข้อมูลย้อนหลังเป็น "วัน" (ค่าตั้งต้น 125 วัน) ซึ่งแปลงเป็นแท่งได้
 * ต่อเมื่อรู้ timeframe จึงขอ warm-up ไว้เต็มเพดาน ส่วนที่เหลือกลยุทธ์จะรอสะสมเอง
 * ภายในช่วงที่เลือก และรายงานในคอลัมน์เหตุผลว่ายังสะสมไม่ครบ
 */
const orderFlowWarmup = () => 2000;

/** คำต่อท้ายกฎ บอกว่ารหัสนี้เปิดทิศไหนและมีผลต่อต้นทุนอย่างไร */
const SCOPE = {
  both: "รหัสนี้เปิดทั้งฝั่งซื้อและฝั่งขาย",
  zero:
    "รหัสนี้เปิดทั้งสองฝั่ง และต่างจาก orderflow_v3 ที่ค่าเดียวคือ flowExitMult = 0 " +
    "แปลว่าถือสถานะต่อจนกว่าแรงซื้อขายสุทธิจะข้ามศูนย์ แทนที่จะออกเมื่อกลับเข้ามาที่ครึ่งเกณฑ์. " +
    "ที่มาของค่านี้: ให้คะแนนกฎการออก 7 แบบ (flowExitMult 1 / 0.75 / 0.5 / 0.25 / 0 / -0.5 / -1) " +
    "บนช่วง train ของ BTCUSDT เท่านั้น ข้ามทั้ง 3 timeframe x 3 ช่วงย้อนหลัง x 3 band รวม 27 ชุดค่าต่อแบบ " +
    "แล้วเลือกด้วยค่ามัธยฐานของผลตอบแทน ไม่ใช่ค่าสูงสุด เพื่อไม่ให้ยอดแหลมชนะ: 0 ได้ 27.08% เทียบกับ 19.85% ของ 0.5. " +
    "จากนั้นรายงานช่วง test ครั้งเดียว ได้ 23.88% / 23.97% / 24.06% บน 5m / 15m / 30m " +
    "เทียบกับ 23.91% / 23.13% / 19.54% ของกฎเดิม โดยเทรดน้อยลง (18-28 ไม้ เทียบกับ 27-36) และ drawdown ต่ำกว่า. " +
    "ตรวจข้ามเหรียญที่ไม่เคยถูกใช้เลือกค่าเลย (ETH/SOL/BNB/XRP หน้าต่างเวลาเดียวกับ BTCUSDT): " +
    "พอร์ตแบ่งทุนเท่ากันเป็นบวกทั้งสองช่วง ทุก band ทั้ง 15m และ 30m ครบ 6 จาก 6 ช่อง ขณะที่กฎเดิมได้ 5 จาก 6. " +
    "ข้อจำกัดเฉพาะของรหัสนี้: ในช่วงที่ไม่เคยถูกใช้เลือกค่าทั้งเหรียญและเวลา มันดีกว่ากฎเดิม 6 จาก 6 ช่อง " +
    "แต่ในช่วงที่เวลาทับกับ train ของ BTCUSDT มันดีกว่าเพียง 2 จาก 6 ช่อง " +
    "ส่วนต่างจึงยังอยู่ในระดับที่ข้อมูลหนึ่งปีแยกไม่ออกจากความบังเอิญ ใช้เทียบกับ orderflow_v3 ไม่ใช่แทนที่",
  long: "รหัสนี้เปิดเฉพาะฝั่งซื้อ จึงใช้กับบัญชี Spot ได้และไม่มีต้นทุน funding",
  short: "รหัสนี้เปิดเฉพาะฝั่งขาย ต้องเทรดบน perpetual futures และมีต้นทุน funding",
} as const;

const FLOW_GROUP = "แรงซื้อขายสุทธิ (swing)";
const FLOW_OVERLAY = "v3.fastEMA";

export const V3_REGISTRY: Record<V3StrategyId, V3Definition> = {
  orderflow_v3: {
    name: "OrderFlow V3 (สองทาง)",
    th: "เทรดสองทางด้วยแรงซื้อขายสุทธิจาก takerBuyBaseVolume สะสม 5 วันแล้วลบค่าเฉลี่ยของตัวเอง 120 วัน เป็นกลยุทธ์เดียวในโปรเจกต์ที่ผ่านการตรวจข้ามเหรียญและข้ามช่วงเวลาแล้วยังเป็นบวก ต้องกระจายหลายเหรียญ ถือเฉลี่ยหลายวัน",
    en: "Two-way order-flow imbalance strategy from takerBuyBaseVolume, accumulated over 5 days and de-biased by its own 120-day mean; multi-day holds, requires diversification across coins",
    group: FLOW_GROUP,
    overlay: FLOW_OVERLAY,
    direction: { allowLong: 1, allowShort: 1 },
    defaults: orderFlowDefaults(),
    compute: orderFlowV3,
    warmupBars: orderFlowWarmup,
    validate: orderFlowValidate,
    rule: `${ORDER_FLOW_RULE_TH}. ${SCOPE.both}`,
  },
  orderflow_v3_zero: {
    name: "OrderFlow V3 (ออกเมื่อข้ามศูนย์)",
    th: "กฎเดียวกับ OrderFlow V3 ทุกข้อ ต่างที่ flowExitMult = 0 คือถือต่อจนกว่าแรงซื้อขายสุทธิจะข้ามศูนย์ แทนการออกที่ครึ่งเกณฑ์ เลือกค่าจากช่วง train ของ BTCUSDT เท่านั้นด้วยค่ามัธยฐานข้าม 27 ชุดค่า และผ่านการตรวจข้ามเหรียญ 6 จาก 6 ช่อง เทรดน้อยลงและ drawdown ต่ำกว่ากฎเดิม แต่ส่วนต่างยังเล็กเกินกว่าจะสรุปได้จากข้อมูลหนึ่งปี",
    en: "Same rules as OrderFlow V3 except flowExitMult = 0: holds until net taker flow crosses zero instead of exiting at half the entry band. Chosen on the BTCUSDT training window only, by median across 27 parameter sets, and clears the cross-coin bar 6/6",
    group: FLOW_GROUP,
    overlay: FLOW_OVERLAY,
    direction: { allowLong: 1, allowShort: 1 },
    defaults: orderFlowDefaults({ flowExitMult: 0 }),
    compute: orderFlowV3,
    warmupBars: orderFlowWarmup,
    validate: orderFlowValidate,
    rule: `${ORDER_FLOW_RULE_TH}. ${SCOPE.zero}`,
  },
  orderflow_v3_long: {
    name: "OrderFlow V3 (ซื้ออย่างเดียว)",
    th: "กฎเดียวกับ OrderFlow V3 แต่เปิดเฉพาะฝั่งซื้อ ใช้กับบัญชี Spot ได้และไม่มีต้นทุน funding ใช้เทียบว่าฝั่งขายเพิ่มผลตอบแทนจริงหรือไม่ วัดแล้วเป็นบวกเฉพาะช่วงตลาดขึ้น",
    en: "Same rules as OrderFlow V3 but long entries only; Spot-compatible and free of funding cost. Diagnostic only: positive in the rising window, negative in the falling one",
    group: FLOW_GROUP,
    overlay: FLOW_OVERLAY,
    direction: { allowLong: 1, allowShort: 0 },
    defaults: orderFlowDefaults(),
    compute: orderFlowV3,
    warmupBars: orderFlowWarmup,
    validate: orderFlowValidate,
    rule: `${ORDER_FLOW_RULE_TH}. ${SCOPE.long}`,
  },
  orderflow_v3_short: {
    name: "OrderFlow V3 (ขายอย่างเดียว)",
    th: "กฎเดียวกับ OrderFlow V3 แต่เปิดเฉพาะฝั่งขาย ต้องเทรดบน perpetual futures และมีต้นทุน funding ใช้ตรวจว่าผลบวกมาจากการทำนายหรือจากอคติฝั่งขาย วัดแล้วเป็นบวกเฉพาะช่วงตลาดลง",
    en: "Same rules as OrderFlow V3 but short entries only; requires perpetual futures and carries funding cost. Diagnostic only: positive in the falling window, negative in the rising one",
    group: FLOW_GROUP,
    overlay: FLOW_OVERLAY,
    direction: { allowLong: 0, allowShort: 1 },
    defaults: orderFlowDefaults(),
    compute: orderFlowV3,
    warmupBars: orderFlowWarmup,
    validate: orderFlowValidate,
    rule: `${ORDER_FLOW_RULE_TH}. ${SCOPE.short}`,
  },
};

export const V3_STRATEGY_IDS = Object.keys(V3_REGISTRY) as V3StrategyId[];

const V3_ID_SET = new Set<string>(V3_STRATEGY_IDS);
export function isV3StrategyId(id: string): id is V3StrategyId {
  return V3_ID_SET.has(id);
}

/** ทิศทางที่แต่ละรหัสกลยุทธ์อนุญาต */
export function v3Direction(id: V3StrategyId): { allowLong: number; allowShort: number } {
  return V3_REGISTRY[id].direction;
}

/** พารามิเตอร์ที่ผู้ใช้ปรับได้ (ไม่รวมทิศทาง ซึ่งมาจากรหัสกลยุทธ์) */
export function v3Defaults(id: V3StrategyId): Record<string, number> {
  return { ...V3_REGISTRY[id].defaults };
}

/**
 * คำนวณผลลัพธ์โดยบังคับทิศทางตามรหัสกลยุทธ์
 *
 * ค่าตั้งต้นของทะเบียนถูกวางไว้ใต้ `params` เสมอ เพราะรหัสสองตัวอาจใช้ฟังก์ชันเดียวกัน
 * แต่ต่างกันที่ค่าตั้งต้น (เช่น `orderflow_v3` กับ `orderflow_v3_zero` ต่างกันที่ `flowExitMult`)
 * ถ้าไม่เติมชั้นนี้ ผู้เรียกที่ส่ง `{}` จะได้ค่าตั้งต้นของ *อินดิเคเตอร์* ไม่ใช่ของ *รหัสกลยุทธ์*
 * แล้วสองรหัสจะให้ผลเหมือนกันเงียบ ๆ — เว็บไม่เจอปัญหานี้เพราะส่งค่ามาครบเสมอ
 * แต่ผู้เรียกอื่น (สคริปต์วิจัย บอทสัญญาณ) ไม่ได้ส่ง จึงต้องแก้ที่นี่ที่เดียว
 */
export function computeV3(
  id: V3StrategyId, k: KlineData[], params: Record<string, number> = {}, startIndex = 0,
): V3Result {
  const def = V3_REGISTRY[id];
  return def.compute(k, { ...def.defaults, ...params, ...def.direction }, startIndex);
}

/** ตรวจความสมเหตุสมผลของพารามิเตอร์ที่เกี่ยวพันกัน */
export function validateV3Params(id: V3StrategyId, p: Record<string, number>): string | null {
  return V3_REGISTRY[id].validate(p);
}

/** จำนวนแท่งอุ่นเครื่องที่ต้องการก่อนให้สัญญาณที่เชื่อถือได้ */
export function v3WarmupBars(id: V3StrategyId, params: Record<string, number> = {}): number {
  return V3_REGISTRY[id].warmupBars(params);
}

/** กฎฉบับเต็มของแต่ละรหัส ใช้ในไฟล์ Export */
export function v3RuleFor(id: V3StrategyId): string {
  return V3_REGISTRY[id].rule;
}

/** ชื่อและคำอธิบายที่แสดงใน Web UI */
export const V3_STRATEGY_INFO = Object.fromEntries(
  V3_STRATEGY_IDS.map((id) => {
    const { name, th, en, group, overlay } = V3_REGISTRY[id];
    return [id, { name, th, en, group, overlay }];
  }),
) as Record<V3StrategyId, { name: string; th: string; en: string; group: string; overlay: string }>;

/**
 * ป้ายและขอบเขตของพารามิเตอร์ที่ผู้ใช้ปรับได้ ใช้ทั้งสร้างช่องกรอกในเว็บ
 * และตรวจค่าที่ส่งเข้ามาก่อนถึง `validateV3Params`
 * มีเฉพาะพารามิเตอร์ของกลยุทธ์ที่ลงทะเบียนอยู่จริง
 */
export interface V3ParamMeta {
  label: string;
  min: number;
  max: number;
  step: number;
  integer: boolean;
}
const bars = (label: string, min: number, max: number): V3ParamMeta =>
  ({ label, min, max, step: 1, integer: true });
const pct = (label: string, min: number, max: number, step = 0.01): V3ParamMeta =>
  ({ label, min, max, step, integer: false });
const days = (label: string, min: number, max: number): V3ParamMeta =>
  ({ label, min, max, step: 0.1, integer: false });
/** อัตราส่วนที่ติดลบได้ ต่างจาก pct ตรงที่ค่าติดลบมีความหมายจริง */
const ratio = (label: string, min: number, max: number, step: number): V3ParamMeta =>
  ({ label, min, max, step, integer: false });

export const V3_PARAM_META: Record<string, V3ParamMeta> = {
  flowLookbackDays: days("สะสมแรงซื้อขายสุทธิย้อนหลัง (วัน)", 0.5, 60),
  flowDebiasDays: days("ลบค่าเฉลี่ยของตัวเองย้อนหลัง (วัน)", 5, 365),
  flowBand: pct("เกณฑ์แรงซื้อขายสุทธิที่ถือว่าแรงพอ", 0.001, 0.3, 0.001),
  flowExitMult: ratio("ออกที่กี่เท่าของเกณฑ์ (0 = ข้ามศูนย์, -1 = ถือจนกลับข้าง)", -1, 1, 0.05),
  flowSizePct: pct("ขนาดไม้ (% ของพอร์ต)", 1, 100, 1),
  atrPeriod: bars("ช่วง ATR", 2, 200),
  fastPeriod: bars("EMA เร็ว", 2, 200),
  trendPeriod: bars("EMA เทรนด์", 3, 400),
};
