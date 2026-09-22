/**
 * indicators-v3-ShortTrade.ts — อินดิเคเตอร์ SMC เทรดสั้น (เส้นฐานงานวิจัย)
 *
 * **ไม่ใช่กลยุทธ์ที่เลือกได้ในเว็บ** — วัดบน BTCUSDT เต็มปีแล้วขาดทุนทุก timeframe
 * และพิสูจน์ได้ว่าแก้ด้วยการปรับค่าไม่ได้ (ดู `indicators-v3-shorttrade-th.md` หัวข้อ 7)
 * จึงถูกถอดออกจาก `V3_REGISTRY` เหลือไว้เพื่อสองอย่างเท่านั้น:
 *   1) ใช้เป็นเส้นฐานเทียบในสคริปต์ `signal-bot/web ui/research-v3/`
 *   2) เป็นตัวอย่างที่ครบถ้วนของกลยุทธ์ที่คืน `V3Result` ตามสัญญาของแกนกลาง
 *
 * ชนิดผลลัพธ์ ทะเบียนกลยุทธ์ และป้ายพารามิเตอร์ของกลยุทธ์ที่ลงทะเบียนจริง
 * อยู่ใน `indicators-v3-core.ts` ไม่ได้อยู่ในไฟล์นี้
 *
 * ต้นแบบ: `smcAdaptiveShort` ใน lib/indicators.ts (v1) ซึ่งเป็น Spot ทางเดียว
 * คณิตศาสตร์พื้นฐาน: ใช้ร่วมกับ lib/indicators-v2.ts เพื่อไม่ให้มีสูตรซ้ำสองชุด
 *
 * ═══ ทำไมต้องมี v3 ═══════════════════════════════════════════════════════
 * v1 ตั้งเงื่อนไขเข้มจนแทบไม่ทำอะไร วัดจาก BTCUSDT 1,000 แท่งต่อ timeframe
 * ได้ 0 / 3 / 2 / 7 เทรด (1m / 3m / 5m / 15m) ซึ่งน้อยเกินกว่าจะสรุปอะไรได้
 * และกำไรของ 15m พึ่งเทรดเดียว (ถ้าเอาเทรดที่ดีที่สุดออกเหลือ −0.69%)
 * v3 แก้สี่สาเหตุที่วัดได้ ไม่ใช่การลดความเข้มแบบสุ่ม
 *
 *  1) เทรดได้ทางเดียว — ในกราฟ 1–15 นาที ครึ่งหนึ่งของการเคลื่อนไหวเป็นขาลง
 *     v1 ปล่อยทิ้งทั้งหมด v3 ทำสัญญาณฝั่งขายแบบสะท้อนกระจกครบทุกกฎ
 *  2) เป้าหมายไม่สมจริง — v1 ใช้ `targetAtr = 14` ซึ่งไม่ใช่ระยะของการเทรดสั้น
 *     และเมื่อไม่มีแนวต้านเหนือราคา เป้าจะกลายเป็น 14 ATR ทำให้ผ่าน cost gate
 *     ง่ายเกินจริงทั้งที่ราคาไปไม่ถึง v3 ลดเพดานเป็น 3 ATR และผูกกับเวลาถือ
 *  3) พารามิเตอร์ชุดเดียวใช้ทั้ง 4 timeframe — 1m กับ 15m ต่างกัน 15 เท่า
 *     แต่ v1 ใช้ `maxHoldBars` เท่ากัน v3 ตั้งค่าเป็น "นาที" แล้วแปลงเป็นแท่งเอง
 *  4) ไม่มีตัวกรองเวลา — ทั้งที่คริปโตมี intraday seasonality ชัดเจน
 *
 * ═══ ข้อมูลที่ใช้ออกแบบ ═════════════════════════════════════════════════
 * • ช่วงเวลา: volume และความผันผวนของ BTC กระจุกในชั่วโมงที่ตลาดหุ้นยุโรป/สหรัฐ
 *   เปิด และต่ำสุดราว 03:00–04:00 UTC จึงเพิ่ม `sessionMode` ให้เลี่ยงชั่วโมงเงียบได้
 * • รูปแบบผลตอบแทน: งานวิจัย intraday ของคริปโตพบทั้ง momentum และ reversal
 *   โดย reversal เป็นลักษณะเฉพาะของคริปโต (อธิบายด้วย overreaction ต่อข้อมูล
 *   ที่ไม่ใช่ปัจจัยพื้นฐาน) v1 มีแต่ขา momentum-after-sweep
 *   v3 จึงเพิ่มขา mean-reversion ที่ทำงานเฉพาะตอนตลาดออกข้าง
 * • ต้นทุน: Binance VIP 0 คิด 0.1% ต่อขา รวมไป–กลับกับ slippage ราว 0.30%
 *   ทุกเทรดต้องได้เกินนี้ก่อนจึงเริ่มกำไร จึงยังคง cost gate ของ v1 ไว้
 * • การเปิด Short คริปโตทำผ่าน perpetual futures ซึ่งมี funding ทุก 8 ชั่วโมง
 *   ต้นทุนส่วนนี้ไม่ได้อยู่ในอินดิเคเตอร์ แต่อยู่ที่ตัวจำลอง (engine) เพราะเป็น
 *   ต้นทุนของการถือสถานะ ไม่ใช่เงื่อนไขของสัญญาณ
 *
 * ═══ ข้อจำกัดที่ต้องรู้ก่อนใช้ ═══════════════════════════════════════════
 * • เป็นสัญญาณ ณ ปิดแท่งทั้งหมด stop/target เทียบราคาปิด ไม่ใช่คำสั่งระหว่างแท่ง
 * • ฝั่ง Short สมมติว่าเทรดบน perpetual futures ไม่ใช่ Spot
 *   ต้นทุน funding เป็นค่าที่ผู้ใช้ตั้งเอง ไม่ได้ดึงจากข้อมูล funding จริง
 * • ขนาดไม้เป็นสัดส่วนของพอร์ต ไม่ใช่การคำนวณ leverage หรือ margin call
 * • ไม่มีข้อมูล order book จึงประมาณสภาพคล่องด้วย relative volume เท่านั้น
 */
import type { KlineData } from "@/lib/types/kline";
import {
  type V3Result, type V3Setup, type V3ParamMeta,
  detectTimeframeMinutes, metaBars, metaPct, metaTimes,
} from "@/lib/indicators-v3-core";
import {
  sma, ema, atr, dmi, findPivots, rsiV2, highest, lowest,
  closes, highs, lows, opens, volumes,
  type Series,
} from "@/lib/indicators-v2";

// ─── พารามิเตอร์ ───────────────────────────────────────────────
/**
 * ค่าที่เป็น "เวลา" ตั้งเป็นนาที ไม่ใช่จำนวนแท่ง เพราะกลยุทธ์เดียวต้องใช้ได้
 * ทั้ง 1m ถึง 30m ซึ่งต่างกัน 30 เท่า ถ้าตั้งเป็นแท่ง การถือ 48 แท่งจะหมายถึง
 * 48 นาทีบน 1m แต่ 24 ชั่วโมงบน 30m ซึ่งเป็นกลยุทธ์คนละแบบกันโดยสิ้นเชิง
 * ฟังก์ชันจะแปลงเป็นจำนวนแท่งให้เองตาม timeframe ที่ตรวจพบ
 */
