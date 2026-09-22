/**
 * indicators-v3.ts — กลยุทธ์เวอร์ชัน 3 ทั้งหมดในไฟล์เดียว
 *
 * ไฟล์นี้มีห้าส่วน เรียงตามลำดับที่ควรอ่าน
 *   1) สัญญาของผลลัพธ์ — ชนิด `V3Result` ที่กลยุทธ์ v3 ทุกตัวต้องคืน
 *   2) ตระกูล OrderFlow — กลยุทธ์เดียวที่ผ่านการวัดแล้วเป็นบวก (ดูหัวข้อถัดไป)
 *   3) ตระกูล TradePlan — ชั้นแผนเทรดที่บังคับข้อจำกัดเรื่องต้นทุนกับแหล่งสัญญาณใดก็ได้
 *   4) ตระกูล FlowGate — ชั้นทิศทางจาก OrderFlow คูณชั้นจังหวะจากอินดิเคเตอร์ราคา
 *   5) ทะเบียน `V3_REGISTRY` — จุดต่อขยายเดียวที่ระบบทั้งหมดอ่านค่าจากมัน
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
import { atr, ema, closes, emaV2, utBotV2, type Series, type V2Signal } from "@/lib/indicators-v2";
import { trendlinesWithBreaks } from "@/lib/indicators";

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
  /** ทิศที่ชั้นจังหวะยิงรายแท่ง (1 ซื้อ, −1 ขาย, 0 ไม่ยิง) — ใช้ตรวจว่าทำไมเข้าหรือไม่เข้า */
  triggerDir?: Series;
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
    if (v === null) {
      // บอกให้ชัดว่าขาดอีกกี่แท่ง แทนการเงียบ — ผู้ใช้จะได้รู้ว่าต้องโหลดเพิ่มเท่าไร
      r.reason[i] = `รอสะสมแรงซื้อขายสุทธิ: มี ${i + 1} แท่ง ต้องมี ${L + M - 1} แท่ง (ขาดอีก ${L + M - 1 - (i + 1)})`;
      dir = 0; continue;
    }
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

