/**
 * indicators-v3-OrderFlow.ts — กลยุทธ์ที่ขับด้วยแรงซื้อขายสุทธิ (order-flow imbalance)
 *
 * ═══ ทำไมถึงมีไฟล์นี้ ════════════════════════════════════════════════════
 * ตระกูลสัญญาณ SMC ของ `indicators-v3-ShortTrade.ts` วัดแล้วว่า **ไม่มีข้อมูล
 * เชิงทิศทางเลย** — ผลตอบแทนล่วงหน้า 5–80 แท่งในทิศที่สัญญาณบอก มีค่า t ระหว่าง
 * −2.15 ถึง +2.10 และสลับเครื่องหมายระหว่างช่วง train กับ test ทุกครั้ง
 * เมื่อจังหวะเข้าไม่มีความได้เปรียบ ไม่มีกฎการออกหรือขนาดไม้ใดทำให้เป็นบวกได้
 *
 * ไฟล์นี้จึงเปลี่ยน "ที่มาของสัญญาณ" แทนที่จะปรับค่าของสัญญาณเดิม
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
 * • ผลรายเหรียญไม่สม่ำเสมอ — XRP ขาดทุนตลอดชุด ส่วน ETH แทบเสมอตัว
 *   **ต้องกระจายหลายเหรียญ** ผลของเหรียญเดียวมีความผันผวนสูงเกินกว่าจะพึ่งได้
 * • drawdown ของพอร์ตอยู่ที่ 14–18% ซึ่งสูงเมื่อเทียบกับผลตอบแทน
 * • ต้องมีข้อมูลย้อนหลังราว lookbackDays + debiasDays (ค่าตั้งต้น = 125 วัน)
 *   ก่อนจึงจะเริ่มให้สัญญาณ ช่วงก่อนหน้านั้นจะเป็นสถานะว่างและบอกเหตุผลไว้
 * • ใช้ taker volume ของตลาด Spot ส่วนการเปิด Short ต้องทำบน perpetual futures
 *   ซึ่งมี order flow คนละชุด
 * • ถือสถานะเฉลี่ยหลายวัน จึงเป็นกลยุทธ์ swing ที่ใช้แท่ง 15m/30m เป็นตัวสุ่มสัญญาณ
 *   ไม่ใช่การเทรดรายวันแบบ ShortTrade V3
 */
import type { KlineData } from "@/lib/types/kline";
import type { V3Result, V3Signal } from "@/lib/indicators-v3-core";
import { atr, ema, closes, type Series } from "@/lib/indicators-v2";

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
  /** ช่วง ATR ที่ใช้รายงานความเสี่ยงอ้างอิง (ไม่ใช่ stop จริง) */
  atrPeriod: 14,
  /** EMA ที่ใช้แสดงผลเท่านั้น */
  fastPeriod: 21,
  trendPeriod: 55,
};
export type OrderFlowV3Params = typeof ORDER_FLOW_V3_DEFAULTS;

/** อ่านระยะห่างเวลาระหว่างแท่งเป็นนาที ใช้ค่ามัธยฐานกันข้อมูลขาดหาย */
function timeframeMinutes(k: KlineData[]): number {
  if (k.length < 3) return 0;
  const gaps: number[] = [];
  for (let i = 1; i <= Math.min(k.length - 1, 200); i++) {
    const gap = k[i].openTime - k[i - 1].openTime;
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] / 60000;
}

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
  const tfMinutes = timeframeMinutes(k);
  const perDay = tfMinutes > 0 ? 1440 / tfMinutes : 1;
  const L = Math.max(1, Math.round(p.flowLookbackDays * perDay));
  const M = Math.max(2, Math.round(p.flowDebiasDays * perDay));

  const raw = orderFlowImbalance(k, L);
  const flow = removeOwnMean(raw, M);
  const av = atr(k, Math.max(2, Math.round(p.atrPeriod)));
  const fast = ema(c, Math.max(2, Math.round(p.fastPeriod)));
  const trend = ema(c, Math.max(3, Math.round(p.trendPeriod)));
  const size = p.flowSizePct / 100;
  const exit = p.flowBand / 2;

  const blank = (): Series => new Array(n).fill(null);
  const r: V3Result = {
    exposure: new Array(n).fill(0),
    signal: new Array(n).fill(null) as V3Signal[],
    reason: new Array(n).fill("รอสะสมแรงซื้อขายสุทธิให้ครบหน้าต่าง"),
    regime: new Array(n).fill("warmup"),
    setup: new Array(n).fill(null),
    direction: new Array(n).fill(0),
    size: blank(), confidence: blank(), stop: blank(), target: blank(),
    initialRisk: blank(), netRewardRisk: blank(),
    atr: av, fastEMA: fast, trendEMA: trend,
    rsi: blank(), adx: blank(), plusDI: blank(), minusDI: blank(),
    volumeRatio: flow,            // คอลัมน์นี้แสดงค่าสัญญาณหลักของกลยุทธ์นี้
    internalSupport: blank(), internalResistance: blank(),
    swingSupport: blank(), swingResistance: blank(),
    utcHour: blank(), sessionOk: new Array(n).fill(null),
    timeframeMinutes: tfMinutes,
    resolvedHoldBars: 0,
    resolvedSetupBars: L,
    resolvedCooldownBars: M,
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

/** จำนวนแท่งที่ต้องมีก่อนกลยุทธ์จะเริ่มให้สัญญาณ ขึ้นกับ timeframe จึงคืนเป็นวัน */
export function orderFlowWarmupDays(params: Record<string, number> = {}): number {
  const p = { ...ORDER_FLOW_V3_DEFAULTS, ...params };
  return Math.ceil(p.flowLookbackDays + p.flowDebiasDays);
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
  "ผลรายเหรียญไม่สม่ำเสมอ XRP ขาดทุนตลอดชุดและ ETH แทบเสมอตัว จึงต้องกระจายหลายเหรียญ; " +
  "drawdown ของพอร์ต 14-18%; ต้องมีข้อมูลย้อนหลังราว flowLookbackDays + flowDebiasDays วันก่อนเริ่มให้สัญญาณ; " +
  "ใช้ taker volume ของตลาด Spot ขณะที่การเปิด Short ต้องทำบน perpetual futures ซึ่งมี order flow คนละชุด; " +
  "ถือสถานะเฉลี่ยหลายวัน จึงเป็นกลยุทธ์ swing ที่ใช้แท่ง 15m/30m เป็นตัวสุ่มสัญญาณ ไม่ใช่การเทรดรายวัน";