export const SHORT_TRADE_V3_DEFAULTS = {
  /** 1 = อนุญาตฝั่งซื้อ, 0 = ปิด */
  allowLong: 1,
  /** 1 = อนุญาตฝั่งขาย (ต้องเทรดบน futures), 0 = ปิด */
  allowShort: 1,

  // โครงสร้างราคา
  /** ความกว้าง pivot ย่อย ใช้หาจุดกวาดสภาพคล่องและโครงสร้างภายใน */
  internalSize: 5,
  /** ความกว้าง pivot ใหญ่ ใช้หาแนวรับ/ต้านสำหรับตั้งเป้าหมาย */
  swingSize: 20,

  // ค่าเฉลี่ยและตัวชี้วัด
  fastPeriod: 21,
  trendPeriod: 55,
  atrPeriod: 14,
  adxPeriod: 14,
  rsiPeriod: 14,
  volumePeriod: 20,

  // เวลา (นาที — แปลงเป็นจำนวนแท่งอัตโนมัติ)
  /** ถือได้นานสุดกี่นาทีก่อนบังคับออก */
  holdMinutes: 240,
  /** จังหวะ sweep/retest มีอายุกี่นาที */
  setupMinutes: 45,
  /** พักกี่นาทีหลังปิดสถานะ */
  cooldownMinutes: 10,
  /**
   * ตัดใจออกกี่นาทีถ้าไม้ยังไม่กำไรพอกลบต้นทุน (0 = ปิด)
   * ไม้ที่ไม่ไปไหนกินทั้งเวลาและความเสี่ยง โดยที่ค่าคาดหวังเหลือไม่ต่างจากศูนย์
   */
  giveUpMinutes: 0,

  // ตัวกรอง
  /** ADX ที่ถือว่าเทรนด์แรงพอจะห้ามเข้าสวน */
  adxThreshold: 25,
  /** RSI สูงสุดก่อนงดเข้าฝั่งซื้อ (ฝั่งขายใช้ 100 − ค่านี้ เป็นขั้นต่ำ) */
  rsiMax: 70,
  /** ปริมาณซื้อขายเทียบค่าเฉลี่ยแท่งก่อนหน้า ขั้นต่ำ */
  minVolumeRatio: 0.7,
  /** ราคาต้องไม่ห่างจาก EMA เร็วเกินกี่เท่าของ ATR */
  maxExtensionAtr: 2.5,
  /** ATR เร็ว/ช้า เกินค่านี้ถือว่าผันผวนผิดปกติ */
  maxVolatilityRatio: 2.2,
  /** True Range เกินกี่เท่าของ ATR แท่งก่อนถือว่าเป็นแท่ง shock */
  shockAtr: 3.5,
  /** พักกี่แท่งหลังเจอ shock */
  shockBars: 3,
  /**
   * ตัวกรองช่วงเวลา (UTC)
   *   0 = ปิด เทรดได้ทุกชั่วโมง
   *   1 = เลี่ยงชั่วโมงเงียบ ข้าม 00:00–05:59 UTC (ช่วงที่ volume ต่ำสุด)
   *   2 = เฉพาะช่วงตลาดยุโรป+สหรัฐ 07:00–20:59 UTC
   */
  sessionMode: 1,

  // ความเสี่ยงและผลตอบแทน
  /** ระยะ stop เริ่มต้นเป็นจำนวนเท่าของ ATR */
  stopAtr: 1.2,
  /**
   * เพดานเป้าหมายเป็นจำนวนเท่าของ ATR
   *
   * ทำไมไม่ใช่ตัวเลขเล็ก ๆ อย่าง 3: บนกราฟ 1–5 นาที ATR ของ BTC อยู่ราว 0.05–0.10%
   * ของราคา ดังนั้น 3 ATR ≈ 0.15–0.30% ซึ่งเล็กกว่าต้นทุนไป–กลับ (costPct 0.31%)
   * ทำให้ reward − cost ติดลบทุกครั้ง วัดจริงบน BTCUSDT 5m 3,000 แท่ง: netRR
   * ผ่านเกณฑ์ 0 จาก 63 ครั้ง คือกลยุทธ์ไม่มีทางเทรดได้เลย
   * นี่คือเหตุผลที่ v1 ตั้งไว้สูงถึง 14 — ไม่ใช่ความสะเพร่า แต่เป็นข้อบังคับทางคณิตศาสตร์
   * ของการเทรดสั้นที่มีต้นทุนคงที่
   *
   * ค่านี้จึงเป็นแค่ "เพดานบน" ตัวจำกัดจริงคือสองตัวด้านล่าง ซึ่งวัดจากข้อมูล ไม่ใช่กำหนดเอง
   * วัดจริงบน BTCUSDT เต็มปี: ต้นทุน 0.31% คิดเป็น 6.4 ATR บน 1m, 3.1 บน 3m,
   * 2.2 บน 5m, 1.15 บน 15m และ 0.77 บน 30m เพดานจึงต้องสูงพอสำหรับ 1m
   *   1) ระยะถึง swing pivot ฝั่งตรงข้าม (โครงสร้างราคาจริง)
   *   2) targetReachRatio × ช่วงราคาที่วิ่งจริงภายในเวลาที่ยอมถือ (ดูด้านล่าง)
   */
  targetAtr: 12,
  /**
   * สัดส่วนของช่วง High–Low ที่ราคา "วิ่งได้จริง" ภายใน holdBars แท่งล่าสุด
   * ใช้เป็นเพดานเป้าหมายที่วัดจากพฤติกรรมราคาจริง แทนตัวเลขคูณ ATR ที่ตั้งเอง
   * แก้จุดอ่อนของ v1 ที่เมื่อไม่มีแนวต้านขวางอยู่ เป้าหมายจะกลายเป็น 14 ATR
   * โดยไม่มีหลักฐานว่าราคาเคยไปถึงระยะนั้นในกรอบเวลาที่ตั้งใจถือ
   */
  targetReachRatio: 0.9,
  /** ระยะ trailing หลังเริ่มป้องกันกำไร */
  trailAtr: 2,
  /**
   * เริ่มป้องกันกำไรเมื่อกำไรสูงสุดเกินกี่เท่าของความเสี่ยงตั้งต้น (R)
   *
   * เวอร์ชันก่อนใช้ `costPct + ATR ของแท่งที่เข้า` ซึ่งบน 1m เท่ากับต้องวิ่งเข้าทาง
   * ราว 7.4 ATR ก่อน stop จะเริ่มขยับ ผลคือกลไกนี้ทำงาน 0–6 ครั้งจากหลายร้อยไม้
   * ตลอดทั้งปี ผูกกับ R แทนจึงทำให้ทริกเกอร์มีความหมายเท่ากันทุก timeframe
   *
   * ค่า 2 เลือกจากช่วง train เท่านั้น (1 / 1.5 / 2 / 3 / ปิด) ความต่างระหว่างค่าอยู่ในระดับ noise
   * จึงเลือกด้วยเหตุผลเชิงโครงสร้าง: ป้องกันกำไรเมื่อไม้ได้กำไรเป็นสองเท่าของสิ่งที่ยอมเสี่ยง
   */
  trailStartR: 2,
  /** ระยะ stop ขั้นต่ำเป็น % ของราคา */
  minRiskPct: 0.08,
  /**
   * ระยะ stop ขั้นต่ำเป็นกี่เท่าของต้นทุนไป–กลับ (0 = ปิด)
   *
   * ถ้า stop แคบกว่าต้นทุนมาก อัตราส่วน reward/risk ที่ด่านต้นทุนบังคับจะสูงจน
   * ราคาแทบไม่มีทางไปถึง (บน 1m: stop 0.08% แต่ต้องได้เป้า 0.60% = 7:1)
   * และ stop จะถูก noise เขี่ยทิ้งก่อน วัดได้จากไม้ที่ตายใน 1–3 แท่งซึ่งขาดทุน
   * เฉลี่ย −0.14% ต่อไม้ (t = −20) ค่านี้บังคับให้ stop กว้างพอเทียบกับต้นทุน
   *
   * ค่ายิ่งสูงยิ่งขาดทุนน้อยลงแบบเอกภาพทั้งช่วง train และ test และทั้ง 5 timeframe
   * (0 / 0.5 / 1 / 1.5 / 2) ซึ่งเป็นรูปแบบที่แกร่ง ไม่ใช่การปรับให้เข้ากับข้อมูลชุดเดียว
   * เลือก 1.5 เพราะ 2 ทำให้ stop บน 1m กว้างถึงราว 13 ATR ซึ่งไม่ใช่การเทรดสั้นแล้ว
   */
  riskCostMult: 1.5,
  /** ต้นทุนไป–กลับที่เผื่อไว้สำหรับกรองสัญญาณ ตั้งแยกจาก fee/slippage ของ engine */
  costPct: 0.31,
  /** กำไรสุทธิหลังต้นทุนขั้นต่ำเป็น % ของราคา */
  minNetProfitPct: 0.08,
  /** (reward − cost) / (risk + cost) ขั้นต่ำ */
  minNetRewardRisk: 0.75,

  // ขา mean-reversion
  /** 1 = เปิดใช้ขาเข้าสวนตอนตลาดออกข้าง */
  reversionEnabled: 1,
  /** ราคาต้องยืดออกจาก EMA เร็วกี่เท่าของ ATR จึงนับว่าเหวี่ยงผิดปกติ */
  reversionStretchAtr: 1.8,

  // ขนาดไม้
  /** ขนาดไม้ต่ำสุดเป็น % ของพอร์ต เมื่อความมั่นใจต่ำสุด */
  minSizePct: 25,
  /** ขนาดไม้สูงสุดเป็น % ของพอร์ต เมื่อความมั่นใจสูงสุด */
  maxSizePct: 100,
};
export type ShortTradeV3Params = typeof SHORT_TRADE_V3_DEFAULTS;