// ══ 4) ตระกูล FlowGate — ชั้นทิศทางช้า + ชั้นจังหวะเร็ว ═════════
/**
 * ═══ ที่มา ═══════════════════════════════════════════════════════════════
 * OrderFlow V3 มีความได้เปรียบเชิงทิศทางแต่เปลี่ยนค่าช้ามาก (สะสม 5 วัน ลบอคติ 120 วัน)
 * จึงบอกได้แค่ "ตอนนี้ควรอยู่ฝั่งไหน" ไม่ได้บอกว่า "ควรเข้าแท่งไหน"
 * ส่วนอินดิเคเตอร์ราคาอย่าง Trendlines / EMA Cross / UT Bot บอกจังหวะได้ละเอียด
 * แต่วัดแล้วไม่มีข้อมูลเชิงทิศทางเลยเมื่อใช้ลำพัง
 *
 * ตระกูลนี้ประกอบสองชั้นเข้าด้วยกัน: **เข้าเมื่อตัวเร็วให้จังหวะ และแรงซื้อขายสุทธิเห็นด้วย**
 *
 * ═══ หลักฐานที่ทำให้เชื่อว่าสองชั้นนี้ไม่ใช่การเดา ═══════════════════════
 * วัดผลตอบแทนล่วงหน้าในทิศที่ตัวเร็วบอก โดยยังไม่มีกฎการออกเลย แล้วแยกเป็นสามกลุ่ม
 * (BTCUSDT เต็มปี · % ต่อไม้ ก่อนหักต้นทุน · ต้นทุนไป-กลับ futures taker = 0.16%)
 *
 * | ตัวเร็ว · 30m · N=80 | ทั้งหมด train/test | flow เห็นด้วย | flow ค้าน |
 * |---|---|---|---|
 * | EMA Cross V2    | −0.008 / +0.118 | **+1.112 / +0.816** | −0.879 / −0.802 |
 * | Trendlines      | +0.052 / +0.244 | **+0.781 / +0.483** | −0.432 / −0.479 |
 * | UT Bot V2       | +0.004 / +0.002 | **+0.588 / +0.231** | −0.554 / −0.219 |
 *
 * สองอย่างที่ทำให้ผลนี้ต่างจากทุกครั้งก่อนหน้าในโปรเจกต์นี้
 *   1) **กลุ่ม "ค้าน" ติดลบสม่ำเสมอ** ทุกตัวเร็ว ทุก timeframe ทั้ง train และ test
 *      ซึ่งเป็นลายเซ็นของประตูที่กรองทิศทางได้จริง ไม่ใช่ผลจากจำนวนไม้ที่ลดลง
 *      (ถ้าเป็นอย่างหลัง กลุ่มค้านจะกระจายรอบศูนย์ ไม่ใช่ติดลบเป็นระบบ)
 *   2) **เครื่องหมายไม่สลับระหว่าง train กับ test** ซึ่งเป็นด่านที่ตระกูล SMC
 *      และ TradePlan ตกทุกครั้ง (เอกสาร v3 หัวข้อ 7.1)
 *
 * ═══ สิ่งที่วัดแล้วไม่เอา ════════════════════════════════════════════════
 * • **Smart Money Concepts V2** ถูกตัดออกจากรายการตัวเร็ว แม้จะอยู่ในคำขอตั้งต้น
 *   เพราะแม้ใส่ชั้นทิศทางแล้วก็ยังสลับเครื่องหมาย train→test ทั้งสอง timeframe
 *   (15m N=80: +0.537% → −0.069% · 30m: +0.451% → −0.394%) ตรงกับที่หัวข้อ 7.1
 *   วัดไว้ว่าตระกูล SMC ไม่มีข้อมูลเชิงทิศทาง ผู้ที่มาแทนคือ UT Bot V2 ซึ่งถูกเลือก
 *   **จากช่วง train เท่านั้น** ในบรรดาผู้สมัครสามตัว (Supertrend V2 / UT Bot V2 / MACD V2)
 *   ด้วยเหตุผลว่ามีตัวอย่างมากที่สุด (680 เทียบกับ 118 และ 395) และค่า t สูงที่สุด
 *   (3.6–4.2 บน train) ไม่ใช่เพราะค่าเฉลี่ยสูงสุด — Supertrend มีค่าเฉลี่ยสูงกว่าเล็กน้อย
 *   แต่ตัวอย่างน้อยกว่าห้าเท่า
 * • **stop/target ตามราคา** ไม่ใส่ เพราะตระกูล TradePlan วัดแล้วว่าการครอบสัญญาณที่มี
 *   จังหวะเวลาของตัวเองด้วยกรอบ R ทำให้เสียความได้เปรียบ (หัวข้อ 9 ของเอกสารการวางแผน)
 *   การออกจึงมาจากสัญญาณล้วน ๆ เหมือน OrderFlow V3
 *
 * ═══ ข้อจำกัดเรื่อง timeframe ที่ต้องรู้ก่อนใช้ ══════════════════════════
 * ชั้นทิศทางต้องสะสม `flowLookbackDays + flowDebiasDays` = 125 วันก่อนให้ค่าแรก
 * คิดเป็นจำนวนแท่ง: 1m = 180,000 · 3m = 60,000 · 5m = 36,000 · 15m = 12,000 · 30m = 6,000
 * ขณะที่เว็บรับได้สูงสุด 10,000 แท่งต่อคำขอ **ใช้งานได้จริงบนเว็บจึงมีแต่ 30m**
 * ส่วน 15m ต้องโหลดผ่านสคริปต์วิจัยที่ไม่ติดเพดานนั้น
 * และบน 5m ลงไป ความได้เปรียบของกลุ่ม "เห็นด้วย" วัดได้เพียง +0.04% ถึง +0.12% ต่อไม้
 * ซึ่ง **ต่ำกว่าต้นทุนไป-กลับ 0.16%** จึงไม่ควรใช้
 *
 * ═══ สถานะ: วัดครบสองรอบ ลงทะเบียนหนึ่งตัว ═════════════════════════════
 * **รอบแรก** (`research-v3/flowgate-eval.ts`) ตั้งเกณฑ์สามข้อไว้ก่อนเห็นผล
 *   ข้อ 1 บวกทั้ง train และ test ทั้ง 15m และ 30m บน BTCUSDT — ผ่านทั้ง 5 ตัว
 *         และที่ราบของ `flowBand` เป็นบวกทั้งสองช่วง 29 จาก 30 ช่อง
 *   ข้อ 2 ชนะเส้นฐาน "ถือฝั่งเดียวตลอดเวลา" ในช่วง test — ผ่าน (เส้นฐาน −1.04% และ −5.76%)
 *   ข้อ 3 พอร์ต 4 เหรียญที่ไม่เคยถูกใช้เลือกค่าเลย ต้องบวกทั้งสองช่วง ทุก band
 *         ทั้ง 15m และ 30m (6/6) — **ตกทั้ง 5 ตัว**: utbot 4/6 · confluence 3/6 ·
 *         trendlines 1/6 · ema 0/6 · emaFiltered 0/6
 *
 * **รอบสอง** ไล่หาสาเหตุแทนการปรับค่าไปเรื่อย ๆ สมมติฐานตั้งต้นคือค่าตัวเร็ว
 * (EMA 20/50, ATR 10, pivot 14) เหมาะกับความผันผวนของ BTCUSDT เท่านั้น จึงควรปรับตาม ATR
 * ของแต่ละเหรียญ — `research-v3/flowgate-transfer.ts` วัดแล้ว **สมมติฐานนั้นผิด**
 *   • ตัวเร็วยิงถี่เท่ากันแทบทุกเหรียญ แม้ ATR ต่างกันถึง 1.66 เท่า (ต่อ 1000 แท่ง:
 *     trendlines 28.6–30.7 · ema 19.1–20.8 · utbot 119.9–132.7 · confluence 47.3–49.3)
 *     เพราะเกณฑ์ของ UT Bot และ Trendlines เป็นตัวคูณ ATR ของเหรียญนั้นเองอยู่แล้ว
 *     ส่วนจุดตัดของ EMA ขึ้นกับ**รูปร่าง**ของเส้นราคา ไม่ใช่ขนาดของมัน คูณผลตอบแทน
 *     ทั้งเส้นด้วย 1.4 แล้ว EMA ก็ยังตัดกันที่แท่งเดิม จึงไม่มีสเกลอะไรให้ปรับตั้งแต่ต้น
 *   • ในบรรดาแท่งที่ชั้นทิศทางเปิดทางอยู่แล้ว แท่งที่ตัวเร็วพาเข้ากับแท่งที่ตัวเร็วทำให้พลาด
 *     ต่างกันไม่เกิน 0.02% ต่อแท่ง และ |t| < 2 ใน 39 จาก 40 ช่อง — ตัวเร็วไม่ได้เลือกแท่งผิด
 *   • `research-v3/flowgate-ladder.ts` ไต่ทีละขั้นแล้วพบผู้ร้ายตัวจริงคือ **กฎการออก**
 *     ที่ตระกูลนี้ตรึงไว้ที่ขอบ band โดยไม่เคยตั้งคำถาม: เอา OrderFlow เปล่า ๆ มาใช้กฎ
 *     เดียวกันบนพอร์ต 4 เหรียญได้ −5.91%/−2.86% (15m band 0.01) และเทรด 706 ครั้ง
 *     เทียบกับ 166 ครั้งของกฎออกที่ศูนย์ ส่วนชั้นจังหวะที่เคยถูกกล่าวหากลับเป็นฝ่าย
 *     กู้สถานการณ์ — ใส่ตัวเร็วเข้าไปบนกฎออกเดิม ผลขึ้นเป็น +21.77%/+0.97%
 *
 * จึงเปิดพารามิเตอร์ `gateExitMult` แล้วเลือกค่าด้วยลำดับเดียวกับหัวข้อ 10 ของเอกสาร
 * (`flowgate-exit-select.ts`: มัธยฐานของ 18 ชุดค่าบน **train ของ BTCUSDT เท่านั้น**)
 * ได้ utbot 0 · emaFiltered 0 · trendlines 0.25 · ema −1 · confluence −1 ทุกตัวมีที่ราบรองรับ
 * แล้ววัดข้อ 3 ใหม่ทั้งหมด: **`utbot` ผ่าน 6/6** และชนะ `orderflow_v3_zero` ที่ลงทะเบียน
 * ไว้แล้วทั้งสองช่วงเวลาที่ band ตั้งต้น ส่วนที่เหลือยังตก (emaFiltered 3/6 ·
 * trendlines 2/6 · confluence 2/6 · ema 0/6)
 *
 * `flowgate_utbot_v3` จึงเป็นตัวเดียวที่ถูกลงทะเบียน อีกสี่ตัวยังอยู่ที่นี่ในฐานะ
 * **เส้นฐานที่วัดผลแล้ว** พร้อมให้รันซ้ำและต่อยอด ไม่ใช่กลยุทธ์ที่รอเปิดใช้
 * มีเทสต์บังคับไว้ว่ารหัส `flowgate*` ตัวอื่นต้องไม่โผล่ในทะเบียน
 */
