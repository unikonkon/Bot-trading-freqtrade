/**
 * indicators-v3.ts — กลยุทธ์เวอร์ชัน 3 ทั้งหมดในไฟล์เดียว
 *
 * ไฟล์นี้มีสามส่วน เรียงตามลำดับที่ควรอ่าน
 *   1) สัญญาของผลลัพธ์ — ชนิด `V3Result` ที่กลยุทธ์ v3 ทุกตัวต้องคืน
 *   2) ตระกูล OrderFlow — กลยุทธ์เดียวที่ผ่านการวัดแล้วเป็นบวก (ดูหัวข้อถัดไป)
 *   3) ทะเบียน `V3_REGISTRY` — จุดต่อขยายเดียวที่ระบบทั้งหมดอ่านค่าจากมัน
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
 * มีเฉพาะช่องที่มีค่าจริง — เวอร์ชันก่อนมีอีก 14 ช่อง (stop, target, rsi, adx,
 * แนวรับ/ต้าน ฯลฯ) ที่ตกทอดมาจากตระกูล SMC และเป็น null ทุกแท่งตลอดกาล
 * ซึ่งถูกเขียนลงไฟล์ Export เป็นคอลัมน์ว่างเปล่า จึงตัดออกทั้งหมด
 * ถ้าวันหนึ่งมีกลยุทธ์ที่ใช้ stop จริง ค่อยเพิ่มช่องกลับมาพร้อมกับกลยุทธ์นั้น
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
  /** ระดับที่ถือว่าแรงพอจะเข้า (ออกเป็นสถานะว่างที่ครึ่งหนึ่งของค่านี้) */
  flowBand: 0.01,
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
    if (!Number.isFinite(v) || v < 0) throw new Error(`Invalid OrderFlow V3 parameter: ${key}`);
  if (p.flowLookbackDays <= 0 || p.flowDebiasDays <= 0)
    throw new Error("OrderFlow V3 requires positive lookback and debias windows");
  if (p.flowLookbackDays >= p.flowDebiasDays)
    throw new Error("OrderFlow V3 requires flowLookbackDays < flowDebiasDays");
  if (p.flowBand <= 0 || p.flowBand >= 1)
    throw new Error("OrderFlow V3 requires 0 < flowBand < 1");
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
  const exit = p.flowBand / 2;

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
  "ออกเป็นสถานะว่างเมื่อค่ากลับเข้ามาในครึ่งหนึ่งของเกณฑ์ และกลับข้างทันทีเมื่อค่าข้ามไปอีกฝั่งเต็มเกณฑ์. " +
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

// ══ 3) ทะเบียนกลยุทธ์ v3 — จุดต่อขยายเดียวของทั้งระบบ ══════════
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
function orderFlowDefaults(): Record<string, number> {
  const { allowLong: _l, allowShort: _s, ...rest } = ORDER_FLOW_V3_DEFAULTS;
  return { ...rest };
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

/** คำนวณผลลัพธ์โดยบังคับทิศทางตามรหัสกลยุทธ์ */
export function computeV3(
  id: V3StrategyId, k: KlineData[], params: Record<string, number> = {}, startIndex = 0,
): V3Result {
  const def = V3_REGISTRY[id];
  return def.compute(k, { ...params, ...def.direction }, startIndex);
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

export const V3_PARAM_META: Record<string, V3ParamMeta> = {
  flowLookbackDays: days("สะสมแรงซื้อขายสุทธิย้อนหลัง (วัน)", 0.5, 60),
  flowDebiasDays: days("ลบค่าเฉลี่ยของตัวเองย้อนหลัง (วัน)", 5, 365),
  flowBand: pct("เกณฑ์แรงซื้อขายสุทธิที่ถือว่าแรงพอ", 0.001, 0.3, 0.001),
  flowSizePct: pct("ขนาดไม้ (% ของพอร์ต)", 1, 100, 1),
  atrPeriod: bars("ช่วง ATR", 2, 200),
  fastPeriod: bars("EMA เร็ว", 2, 200),
  trendPeriod: bars("EMA เทรนด์", 3, 400),
};