// ─── ตัวช่วยภายใน ───────────────────────────────────────────────
/** แปลงนาทีเป็นจำนวนแท่งของ timeframe ที่ตรวจพบ พร้อมจำกัดขอบเขต */
function barsFromMinutes(minutes: number, tfMinutes: number, min: number, max: number): number {
  if (!(tfMinutes > 0)) return Math.min(max, Math.max(min, Math.round(minutes)));
  return Math.min(max, Math.max(min, Math.round(minutes / tfMinutes)));
}

/** กางระดับ pivot ที่ยืนยันแล้วเป็นรายแท่ง พร้อมบอกว่าแท่งไหนเพิ่งได้ระดับใหม่ */
function levelSeries(length: number, pivots: { confirmedAt: number; price: number }[]) {
  const level: Series = new Array(length).fill(null);
  const fresh: boolean[] = new Array(length).fill(false);
  let cursor = 0, current: number | null = null;
  for (let i = 0; i < length; i++) {
    while (cursor < pivots.length && pivots[cursor].confirmedAt <= i) {
      current = pivots[cursor].price;
      fresh[i] = true;
      cursor++;
    }
    level[i] = current;
  }
  return { level, fresh };
}

/**
 * เหตุการณ์ทะลุโครงสร้างจาก internal pivot ที่ยืนยันแล้ว
 * ระดับที่ถูกทะลุจะถูกล้างทิ้งทันที ต้องรอ pivot ใหม่ จึงไม่เกิดเหตุการณ์ซ้ำทุกแท่ง
 */
function structureEvents(k: KlineData[], size: number) {
  const { pivotHighs, pivotLows } = findPivots(k, size, size);
  const c = closes(k);
  const events = new Map<number, { bias: "bullish" | "bearish"; level: number }>();
  let hiCursor = 0, loCursor = 0;
  let activeHigh: number | null = null, activeLow: number | null = null;
  for (let i = 0; i < k.length; i++) {
    while (hiCursor < pivotHighs.length && pivotHighs[hiCursor].confirmedAt <= i)
      activeHigh = pivotHighs[hiCursor++].price;
    while (loCursor < pivotLows.length && pivotLows[loCursor].confirmedAt <= i)
      activeLow = pivotLows[loCursor++].price;
    if (activeHigh !== null && c[i] > activeHigh) {
      events.set(i, { bias: "bullish", level: activeHigh });
      activeHigh = null;
    } else if (activeLow !== null && c[i] < activeLow) {
      events.set(i, { bias: "bearish", level: activeLow });
      activeLow = null;
    }
  }
  return events;
}

/**
 * ตัวกรองช่วงเวลาตามชั่วโมง UTC
 * อิงข้อเท็จจริงว่า volume และความผันผวนของ BTC กระจุกในชั่วโมงที่ตลาดหุ้น
 * ยุโรป/สหรัฐเปิด และต่ำสุดราว 03:00–04:00 UTC
 */
export function sessionAllowed(utcHour: number, mode: number): boolean {
  if (mode < 0.5) return true;
  if (mode < 1.5) return utcHour >= 6;              // ข้ามช่วงเงียบ 00:00–05:59
  return utcHour >= 7 && utcHour < 21;              // เฉพาะยุโรป + สหรัฐ
}