export const FLOW_GATE_V3_DEFAULTS = {
  /** 1 = อนุญาตฝั่งซื้อ, 0 = ปิด (มาจากรหัสกลยุทธ์) */
  allowLong: 1,
  /** 1 = อนุญาตฝั่งขาย (ต้องเทรดบน futures), 0 = ปิด */
  allowShort: 1,

  // ── ชั้นทิศทาง: ค่าเดียวกับ OrderFlow V3 ทุกตัว เพราะผ่านการตรวจข้ามเหรียญมาแล้ว ──
  flowLookbackDays: 5,
  flowDebiasDays: 120,
  flowBand: 0.01,

  // ── ชั้นจังหวะ: ใช้ค่าตั้งต้นเดิมของอินดิเคเตอร์ต้นทางทุกตัว ไม่ปรับใหม่ ──
  /** Trendlines with Breaks: ความกว้าง pivot */
  trendLength: 14,
  /** Trendlines with Breaks: ตัวคูณความชัน */
  trendMult: 1,
  /** EMA Cross V2: EMA เร็ว */
  emaFastLength: 20,
  /** EMA Cross V2: EMA ช้า */
  emaSlowLength: 50,
  /** UT Bot V2: ตัวคูณ ATR ของแนวลาก */
  utBotKeyValue: 1,
  /** UT Bot V2: ช่วง ATR */
  utBotAtrLength: 10,

  // ── เฉพาะรหัสที่ต้องเห็นพ้องหลายตัว ──
  /** ต้องมีตัวเร็วอย่างน้อยกี่ตัวชี้ทางเดียวกัน */
  gateConfluenceMin: 2,
  /** นับว่า "เพิ่งชี้" ถ้าเกิดสัญญาณภายในกี่แท่งล่าสุด */
  gateConfluenceBars: 10,

  /**
   * 1 = ออกเมื่อตัวเร็วยิงสวนทางด้วย · 0 = ตัวเร็วมีหน้าที่เข้าอย่างเดียว ออกด้วยชั้นทิศทางล้วน
   *
   * ค่านี้สำคัญกว่าที่คิด เพราะความได้เปรียบที่วัดได้อยู่ที่ขอบเขต 40–80 แท่ง
   * ถ้าปล่อยให้ตัวเร็วสั่งออกด้วย ไม้จะถูกตัดก่อนถึงขอบเขตนั้นและจ่ายค่าธรรมเนียมซ้ำ ๆ
   * วัดบน UT Bot V2 ที่ยิงถี่ที่สุด: เปิดข้อนี้ได้ 680 ไม้ต่อครึ่งปีบน 15m
   * ซึ่งเป็นค่าธรรมเนียมล้วน ๆ 109% ของทุน
   */
  gateExitOnFlip: 0,
  /**
   * ระดับที่ชั้นทิศทางเลิกหนุนแล้วจึงออก คิดเป็นกี่เท่าของ `flowBand`
   * ความหมายเหมือน `flowExitMult` ของ OrderFlow V3 ทุกประการ
   *   +1 = ออกทันทีที่ค่าหลุดเกณฑ์เข้า · 0 = ออกเมื่อค่าข้ามศูนย์ · −1 = ออกเมื่อกลับข้างเต็มเกณฑ์
   *
   * เดิมตระกูลนี้ถูกตรึงไว้ที่ +1 โดยไม่ได้ตั้งคำถาม ซึ่ง `research-v3/flowgate-ladder.ts`
   * วัดได้ว่าเป็นสาเหตุหลักที่ย้ายข้ามเหรียญไม่ได้ ไม่ใช่ชั้นจังหวะอย่างที่เข้าใจกันตอนแรก
   */
  gateExitMult: 1,
  /** ขนาดไม้เป็น % ของพอร์ต */
  gateSizePct: 100,
  /** ช่วง ATR ที่ใช้รายงานความผันผวนอ้างอิง (ไม่ใช่ stop จริง) */
  atrPeriod: 14,
  /** EMA ที่ใช้แสดงผลเท่านั้น */
  fastPeriod: 21,
  trendPeriod: 55,
};
export type FlowGateV3Params = typeof FLOW_GATE_V3_DEFAULTS;