/** ชั่วโมงที่ถือว่าเป็นช่วงคึกคักที่สุด ใช้เป็นหนึ่งในองค์ประกอบของความมั่นใจ */
function primeSession(utcHour: number): boolean {
  return utcHour >= 12 && utcHour < 21;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ─── กลยุทธ์หลัก ────────────────────────────────────────────────
export function shortTradeV3(
  k: KlineData[],
  overrides: Partial<ShortTradeV3Params> | Record<string, number> = {},
  startIndex = 0,
): V3Result {
  const p = { ...SHORT_TRADE_V3_DEFAULTS, ...overrides } as ShortTradeV3Params;
  for (const [key, v] of Object.entries(p)) {
    if (!Number.isFinite(v) || v < 0) throw new Error(`Invalid ShortTrade V3 parameter: ${key}`);
    if (/Size|Period/.test(key) && (!Number.isInteger(v) || v < 2 || v > 400))
      throw new Error(`Invalid ShortTrade V3 parameter: ${key}`);
  }
  if (p.fastPeriod >= p.trendPeriod || p.internalSize >= p.swingSize)
    throw new Error("ShortTrade V3 requires fast < trend and internal < swing");
  if (p.minSizePct > p.maxSizePct || p.maxSizePct > 100 || p.minSizePct <= 0)
    throw new Error("ShortTrade V3 requires 0 < minSizePct <= maxSizePct <= 100");
  if (p.allowLong < 0.5 && p.allowShort < 0.5)
    throw new Error("ShortTrade V3 requires at least one direction enabled");
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > k.length)
    throw new Error("Invalid ShortTrade V3 startIndex");

  const n = k.length;
  const c = closes(k), h = highs(k), l = lows(k), o = opens(k), vol = volumes(k);

  // timeframe และค่าเวลาที่แปลงเป็นจำนวนแท่งแล้ว
  const tfMinutes = detectTimeframeMinutes(k);
  /**
   * ขอบเขตของค่าเวลาเป็น "นาที" ตามที่ผู้ใช้ตั้ง ส่วนขอบเขตจำนวนแท่ง (4–600) มีไว้
   * กันค่าที่ไร้ความหมายเท่านั้น ไม่ใช่ตัวกำหนดพฤติกรรม
   *
   * เวอร์ชันก่อนบีบไว้ที่ 12–60 แท่งเท่ากันทุก timeframe ซึ่งทำให้ holdMinutes = 240
   * กลายเป็น 60 นาทีบน 1m แต่ 360 นาทีบน 30m คือต่างกัน 6 เท่าทั้งที่ตั้งค่าเดียวกัน
   * และทำให้ holdMinutes ไม่มีผลเลยบนสอง timeframe นั้น ซึ่งขัดกับเหตุผลหลักของ v3
   */
  const holdBars = barsFromMinutes(p.holdMinutes, tfMinutes, 4, 600);
  const setupBars = barsFromMinutes(p.setupMinutes, tfMinutes, 2, 200);
  const cooldownBars = barsFromMinutes(p.cooldownMinutes, tfMinutes, 1, 200);
  const giveUpBars = p.giveUpMinutes > 0
    ? Math.min(holdBars, barsFromMinutes(p.giveUpMinutes, tfMinutes, 2, 600))
    : Infinity;

  const av = atr(k, p.atrPeriod);
  const slowATR = atr(k, Math.max(50, p.atrPeriod));
  const fast = ema(c, p.fastPeriod);
  const trend = ema(c, p.trendPeriod);
  const rsiSeries = rsiV2(k, { rsiLength: p.rsiPeriod }).rsi;
  const dm = dmi(k, p.adxPeriod, p.adxPeriod);
  const volumeMean = sma(vol, p.volumePeriod);
  // ช่วง High–Low ของ holdBars แท่งล่าสุด (รวมแท่งปัจจุบัน) = ระยะที่ราคาเพิ่งวิ่งได้จริง
  // ในกรอบเวลาเท่ากับที่เราตั้งใจถือ ใช้เป็นเพดานเป้าหมายที่มีหลักฐานรองรับ
  const reachHigh = highest(h as Series, holdBars);
  const reachLow = lowest(l as Series, holdBars);

  const internalPivots = findPivots(k, p.internalSize, p.internalSize);
  const swingPivots = findPivots(k, p.swingSize, p.swingSize);
  const internalLow = levelSeries(n, internalPivots.pivotLows);
  const internalHigh = levelSeries(n, internalPivots.pivotHighs);
  const swingLow = levelSeries(n, swingPivots.pivotLows);
  const swingHigh = levelSeries(n, swingPivots.pivotHighs);
  const events = structureEvents(k, p.internalSize);

  const blank = (): Series => new Array(n).fill(null);
  const r: V3Result = {
    exposure: new Array(n).fill(0),
    signal: new Array(n).fill(null),
    reason: new Array(n).fill("warmup"),
    regime: new Array(n).fill("warmup"),
    setup: new Array(n).fill(null),
    direction: new Array(n).fill(0),
    size: blank(), confidence: blank(), stop: blank(), target: blank(),
    initialRisk: blank(), netRewardRisk: blank(),
    atr: av, fastEMA: fast, trendEMA: trend, rsi: rsiSeries,
    adx: dm.adx, plusDI: dm.plusDI, minusDI: dm.minusDI,
    volumeRatio: blank(),
    internalSupport: internalLow.level, internalResistance: internalHigh.level,
    swingSupport: swingLow.level, swingResistance: swingHigh.level,
    utcHour: blank(), sessionOk: new Array(n).fill(null),
    timeframeMinutes: tfMinutes,
    resolvedHoldBars: holdBars,
    resolvedSetupBars: setupBars,
    resolvedCooldownBars: cooldownBars,
  };

  // สถานะของจังหวะตั้งท่า แยกฝั่งซื้อและฝั่งขายออกจากกัน
  let longSweepBar = -Infinity, longSweptLevel = 0, longSweepLow = 0;
  let shortSweepBar = -Infinity, shortSweptLevel = 0, shortSweepHigh = 0;
  let bullBreakBar = -Infinity, bullBreakLevel = 0;
  let bearBreakBar = -Infinity, bearBreakLevel = 0;
  let longStretchBar = -Infinity, longStretchLow = 0;
  let shortStretchBar = -Infinity, shortStretchHigh = 0;
  let lastShock = -Infinity, lastExit = -Infinity;

  // สถานะของสถานะที่ถืออยู่
  let dir = 0, entryIdx = -1, entryPrice = 0;
  let risk = 0, stop = 0, target = 0, peak = 0, size = 0;

  const clearSetups = () => {
    longSweepBar = shortSweepBar = bullBreakBar = bearBreakBar = -Infinity;
    longStretchBar = shortStretchBar = -Infinity;
  };

  for (let i = 0; i < n; i++) {
    const a = av[i], slow = slowATR[i], f = fast[i], t = trend[i];
    const adx = dm.adx[i], pdi = dm.plusDI[i], mdi = dm.minusDI[i];
    const rs = rsiSeries[i];
    const meanVol = i > 0 ? volumeMean[i - 1] : null; // เทียบกับค่าเฉลี่ยของแท่งที่ปิดแล้วเท่านั้น
    const hour = new Date(k[i].openTime).getUTCHours();
    r.utcHour[i] = hour;

    // ระดับใหม่ยืนยันแล้ว → ล้างจังหวะเดิมของฝั่งนั้น
    if (internalLow.fresh[i]) longSweepBar = -Infinity;
    if (internalHigh.fresh[i]) shortSweepBar = -Infinity;

    const event = events.get(i);
    if (event?.bias === "bullish") { bullBreakBar = i; bullBreakLevel = event.level; bearBreakBar = -Infinity; }
    if (event?.bias === "bearish") { bearBreakBar = i; bearBreakLevel = event.level; bullBreakBar = -Infinity; }

    if (a === null || a <= 0 || slow === null || slow <= 0 || f === null || t === null ||
      adx === null || pdi === null || mdi === null || rs === null || meanVol == null) continue;

    r.volumeRatio[i] = meanVol > 0 ? vol[i] / meanVol : 0;
    const trueRange = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    const shock = a / slow > p.maxVolatilityRatio || trueRange > p.shockAtr * (av[i - 1] ?? a);
    if (shock) { lastShock = i; clearSetups(); }

    const trendPrev = trend[i - 5] ?? t;
    const up = c[i] > t && f > t && t > trendPrev && pdi > mdi;
    const down = c[i] < t && f < t && t < trendPrev && mdi > pdi;
    const strongUp = up && adx >= p.adxThreshold;
    const strongDown = down && adx >= p.adxThreshold;
    r.regime[i] = i - lastShock <= p.shockBars ? "shock" : down ? "downtrend" : up ? "uptrend" : "range";
    const sessionOk = sessionAllowed(hour, p.sessionMode);
    r.sessionOk[i] = sessionOk;

    // ── อายุและการล้างจังหวะตั้งท่า ──────────────────────────
    if (longSweepBar > -Infinity && (i - longSweepBar > setupBars || c[i] < longSweptLevel - 0.25 * a))
      longSweepBar = -Infinity;
    if (shortSweepBar > -Infinity && (i - shortSweepBar > setupBars || c[i] > shortSweptLevel + 0.25 * a))
      shortSweepBar = -Infinity;
    if (longStretchBar > -Infinity && i - longStretchBar > setupBars) longStretchBar = -Infinity;
    if (shortStretchBar > -Infinity && i - shortStretchBar > setupBars) shortStretchBar = -Infinity;

    // ── ตรวจจับจังหวะตั้งท่าใหม่ ─────────────────────────────
    const support = internalLow.level[i], resistance = internalHigh.level[i];
    if (!shock && support !== null && l[i] < support && c[i] > support && c[i] > o[i]) {
      longSweepBar = i; longSweptLevel = support; longSweepLow = l[i];
    }
    if (!shock && resistance !== null && h[i] > resistance && c[i] < resistance && c[i] < o[i]) {
      shortSweepBar = i; shortSweptLevel = resistance; shortSweepHigh = h[i];
    }
    // ยืดออกจาก EMA เร็วผิดปกติ ใช้เป็นจุดตั้งท่าของขา mean-reversion
    if (!shock && c[i] < f - p.reversionStretchAtr * a) { longStretchBar = i; longStretchLow = l[i]; }
    if (!shock && c[i] > f + p.reversionStretchAtr * a) { shortStretchBar = i; shortStretchHigh = h[i]; }

    if (i < startIndex) { r.reason[i] = "warmup (no position)"; continue; }

    // ── มีสถานะอยู่: ตรวจทางออกก่อนเสมอ ──────────────────────
    if (dir !== 0) {
      r.direction[i] = dir; r.size[i] = size;
      r.initialRisk[i] = risk; r.target[i] = target;
      // dir * (ราคา − ระดับ) ทำให้เงื่อนไขฝั่งซื้อและฝั่งขายใช้สูตรเดียวกันได้
      let reason = "";
      if (dir * (c[i] - stop) <= 0) reason = "ออก: ราคาปิดชน stop";
      else if (dir * (c[i] - target) >= 0) reason = "ออก: ถึงเป้าหมาย";
      else if (event && ((dir === 1 && event.bias === "bearish" && c[i] < f) ||
        (dir === -1 && event.bias === "bullish" && c[i] > f)))
        reason = "ออก: โครงสร้างพลิกสวนสถานะ";
      else if (i - entryIdx >= holdBars) reason = `ออก: ถือครบ ${i - entryIdx} แท่ง`;
      else if (i - entryIdx >= giveUpBars &&
        dir * (c[i] - entryPrice) < (entryPrice * p.costPct) / 100)
        reason = `ออก: ไม่ไปไหนใน ${i - entryIdx} แท่ง`;
      if (!reason) {
        if (dir * (c[i] - peak) > 0) peak = c[i];
        // เริ่มป้องกันกำไรเมื่อกำไรสูงสุดเกิน trailStartR เท่าของความเสี่ยงตั้งต้น
        if (dir * (peak - entryPrice) >= p.trailStartR * risk) {
          const breakEven = entryPrice * (1 + (dir * p.costPct) / 100);
          const trail = peak - dir * p.trailAtr * a;
          stop = dir === 1 ? Math.max(stop, breakEven, trail) : Math.min(stop, breakEven, trail);
        }
        if (dir * (c[i] - stop) <= 0) reason = "ออก: ป้องกันกำไร (ราคาปิด)";
      }
      r.stop[i] = stop;
      if (reason) {
        r.signal[i] = dir === 1 ? "SELL" : "COVER";
        r.reason[i] = reason;
        r.exposure[i] = 0;
        dir = 0; lastExit = i; clearSetups();
      } else {
        r.exposure[i] = dir * size;
        r.reason[i] = "ถือ: เฝ้าติดตามความเสี่ยง";
      }
      continue;
    }

    // ── ด่านที่ใช้ร่วมกันทั้งสองฝั่ง ──────────────────────────
    if (r.regime[i] === "shock") { r.reason[i] = "งดเข้า: อยู่ในช่วงผันผวนรุนแรง"; continue; }
    if (i - lastExit <= cooldownBars) { r.reason[i] = "งดเข้า: พักหลังปิดสถานะ"; continue; }
    if (!sessionOk) { r.reason[i] = `งดเข้า: นอกช่วงเวลาที่อนุญาต (${hour}:00 UTC)`; continue; }
    if (r.volumeRatio[i]! < p.minVolumeRatio) { r.reason[i] = "งดเข้า: ปริมาณซื้อขายต่ำกว่าเกณฑ์"; continue; }

    r.reason[i] = "รอจังหวะ sweep / retest / reversion";
    const range = h[i] - l[i];
    const rsPrev = rsiSeries[i - 1] ?? rs;

    for (const side of [1, -1] as const) {
      if (side === 1 && p.allowLong < 0.5) continue;
      if (side === -1 && p.allowShort < 0.5) continue;
      // ห้ามเข้าสวนเทรนด์ที่แรงจริง (ยืนยันด้วย ADX) ทั้งสองฝั่ง
      if (side === 1 && strongDown) { r.reason[i] = "งดซื้อ: อยู่ในขาลงแรง"; continue; }
      if (side === -1 && strongUp) { r.reason[i] = "งดขาย: อยู่ในขาขึ้นแรง"; continue; }
      if (side === 1 && rs >= p.rsiMax) { r.reason[i] = "งดซื้อ: RSI สูงเกินเกณฑ์"; continue; }
      if (side === -1 && rs <= 100 - p.rsiMax) { r.reason[i] = "งดขาย: RSI ต่ำเกินเกณฑ์"; continue; }
      if (side * (c[i] - f) > p.maxExtensionAtr * a) {
        r.reason[i] = "งดเข้า: ราคาวิ่งห่าง EMA เร็วเกินไป"; continue;
      }

      // คุณภาพแท่งสำหรับจังหวะตามแรง: ต้องปิดไปทางเดียวกับที่จะเข้าและปิดค่อนไปทางปลายแท่ง
      const bodyOk = side === 1
        ? c[i] > o[i] && c[i] > c[i - 1] && (range <= 0 || c[i] - l[i] >= 0.6 * range)
        : c[i] < o[i] && c[i] < c[i - 1] && (range <= 0 || h[i] - c[i] >= 0.6 * range);

      const sweepBar = side === 1 ? longSweepBar : shortSweepBar;
      const sweptLevel = side === 1 ? longSweptLevel : shortSweptLevel;
      const sweepExtreme = side === 1 ? longSweepLow : shortSweepHigh;
      const sweepOk = bodyOk && sweepBar > -Infinity && i - sweepBar <= setupBars &&
        side * (c[i] - (side === 1 ? h[i - 1] : l[i - 1])) > 0 &&
        side * (c[i] - sweptLevel) > 0 &&
        side * (rs - rsPrev) > 0;

      const breakBar = side === 1 ? bullBreakBar : bearBreakBar;
      const breakLevel = side === 1 ? bullBreakLevel : bearBreakLevel;
      const aligned = side === 1 ? up : down;
      const retestOk = bodyOk && breakBar > -Infinity && i > breakBar && i - breakBar <= setupBars &&
        aligned &&
        side * ((side === 1 ? l[i] : h[i]) - breakLevel) <= 0.25 * a &&
        side * (c[i] - breakLevel) > 0;

      // ขาเข้าสวน: ทำงานเฉพาะตลาดออกข้าง เพราะการกลับตัวสั้นเป็นปรากฏการณ์ของกรอบ
      const stretchBar = side === 1 ? longStretchBar : shortStretchBar;
      const stretchExtreme = side === 1 ? longStretchLow : shortStretchHigh;
      // ไม่บังคับ regime === "range" เพราะขัดกันเองเชิงโครงสร้าง: แท่งที่ราคายืดออกจาก
      // EMA เร็ว 1.8 ATR แทบจะนิยามว่าเป็นเทรนด์อยู่แล้ว วัดจริงบน BTCUSDT 3,000 แท่ง
      // ตอนยืดใต้ EMA regime เป็น "range" เพียง 87/447 ครั้งบน 1m และ 18/192 บน 15m
      // เงื่อนไข "ตลาดไม่มีเทรนด์จริง" จึงใช้ ADX ต่ำกว่าเกณฑ์ ร่วมกับด่านห้ามเข้าสวน
      // เทรนด์แรงที่ตรวจไปแล้วด้านบน ซึ่งวัดสิ่งเดียวกันโดยไม่ตัดสัญญาณทิ้งเกือบหมด
      const reversionOk = p.reversionEnabled >= 0.5 && stretchBar > -Infinity &&
        adx < p.adxThreshold &&
        side * (c[i] - o[i]) > 0 && side * (c[i] - c[i - 1]) > 0 &&
        side * (f - c[i]) > 0;

      let setupType: V3Setup;
      let structureExtreme: number;
      if (sweepOk) { setupType = "sweep"; structureExtreme = sweepExtreme; }
      else if (retestOk) {
        setupType = "retest";
        structureExtreme = side === 1 ? Math.min(l[i], breakLevel) : Math.max(h[i], breakLevel);
      } else if (reversionOk) {
        setupType = "reversion";
        structureExtreme = side === 1 ? Math.min(l[i], stretchExtreme) : Math.max(h[i], stretchExtreme);
      } else continue;

      const candidateRisk = Math.max(
        p.stopAtr * a,
        side * (c[i] - structureExtreme) + 0.15 * a,
        (c[i] * p.minRiskPct) / 100,
        (c[i] * p.costPct * p.riskCostMult) / 100,
      );
      // เป้าหมายถูกจำกัดสามชั้น: เพดาน ATR, ระยะถึงโครงสร้างฝั่งตรงข้าม และ
      // สำหรับขาเข้าสวนคือระยะกลับไปหา EMA เร็ว ซึ่งเป็นสิ่งที่กลยุทธ์นั้นคาดหวังจริง
      const oppLevel = side === 1 ? swingHigh.level[i] : swingLow.level[i];
      const structureRoom = oppLevel !== null && side * (oppLevel - c[i]) > 0
        ? side * (oppLevel - c[i]) - 0.1 * a
        : Infinity;
      // เพดานที่วัดจากข้อมูล: ราคาวิ่งได้เท่าไรจริงภายในเวลาที่ยอมถือ
      const reachSpan = reachHigh[i] !== null && reachLow[i] !== null
        ? (reachHigh[i]! - reachLow[i]!) * p.targetReachRatio
        : Infinity;
      let reward = Math.min(p.targetAtr * a, structureRoom, reachSpan);
      if (setupType === "reversion") reward = Math.min(reward, Math.abs(f - c[i]));

      const cost = (c[i] * p.costPct) / 100;
      const netRR = (reward - cost) / (candidateRisk + cost);
      r.netRewardRisk[i] = netRR;
      if (reward <= 0 || ((reward - cost) / c[i]) * 100 < p.minNetProfitPct || netRR < p.minNetRewardRisk) {
        r.reason[i] = "งดเข้า: ระยะเป้าหมายไม่คุ้มต้นทุนที่เผื่อไว้"; continue;
      }

      // ── ความมั่นใจ → ขนาดไม้ ───────────────────────────────
      // ทุกองค์ประกอบอยู่ในช่วง 0–1 แล้วถ่วงน้ำหนักรวมกัน
      const rrScore = clamp01((netRR - p.minNetRewardRisk) / 1.5);
      const volScore = clamp01((r.volumeRatio[i]! - p.minVolumeRatio) / 1.2);
      const regimeScore = setupType === "reversion"
        ? (r.regime[i] === "range" ? 1 : 0.4)
        : side === 1
          ? (up ? 1 : r.regime[i] === "range" ? 0.5 : 0)
          : (down ? 1 : r.regime[i] === "range" ? 0.5 : 0);
      // จังหวะตามแรงอยากได้ ADX สูง ส่วนจังหวะเข้าสวนอยากได้ ADX ต่ำ จึงกลับด้านกัน
      const adxScore = setupType === "reversion"
        ? clamp01(1 - adx / p.adxThreshold)
        : clamp01(adx / p.adxThreshold);
      const sessionScore = primeSession(hour) ? 1 : 0.6;
      const confidence = clamp01(
        0.30 * rrScore + 0.20 * volScore + 0.25 * regimeScore + 0.15 * adxScore + 0.10 * sessionScore,
      );
      size = (p.minSizePct + (p.maxSizePct - p.minSizePct) * confidence) / 100;

      dir = side;
      entryIdx = i; entryPrice = peak = c[i]; risk = candidateRisk;
      stop = c[i] - side * candidateRisk;
      target = c[i] + side * reward;
      r.signal[i] = side === 1 ? "BUY" : "SHORT";
      r.setup[i] = setupType;
      r.direction[i] = side;
      r.size[i] = size;
      r.confidence[i] = confidence;
      r.stop[i] = stop; r.target[i] = target; r.initialRisk[i] = candidateRisk;
      r.exposure[i] = side * size;
      r.reason[i] = `${side === 1 ? "ซื้อ" : "ขาย"}: ${
        setupType === "sweep" ? "กวาดสภาพคล่องแล้วกลับตัว"
          : setupType === "retest" ? "ทะลุโครงสร้างแล้วย่อกลับ"
            : "เข้าสวนในกรอบ"
      } (RR ${netRR.toFixed(2)}, ไม้ ${(size * 100).toFixed(0)}%)`;
      clearSetups();
      break;
    }
  }
  return r;
}