/** ตัวเร็วที่ใช้เป็นชั้นจังหวะ — เลือกด้วยรหัสกลยุทธ์ ไม่ใช่พารามิเตอร์ */
export type FlowGateTrigger = "trendlines" | "ema" | "emaFiltered" | "utbot" | "confluence";

/** ทิศที่ตัวเร็วยิงรายแท่ง: 1 ซื้อ, −1 ขาย, 0 ไม่ยิง */
function triggerDirections(k: KlineData[], p: FlowGateV3Params, which: FlowGateTrigger): number[] {
  const n = k.length;
  const dirOf = (s: V2Signal) => (s === "BUY" ? 1 : s === "SELL" ? -1 : 0);
  if (which === "trendlines") {
    const tl = trendlinesWithBreaks(k, Math.max(2, Math.round(p.trendLength)), p.trendMult, "Atr", true);
    return tl.breakUp.map((up, i) => (up ? 1 : tl.breakDown[i] ? -1 : 0));
  }
  if (which === "ema" || which === "emaFiltered") {
    const r = emaV2(k, { emaFastLength: p.emaFastLength, emaSlowLength: p.emaSlowLength }, 0);
    const src = which === "ema" ? r.signal : r.signalFiltered;
    return src.map(dirOf);
  }
  if (which === "utbot") {
    const r = utBotV2(k, { utBotKeyValue: p.utBotKeyValue, utBotAtrLength: p.utBotAtrLength }, 0);
    return r.signal.map(dirOf);
  }
  // confluence: ต้องมีตัวเร็วอย่างน้อย gateConfluenceMin ตัวยิงทางเดียวกันภายในหน้าต่างล่าสุด
  const parts = [
    triggerDirections(k, p, "trendlines"),
    triggerDirections(k, p, "ema"),
    triggerDirections(k, p, "utbot"),
  ];
  const window = Math.max(1, Math.round(p.gateConfluenceBars));
  const need = Math.max(1, Math.min(parts.length, Math.round(p.gateConfluenceMin)));
  // แท่งล่าสุดที่แต่ละตัวยิงไปทางไหน — ใช้เฉพาะแท่งที่ผ่านมาแล้ว จึงไม่มองอนาคต
  const lastBar = parts.map(() => -1), lastDir = parts.map(() => 0);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < parts.length; t++)
      if (parts[t][i] !== 0) { lastBar[t] = i; lastDir[t] = parts[t][i]; }
    let up = 0, dn = 0;
    for (let t = 0; t < parts.length; t++) {
      if (lastBar[t] < 0 || i - lastBar[t] >= window) continue;
      if (lastDir[t] > 0) up++; else if (lastDir[t] < 0) dn++;
    }
    // ยิงเฉพาะแท่งที่เพิ่งครบเงื่อนไข ไม่ใช่ทุกแท่งที่เงื่อนไขยังเป็นจริง
    const fired = parts.some((q) => q[i] !== 0);
    if (fired && up >= need && dn === 0) out[i] = 1;
    else if (fired && dn >= need && up === 0) out[i] = -1;
  }
  return out;
}

/**
 * ชั้นทิศทางช้า × ชั้นจังหวะเร็ว
 *
 * ทุกแท่ง (ใช้ข้อมูลถึงแท่งปัจจุบันเท่านั้น)
 *   1) bias = +1 / −1 / 0 จากแรงซื้อขายสุทธิเทียบ `flowBand`
 *   2) ถ้าว่าง: เข้าเมื่อตัวเร็วยิงทิศ d และ bias เท่ากับ d และรหัสอนุญาตทิศนั้น
 *   3) ถ้าถืออยู่: ออกเมื่อ bias เลิกเห็นด้วย (เป็นกลางหรือกลับข้าง) หรือตัวเร็วยิงสวน
 *      ถ้าออกเพราะตัวเร็วยิงสวน **และ** bias เห็นด้วยกับทิศใหม่ ให้พลิกข้างทันที
 *
 * ไม่มี stop ตามราคา — เหตุผลอยู่ในหัวข้อ "สิ่งที่วัดแล้วไม่เอา" ข้างบน
 */
export function flowGateV3(
  k: KlineData[],
  trigger: FlowGateTrigger,
  overrides: Partial<FlowGateV3Params> | Record<string, number> = {},
  startIndex = 0,
): V3Result {
  const p = { ...FLOW_GATE_V3_DEFAULTS, ...overrides } as FlowGateV3Params;
  for (const [key, v] of Object.entries(p))
    if (!Number.isFinite(v) || (v < 0 && key !== "gateExitMult"))
      throw new Error(`Invalid FlowGate V3 parameter: ${key}`);
  if (p.gateExitMult > 1 || p.gateExitMult < -1)
    throw new Error("FlowGate V3 requires -1 <= gateExitMult <= 1");
  if (p.flowLookbackDays <= 0 || p.flowDebiasDays <= 0)
    throw new Error("FlowGate V3 requires positive lookback and debias windows");
  if (p.flowLookbackDays >= p.flowDebiasDays)
    throw new Error("FlowGate V3 requires flowLookbackDays < flowDebiasDays");
  if (p.flowBand <= 0 || p.flowBand >= 1)
    throw new Error("FlowGate V3 requires 0 < flowBand < 1");
  if (p.emaFastLength >= p.emaSlowLength)
    throw new Error("FlowGate V3 requires emaFastLength < emaSlowLength");
  if (p.gateSizePct <= 0 || p.gateSizePct > 100)
    throw new Error("FlowGate V3 requires 0 < gateSizePct <= 100");
  if (p.allowLong < 0.5 && p.allowShort < 0.5)
    throw new Error("FlowGate V3 requires at least one direction enabled");
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > k.length)
    throw new Error("Invalid FlowGate V3 startIndex");

  const n = k.length;
  const c = closes(k);
  const tfMinutes = detectTimeframeMinutes(k);
  const perDay = tfMinutes > 0 ? 1440 / tfMinutes : 1;
  const L = Math.max(1, Math.round(p.flowLookbackDays * perDay));
  const M = Math.max(2, Math.round(p.flowDebiasDays * perDay));
  const flow = removeOwnMean(orderFlowImbalance(k, L), M);
  const dirs = triggerDirections(k, p, trigger);
  const size = p.gateSizePct / 100;
  const exitLevel = p.flowBand * p.gateExitMult;

  const blank = (): Series => new Array(n).fill(null);
  const triggerSeries: Series = dirs.map((d) => d);
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
    triggerDir: triggerSeries,
  };

  let dir = 0;
  for (let i = 0; i < n; i++) {
    r.utcHour[i] = new Date(k[i].openTime).getUTCHours();
    const v = flow[i];
    if (v === null) {
      r.reason[i] = `รอสะสมแรงซื้อขายสุทธิ: มี ${i + 1} แท่ง ต้องมี ${L + M - 1} แท่ง (ขาดอีก ${L + M - 1 - (i + 1)})`;
      dir = 0; continue;
    }
    const bias = v > p.flowBand ? 1 : v < -p.flowBand ? -1 : 0;
    r.regime[i] = bias > 0 ? "uptrend" : bias < 0 ? "downtrend" : "range";
    if (i < startIndex) { r.reason[i] = "warmup (no position)"; dir = 0; continue; }

    const fired = dirs[i];
    const allowed = (d: number) => (d === 1 ? p.allowLong >= 0.5 : p.allowShort >= 0.5);
    const prev = dir;
    const pct = (v * 100).toFixed(2);

    const flipExit = p.gateExitOnFlip >= 0.5 && fired === -dir;
    // ถือต่อตราบที่แรงซื้อขายสุทธิยังอยู่ฝั่งเดียวกันเกินระดับออก — ที่ gateExitMult = 1
    // เงื่อนไขนี้เท่ากับ `bias === dir` พอดี จึงเป็นค่าที่รักษาพฤติกรรมเดิมไว้ทุกประการ
    const holding = dir === 1 ? v > exitLevel : dir === -1 ? v < -exitLevel : false;
    if (dir !== 0 && (!holding || flipExit)) {
      // ตัวเร็วยิงสวนขณะที่ชั้นทิศทางเห็นด้วยกับทิศใหม่ = พลิกข้างทันที
      dir = fired === -prev && bias === -prev && allowed(-prev) ? -prev : 0;
    }
    if (dir === 0 && fired !== 0 && bias === fired && allowed(fired)) dir = fired;

    r.direction[i] = dir;
    r.exposure[i] = dir * size;
    if (dir !== 0) {
      r.size[i] = size;
      r.confidence[i] = Math.min(1, Math.abs(v) / (p.flowBand * 4));
    }
    if (dir !== prev) {
      if (prev !== 0 && dir === 0) {
        r.signal[i] = prev === 1 ? "SELL" : "COVER";
        r.reason[i] = !holding
          ? `ออก: แรงซื้อขายสุทธิเลิกหนุน (${pct}%)`
          : `ออก: ตัวเร็วยิงสวนทาง (แรงซื้อขายสุทธิ ${pct}%)`;

      } else {
        r.signal[i] = dir === 1 ? "BUY" : "SHORT";
        r.reason[i] = `${dir === 1 ? "ซื้อ" : "ขาย"}: ตัวเร็วให้จังหวะและแรงซื้อขายสุทธิ ${pct}% เห็นด้วย`;
      }
    } else if (dir !== 0) {
      r.reason[i] = `ถือ${dir === 1 ? "ซื้อ" : "ขาย"}: แรงซื้อขายสุทธิ ${pct}%`;
    } else if (fired !== 0) {
      r.reason[i] = `ข้าม: ตัวเร็วยิง${fired === 1 ? "ซื้อ" : "ขาย"} แต่แรงซื้อขายสุทธิ ${pct}% ไม่เห็นด้วย`;
    } else {
      r.reason[i] = `ว่าง: รอจังหวะจากตัวเร็ว (แรงซื้อขายสุทธิ ${pct}%)`;
    }
  }
  return r;
}