/**
 * ป้ายของพารามิเตอร์ที่มีแต่ ShortTrade ใช้ เก็บไว้ที่นี่เพราะ `V3_PARAM_META`
 * ในแกนกลางมีเฉพาะพารามิเตอร์ของกลยุทธ์ที่ลงทะเบียนอยู่จริง
 * (ส่วน fastPeriod / trendPeriod / atrPeriod ใช้ร่วมกับ OrderFlow จึงอยู่ในแกนกลาง)
 */
export const SHORT_TRADE_V3_PARAM_META: Record<string, V3ParamMeta> = {
  internalSize: metaBars("ความกว้าง pivot ย่อย (แท่ง)", 2, 100),
  swingSize: metaBars("ความกว้าง pivot ใหญ่ (แท่ง)", 3, 200),
  adxPeriod: metaBars("ช่วง ADX/DI", 2, 200),
  rsiPeriod: metaBars("ช่วง RSI", 2, 200),
  volumePeriod: metaBars("ช่วงค่าเฉลี่ยปริมาณซื้อขาย", 2, 200),
  holdMinutes: metaBars("ถือได้นานสุด (นาที)", 5, 2880),
  setupMinutes: metaBars("อายุจังหวะตั้งท่า (นาที)", 1, 480),
  cooldownMinutes: metaBars("พักหลังปิดสถานะ (นาที)", 0, 480),
  giveUpMinutes: metaBars("ตัดใจออกถ้าไม่ไปไหน (นาที, 0 = ปิด)", 0, 2880),
  adxThreshold: metaPct("ADX ที่ถือว่าเทรนด์แรง", 1, 100, 1),
  rsiMax: metaPct("RSI สูงสุดก่อนงดซื้อ (ฝั่งขายใช้ 100 − ค่านี้)", 50, 99, 1),
  minVolumeRatio: metaTimes("ปริมาณซื้อขาย / ค่าเฉลี่ย ขั้นต่ำ", 0, 10),
  maxExtensionAtr: metaTimes("ระยะห่าง EMA เร็วสูงสุด × ATR", 0.1, 20),
  maxVolatilityRatio: metaTimes("ATR เร็ว/ช้าสูงสุดก่อนงดเข้า", 0.5, 20),
  shockAtr: metaTimes("True Range สูงสุด × ATR ก่อนหน้า", 1, 20),
  shockBars: metaBars("พักหลังแท่ง shock (แท่ง)", 0, 100),
  sessionMode: metaBars("ช่วงเวลา (0=ทุกชั่วโมง 1=เลี่ยงช่วงเงียบ 2=EU+US)", 0, 2),
  stopAtr: metaTimes("ระยะ Stop × ATR", 0.1, 20),
  targetAtr: metaTimes("เพดานเป้าหมาย × ATR", 0.2, 30),
  targetReachRatio: metaTimes("สัดส่วนช่วงราคาที่วิ่งได้จริงในเวลาที่ถือ", 0.05, 2),
  trailAtr: metaTimes("ระยะ Trailing × ATR", 0.1, 20),
  trailStartR: metaTimes("เริ่มป้องกันกำไรที่กี่ R", 0.1, 10),
  riskCostMult: metaTimes("Stop ขั้นต่ำ = กี่เท่าของต้นทุน (0 = ปิด)", 0, 5),
  minRiskPct: metaPct("ระยะ Stop ขั้นต่ำ (%)", 0.01, 10),
  costPct: metaPct("ต้นทุนไป–กลับที่เผื่อไว้ (%)", 0, 5),
  minNetProfitPct: metaPct("กำไรสุทธิขั้นต่ำ (%)", 0, 10),
  minNetRewardRisk: metaTimes("Reward/Risk หลังต้นทุน ขั้นต่ำ", 0, 10),
  reversionEnabled: metaBars("เปิดขาเข้าสวนในกรอบ (0/1)", 0, 1),
  reversionStretchAtr: metaTimes("ระยะยืดจาก EMA เร็ว × ATR", 0.2, 10),
  minSizePct: metaPct("ขนาดไม้ต่ำสุด (% ของพอร์ต)", 1, 100, 1),
  maxSizePct: metaPct("ขนาดไม้สูงสุด (% ของพอร์ต)", 1, 100, 1),
};