/** กฎฉบับเต็มของตระกูล FlowGate สำหรับไฟล์ Export */
export const FLOW_GATE_RULE_TH =
  "FlowGate V3 ประกอบสองชั้นเข้าด้วยกัน: ชั้นทิศทางช้าจากแรงซื้อขายสุทธิ (order-flow imbalance) " +
  "และชั้นจังหวะเร็วจากอินดิเคเตอร์ราคา. " +
  "ชั้นทิศทางคำนวณเหมือน OrderFlow V3 ทุกประการ: ofi = ผลรวม(2 x takerBuyBase - volume) หารด้วย ผลรวม(volume) " +
  "ย้อนหลัง flowLookbackDays วัน แล้วลบค่าเฉลี่ยเคลื่อนที่ของตัวเอง flowDebiasDays วันออก " +
  "ได้ bias = +1 เมื่อค่าเกิน flowBand, -1 เมื่อต่ำกว่า -flowBand, 0 เมื่ออยู่ระหว่างกลาง. " +
  "เข้าไม้เมื่อ **ตัวเร็วยิงและ bias เห็นด้วยกับทิศนั้น** เท่านั้น ถ้าตัวเร็วยิงสวนทาง bias จะไม่เข้า. " +
  "ออกเมื่อแรงซื้อขายสุทธิกลับเข้ามาถึง gateExitMult เท่าของ flowBand (ค่า 0 = ออกเมื่อข้ามศูนย์) " +
  "และพลิกข้างทันทีเมื่อตัวเร็วยิงสวนขณะที่ bias เห็นด้วยกับทิศใหม่. " +
  "ไม่มี stop loss ตามราคา เพราะตระกูล TradePlan วัดแล้วว่าการครอบสัญญาณที่มีจังหวะของตัวเองด้วยกรอบ R " +
  "ทำให้เสียความได้เปรียบ (เอกสาร trade-planning-1m-30m-th.md หัวข้อ 9). " +
  "หลักฐานที่ทำให้เชื่อว่าชั้นทิศทางมีผลจริง: วัดผลตอบแทนล่วงหน้า 80 แท่งในทิศที่ตัวเร็วบอกโดยยังไม่มีกฎการออก " +
  "แล้วแยกกลุ่ม พบว่ากลุ่มที่ bias เห็นด้วยเป็นบวกทั้ง train และ test ขณะที่กลุ่มที่ bias ค้านติดลบเป็นระบบ " +
  "และเครื่องหมายไม่สลับระหว่าง train กับ test ซึ่งเป็นด่านที่ตระกูล SMC และ TradePlan ตกทุกครั้ง. " +
  "ข้อจำกัดเรื่อง timeframe: ชั้นทิศทางต้องสะสม flowLookbackDays + flowDebiasDays = 125 วันก่อนให้ค่าแรก " +
  "คิดเป็น 12,000 แท่งที่ 15m และ 6,000 แท่งที่ 30m ขณะที่เว็บรับได้สูงสุด 10,000 แท่งต่อคำขอ " +
  "ใช้งานบนเว็บได้จริงจึงมีแต่ 30m ส่วน 15m ต้องโหลดผ่านสคริปต์วิจัย " +
  "และบน 5m ลงไปไม่ควรใช้ เพราะความได้เปรียบของกลุ่มที่ bias เห็นด้วยวัดได้เพียง 0.04-0.12% ต่อไม้ " +
  "ซึ่งต่ำกว่าต้นทุนไป-กลับ 0.16%";

// ══ 5) ทะเบียนกลยุทธ์ v3 — จุดต่อขยายเดียวของทั้งระบบ ══════════
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
  | "orderflow_v3_short"
  | "flowgate_utbot_v3";

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
  /**
   * จำนวนแท่งอุ่นเครื่องที่ควรโหลดก่อนช่วงที่จะประเมินผล
   * ผู้เรียกที่รู้ timeframe ต้องส่ง `timeframeMinutes` มาด้วย มิฉะนั้นจะได้ค่าประมาณที่น้อยเกินไป
   */
  warmupBars: (params: Record<string, number>, timeframeMinutes?: number) => number;
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
/** ค่าตั้งต้นของ FlowGate โดยตัดทิศทางออก เพราะทิศมาจากรหัสกลยุทธ์ */
function flowGateDefaults(overrides: Record<string, number> = {}): Record<string, number> {
  const { allowLong: _l, allowShort: _s, ...rest } = FLOW_GATE_V3_DEFAULTS;
  return { ...rest, ...overrides };
}
function flowGateValidate(p: Record<string, number>): string | null {
  if (p.flowLookbackDays >= p.flowDebiasDays)
    return "ช่วงสะสมต้องสั้นกว่าช่วงลบค่าเฉลี่ย มิฉะนั้นการลบค่าเฉลี่ยจะหักล้างสัญญาณทิ้ง";
  if (p.emaFastLength >= p.emaSlowLength) return "EMA เร็วต้องสั้นกว่า EMA ช้า";
  if (p.fastPeriod >= p.trendPeriod) return "EMA เร็วต้องสั้นกว่า EMA เทรนด์";
  if (p.gateExitMult > 1 || p.gateExitMult < -1) return "ระดับการออกต้องอยู่ระหว่าง -1 ถึง 1";
  return null;
}
function orderFlowValidate(p: Record<string, number>): string | null {
  if (p.flowLookbackDays >= p.flowDebiasDays)
    return "ช่วงสะสมต้องสั้นกว่าช่วงลบค่าเฉลี่ย มิฉะนั้นการลบค่าเฉลี่ยจะหักล้างสัญญาณทิ้ง";
  if (p.fastPeriod >= p.trendPeriod) return "EMA เร็วต้องสั้นกว่า EMA เทรนด์";
  return null;
}
/**
 * จำนวนแท่งที่ชั้นทิศทางต้องมีก่อนให้ค่าแรก
 *
 * หน้าต่างถูกกำหนดเป็น **วัน** จำนวนแท่งจึงคำนวณไม่ได้จนกว่าจะรู้ว่าแต่ละแท่งกว้างกี่นาที
 * เดิมฟังก์ชันนี้คืนค่าคงที่ 2,000 เสมอ ซึ่ง **น้อยกว่าที่ต้องใช้จริงทุก timeframe**
 * (30m ต้องการ 6,000 · 15m 12,000 · 1m 180,000) ผลคือทั้งเว็บและบอทเตรียมแท่งไม่พอ
 * แล้วไม่มีสัญญาณออกมาเลยแม้แต่ครั้งเดียว — เป็นสาเหตุที่วัดได้ของอาการ "ไม่มีสัญญาณ"
 * ตอนนี้จึงคำนวณจาก timeframe จริงเมื่อผู้เรียกบอกมา และคงค่าเดิมไว้เมื่อไม่รู้
 */
const orderFlowWarmup = (p: Record<string, number>, timeframeMinutes?: number) => {
  if (!timeframeMinutes || timeframeMinutes <= 0) return 2000;
  const days = (p.flowLookbackDays ?? 5) + (p.flowDebiasDays ?? 120);
  // +2 แท่งกันการปัดเศษ เพื่อให้แท่งแรกของช่วงที่ผู้ใช้เลือกมีค่าสัญญาณแล้วจริง ๆ
  return Math.ceil((days * 1440) / timeframeMinutes) + 2;
};

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
  gate:
    "รหัสนี้เปิดทั้งสองฝั่ง และเป็นตัวเดียวในตระกูล FlowGate ที่ถูกลงทะเบียน. " +
    "ที่มาของ gateExitMult = 0: ตระกูลนี้เคยตรึงกฎการออกไว้ที่ขอบ band แล้วตกด่านตรวจข้ามเหรียญทั้ง 5 ตัว. " +
    "การไล่หาสาเหตุ (research-v3/flowgate-transfer.ts) ตัดสมมติฐานเรื่องสเกลของตัวเร็วออกไปก่อน " +
    "เพราะตัวเร็วยิงถี่เท่ากันแทบทุกเหรียญแม้ ATR ต่างกัน 1.66 เท่า และแท่งที่ตัวเร็วพาเข้ากับแท่งที่ทำให้พลาด " +
    "ต่างกันไม่เกิน 0.02% ต่อแท่ง. บันไดแยกสาเหตุ (flowgate-ladder.ts) ชี้ไปที่กฎการออก: " +
    "OrderFlow เปล่า ๆ ที่ใช้กฎออกที่ขอบ band ได้ -5.91%/-2.86% บนพอร์ต 4 เหรียญและเทรด 706 ครั้ง " +
    "เทียบกับ 166 ครั้งของกฎออกที่ศูนย์. " +
    "ค่า 0 ถูกเลือกด้วยค่ามัธยฐานของ 18 ชุดค่าบนช่วง train ของ BTCUSDT เท่านั้น (28.28% เทียบกับ 14.95% ของค่าเดิม 1) " +
    "แล้วจึงวัดด่านข้ามเหรียญครั้งเดียว: พอร์ต ETH/SOL/BNB/XRP เป็นบวกทั้งสองช่วง ทุก band ทั้ง 15m และ 30m ครบ 6 จาก 6 ช่อง " +
    "และชนะ orderflow_v3_zero ทั้งสองช่วงที่ band ตั้งต้น (15m 11.61%/9.47% เทียบกับ 6.16%/8.53% · 30m 16.78%/9.82% เทียบกับ 3.25%/8.54%). " +
    "ที่ราบรองรับกว้าง: เปลี่ยน utBotAtrLength เป็น 5/7/14/20 และ utBotKeyValue เป็น 0.5/0.75/1.5/2 ยังได้ 6 จาก 6 ช่องทุกแบบ. " +
    "ข้อจำกัด: รายเหรียญยังมีตัวที่ขาดทุน (XRP ติดลบทั้งสองช่วงบน 30m) ผลบวกจึงมาจากการกระจายพอร์ต ไม่ใช่จากทุกเหรียญ " +
    "และ gateExitMult ค่าข้างเคียง (0.25, 0.5, -0.5) ได้เพียง 4 จาก 6 ช่อง ค่านี้จึงไวกว่าพารามิเตอร์ตัวอื่น. " +
    "ใช้งานบนเว็บได้เฉพาะ 30m เพราะชั้นทิศทางต้องสะสม 125 วัน = 12,000 แท่งที่ 15m ซึ่งเกินเพดาน 10,000 แท่งต่อคำขอ",
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
  flowgate_utbot_v3: {
    name: "FlowGate UT Bot V3 (สองทาง)",
    th: "แรงซื้อขายสุทธิเป็นชั้นทิศทาง UT Bot V2 เป็นชั้นจังหวะ เข้าเฉพาะเมื่อทั้งสองชั้นเห็นตรงกัน ออกเมื่อแรงซื้อขายสุทธิข้ามศูนย์ เป็นตัวเดียวในตระกูล FlowGate ที่ผ่านการตรวจข้ามเหรียญ 6 จาก 6 ช่อง และชนะ orderflow_v3_zero ทั้งสองช่วงเวลา ใช้ได้จริงบนเว็บเฉพาะ 30m เพราะชั้นทิศทางต้องสะสม 125 วัน",
    en: "Net taker flow as the direction layer, UT Bot V2 as the timing layer; enters only when both agree and exits when flow crosses zero. The only FlowGate variant that clears the cross-coin bar 6/6 and beats orderflow_v3_zero in both windows. Web-usable at 30m only, since the direction layer needs 125 days of history",
    group: FLOW_GROUP,
    overlay: FLOW_OVERLAY,
    direction: { allowLong: 1, allowShort: 1 },
    defaults: flowGateDefaults({ gateExitMult: 0 }),
    compute: (k, params, startIndex) => flowGateV3(k, "utbot", params, startIndex),
    warmupBars: orderFlowWarmup,
    validate: flowGateValidate,
    rule: `${FLOW_GATE_RULE_TH}. ${SCOPE.gate}`,
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
export function v3WarmupBars(
  id: V3StrategyId,
  params: Record<string, number> = {},
  timeframeMinutes?: number,
): number {
  const def = V3_REGISTRY[id];
  return def.warmupBars({ ...def.defaults, ...params }, timeframeMinutes);
}

/** กฎฉบับเต็มของแต่ละรหัส ใช้ในไฟล์ Export */
export function v3RuleFor(id: V3StrategyId): string {
  return V3_REGISTRY[id].rule;
}

/**
 * สรุปของแท่งเดียวสำหรับคนที่ต้องตัดสินใจจากสัญญาณสด (บอท Telegram)
 *
 * สัญญาณ BUY/SELL บอกแค่ว่า "เกิดอะไรขึ้น" แต่ไม่บอกว่าสัญญาณแรงแค่ไหน
 * หรือต้องเกิดอะไรจึงจะออก ซึ่งกลยุทธ์ v3 ไม่มี stop ตามราคา — การออกมาจากค่าสัญญาณล้วน
 * ผู้ถือสถานะจึงต้องรู้ **ระดับที่จะออก** เป็นตัวเลข ไม่ใช่รอให้บอทบอกทีหลัง
 */
export interface V3BarInsight {
  /** ชั้นทิศทางสะสมครบแล้วหรือยัง — false = ยังให้สัญญาณไม่ได้ */
  ready: boolean;
  reason: string;
  /** 1 = ถือซื้อ, −1 = ถือขาย, 0 = ว่าง */
  direction: number;
  /** แรงซื้อขายสุทธิหลังลบอคติ (สัดส่วน เช่น 0.012 = 1.2%) */
  flow: number | null;
  /** เกณฑ์เข้า: ซื้อเมื่อ flow > +entryBand, ขายเมื่อ flow < −entryBand */
  entryBand: number;
  /**
   * ระดับที่สถานะปัจจุบันจะถูกปิด (มีเครื่องหมายแล้ว)
   * ถือซื้อ: ออกเมื่อ flow < exitLevel · ถือขาย: ออกเมื่อ flow > exitLevel · ว่าง: null
   */
  exitLevel: number | null;
  confidence: number | null;
  /** ATR เป็น % ของราคาปิด — ขนาดการแกว่งปกติของหนึ่งแท่ง */
  atrPct: number | null;
  /** จำนวนแท่งที่ต้องมีเทียบกับที่มี ใช้บอกว่าทำไมยังไม่พร้อม */
  barsNeeded: number;
  barsHave: number;
}

export function v3BarInsight(
  id: V3StrategyId, k: KlineData[], r: V3Result, i: number, params: Record<string, number> = {},
): V3BarInsight {
  const p = { ...V3_REGISTRY[id].defaults, ...params };
  const band = p.flowBand ?? ORDER_FLOW_V3_DEFAULTS.flowBand;
  const mult = p.flowExitMult ?? p.gateExitMult ?? ORDER_FLOW_V3_DEFAULTS.flowExitMult;
  const dir = r.direction[i] ?? 0;
  const flow = r.signalValue[i] ?? null;
  const a = r.atr[i], c = Number(k[i]?.close);
  return {
    ready: flow !== null,
    reason: r.reason[i] ?? "",
    direction: dir,
    flow,
    entryBand: band,
    exitLevel: dir === 0 ? null : dir * band * mult,
    confidence: r.confidence[i] ?? null,
    atrPct: a !== null && a !== undefined && c > 0 ? (a / c) * 100 : null,
    barsNeeded: r.resolvedLookbackBars + r.resolvedDebiasBars - 1,
    barsHave: k.length,
  };
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
  // ── ตระกูล FlowGate ──
  trendLength: bars("Trendlines: ความกว้าง pivot", 2, 200),
  trendMult: pct("Trendlines: ตัวคูณความชัน", 0.1, 10, 0.1),
  emaFastLength: bars("EMA Cross: EMA เร็ว", 2, 200),
  emaSlowLength: bars("EMA Cross: EMA ช้า", 3, 400),
  utBotKeyValue: pct("UT Bot: ตัวคูณ ATR ของแนวลาก", 0.1, 10, 0.05),
  utBotAtrLength: bars("UT Bot: ช่วง ATR", 2, 200),
  gateConfluenceMin: bars("ต้องมีตัวเร็วเห็นพ้องกี่ตัว", 1, 3),
  gateConfluenceBars: bars("นับว่าเพิ่งยิงภายในกี่แท่ง", 1, 200),
  gateExitOnFlip: bars("ให้ตัวเร็วสั่งออกด้วย (0 = ไม่, 1 = ใช่)", 0, 1),
  gateExitMult: ratio("ชั้นทิศทางเลิกหนุนที่กี่เท่าของเกณฑ์ (0 = ข้ามศูนย์)", -1, 1, 0.05),
  gateSizePct: pct("ขนาดไม้ (% ของพอร์ต)", 1, 100, 1),
  atrPeriod: bars("ช่วง ATR", 2, 200),
  fastPeriod: bars("EMA เร็ว", 2, 200),
  trendPeriod: bars("EMA เทรนด์", 3, 400),
};