/**
 * กฎฉบับเต็มของอินดิเคเตอร์นี้ เก็บไว้เป็นบันทึกของงานวิจัย
 * ไม่ได้ถูกใช้ในไฟล์ Export อีกแล้ว เพราะกลยุทธ์นี้ไม่ได้ลงทะเบียน
 */
export const SHORT_TRADE_V3_RULE_TH =
  "ShortTrade V3 เทรดสั้นสองทางสำหรับ 1m/3m/5m/15m/30m พัฒนาจาก smcAdaptiveShort (v1) ซึ่งเป็น Spot ทางเดียว. " +
  "ตรวจ timeframe จากค่ามัธยฐานของระยะห่าง openTime ระหว่างแท่ง แล้วแปลงค่าที่ตั้งเป็น 'นาที' " +
  "(holdMinutes, setupMinutes, cooldownMinutes) เป็นจำนวนแท่งเอง กลยุทธ์เดียวจึงใช้ได้ทุก timeframe " +
  "โดยเวลาถือจริงเท่ากัน ไม่ใช่จำนวนแท่งเท่ากัน. " +
  "ทุก pivot ใช้แบบยืนยันแล้ว (ใช้ได้ตั้งแต่แท่ง pivotIndex + size) จึงไม่มีการมองอนาคต. " +
  "จังหวะเข้ามี 3 แบบ สะท้อนกระจกครบทั้งฝั่งซื้อและฝั่งขาย: " +
  "(1) sweep — ราคาแทงผ่าน internal pivot แล้วปิดกลับฝั่งเดิมเป็นแท่งสวน จากนั้นภายใน setupBars ต้องปิดเลย high/low แท่งก่อน " +
  "ผ่านระดับที่ถูกกวาด และ RSI เคลื่อนไปทางเดียวกับที่จะเข้า; " +
  "(2) retest — หลัง BOS/CHoCH ยืนยันแล้ว ราคาย่อกลับมาแตะระดับ break ในระยะ 0.25 ATR แล้วปิดกลับฝั่งเดิม ต้องมีเทรนด์หนุน; " +
  "(3) reversion — ทำงานเฉพาะ regime 'range' และ ADX ต่ำกว่าเกณฑ์: ราคายืดออกจาก EMA เร็วเกิน reversionStretchAtr × ATR " +
  "แล้วกลับตัว เป้าหมายคือกลับไปหา EMA เร็ว เป็นขาที่เพิ่มมาตามงานวิจัยที่พบว่า intraday reversal เป็นลักษณะเฉพาะของคริปโต. " +
  "ด่านร่วม: ไม่อยู่ในช่วง shock, ไม่อยู่ใน cooldown, ผ่านตัวกรองช่วงเวลา (sessionMode 1 ข้าม 00:00–05:59 UTC ซึ่งเป็นช่วง volume ต่ำสุด, " +
  "2 = เฉพาะ 07:00–20:59 UTC), relative volume เทียบค่าเฉลี่ยของแท่งก่อนหน้า >= minVolumeRatio. " +
  "ด่านรายทิศ: ห้ามซื้อในขาลงแรงและห้ามขายในขาขึ้นแรง (ยืนยันด้วย ADX >= adxThreshold), RSI ไม่สุดขั้วในทิศที่จะเข้า, " +
  "ราคาไม่ห่าง EMA เร็วเกิน maxExtensionAtr × ATR และแท่งต้องปิดไปทางเดียวกับที่จะเข้า (เฉพาะ sweep/retest). " +
  "Risk = max(stopAtr × ATR, ระยะถึงจุดสุดขั้วของ setup + 0.15 ATR, ราคา × minRiskPct/100). " +
  "Reward ถูกจำกัดหลายชั้น โดยชั้นที่ผูกกับข้อมูลจริงเป็นตัวตัดสิน: " +
  "(ก) เพดาน targetAtr × ATR เป็นขอบบนกว้าง ๆ ไม่ใช่ตัวจำกัดหลัก — ตั้งเล็กเกินไปไม่ได้ เพราะบนกราฟ 1–5 นาที " +
  "ATR ของ BTC อยู่ราว 0.05–0.10% ของราคา ถ้าตั้ง 3 ATR เป้าหมายจะเล็กกว่าต้นทุนไป–กลับ 0.31% ทำให้ reward − cost " +
  "ติดลบทุกครั้ง (วัดจริงบน BTCUSDT 5m 3,000 แท่ง: netRR ผ่านเกณฑ์ 0/63 ครั้ง); " +
  "(ข) ระยะถึง swing pivot ฝั่งตรงข้าม − 0.1 ATR คือโครงสร้างราคาจริงที่ขวางอยู่; " +
  "(ค) targetReachRatio × ช่วง High–Low ของ holdBars แท่งล่าสุด คือระยะที่ราคา 'วิ่งได้จริง' ในกรอบเวลาเท่ากับที่ตั้งใจถือ " +
  "ชั้นนี้แก้จุดอ่อนของ v1 ที่เมื่อไม่มีแนวต้านขวาง เป้าหมายจะกลายเป็น 14 ATR โดยไม่มีหลักฐานว่าราคาเคยไปถึง; " +
  "(ง) สำหรับขา reversion คือระยะกลับไปหา EMA เร็ว. " +
  "วัดจริงบน BTCUSDT 3,000 แท่ง ต้นทุน 0.31% คิดเป็น 6.6 ATR บน 1m, 4.0 บน 3m, 2.7 บน 5m และ 1.2 บน 15m. " +
  "ขา reversion ไม่บังคับ regime = range เพราะขัดกันเองเชิงโครงสร้าง (แท่งที่ราคายืดออกจาก EMA 1.8 ATR " +
  "regime เป็น range เพียง 87/447 ครั้งบน 1m) จึงใช้ ADX ต่ำกว่าเกณฑ์ร่วมกับด่านห้ามเข้าสวนเทรนด์แรงแทน. " +
  "Cost gate: cost = ราคา × costPct/100; ต้องได้ (reward − cost)/ราคา × 100 >= minNetProfitPct และ " +
  "(reward − cost)/(risk + cost) >= minNetRewardRisk มิฉะนั้นงดเข้า โดยไม่ขยับเป้าหมายให้ไกลขึ้นเพื่อให้ผ่าน. " +
  "ขนาดไม้: ความมั่นใจ = 0.30×คะแนน RR + 0.20×คะแนนปริมาณ + 0.25×คะแนน regime + 0.15×คะแนน ADX + 0.10×คะแนนช่วงเวลา " +
  "(ทุกองค์ประกอบอยู่ในช่วง 0–1; ขา reversion กลับด้านคะแนน ADX เพราะต้องการตลาดที่ไม่มีเทรนด์) " +
  "แล้วแปลงเป็นสัดส่วนพอร์ตระหว่าง minSizePct ถึง maxSizePct. ไม่มีการเติมไม้ระหว่างถือ. " +
  "ออกเมื่อ: ราคาปิดชน stop, ถึงเป้าหมาย, โครงสร้างพลิกสวนสถานะพร้อมราคาปิดเลย EMA เร็ว หรือถือครบ holdBars. " +
  "เริ่มป้องกันกำไรเมื่อราคาปิดที่ดีที่สุดห่างจุดเข้าเกิน trailStartR เท่าของความเสี่ยงตั้งต้น จากนั้น stop เลื่อนเข้าหากำไรอย่างเดียว; " +
  "ถ้าตั้ง giveUpMinutes ไว้ จะตัดใจออกเมื่อครบเวลานั้นแล้วไม้ยังไม่กำไรพอกลบต้นทุน. " +
  "Risk มีพื้นสี่ชั้น ชั้นที่สี่คือ costPct x riskCostMult ซึ่งกัน stop ที่แคบกว่าต้นทุนจนถูก noise เขี่ยทิ้ง. " +
  "ทุก stop/target เทียบราคาปิด ไม่ใช่คำสั่งระหว่างแท่ง engine จะ fill ที่ราคาเปิดแท่งถัดไปพร้อม fee/slippage/funding. " +
  "คอลัมน์ exposure คือสัดส่วนพอร์ตเป้าหมาย (+ ซื้อ, − ขาย) ซึ่งเป็นสิ่งที่ตัวจำลองอ่านจริง ส่วน signal มีไว้แสดงผล. " +
  "ข้อจำกัด: ฝั่งขายสมมติว่าเทรดบน perpetual futures ต้นทุน funding เป็นค่าที่ผู้ใช้ตั้งใน engine ไม่ได้ดึงจาก funding จริง; " +
  "ขนาดไม้เป็นสัดส่วนพอร์ต ไม่ใช่การคำนวณ margin/leverage; ไม่มีข้อมูล order book จึงประมาณสภาพคล่องด้วย relative volume เท่านั้น";
