/**
 * indicators-v3-core.ts — แกนกลางของกลยุทธ์เวอร์ชัน 3
 *
 * ไฟล์นี้ไม่มีกลยุทธ์อยู่ในตัวเอง มีแต่สิ่งที่กลยุทธ์ v3 ทุกตัวใช้ร่วมกัน
 *   1) ชนิดผลลัพธ์ `V3Result` ที่ทุกกลยุทธ์ต้องคืน และชนิดย่อยของมัน
 *   2) `V3_REGISTRY` — ทะเบียนกลยุทธ์ v3 ซึ่งเป็นจุดต่อขยายเดียวของทั้งระบบ
 *   3) `V3_PARAM_META` — ป้ายและขอบเขตของพารามิเตอร์ที่กลยุทธ์ที่ลงทะเบียนใช้
 *   4) `detectTimeframeMinutes` — อ่าน timeframe จากข้อมูล เพราะกลยุทธ์ v3
 *      ตั้งค่าที่เป็นเวลาเป็น "นาที" ไม่ใช่ "จำนวนแท่ง"
 *
 * ตัวกลยุทธ์อยู่ในไฟล์ของตระกูลตัวเอง (`indicators-v3-OrderFlow.ts` เป็นต้น)
 * ไฟล์นี้ import ตระกูลเหล่านั้นเข้ามาลงทะเบียน ส่วนตระกูลนั้น import กลับมา
 * เฉพาะ "ชนิด" เท่านั้น จึงไม่เกิดวงจร import ตอน runtime
 */
import type { KlineData } from "@/lib/types/kline";
import type { Series } from "@/lib/indicators-v2";
import { orderFlowV3, ORDER_FLOW_V3_DEFAULTS, ORDER_FLOW_RULE_TH } from "@/lib/indicators-v3-OrderFlow";

/** สัญญาณของ v3 รองรับสองทาง: เปิด/ปิด ทั้งฝั่งซื้อและฝั่งขาย */
export type V3Signal = "BUY" | "SELL" | "SHORT" | "COVER" | null;

/** ชนิดจังหวะเข้าที่ v3 รู้จัก */
export type V3Setup = "sweep" | "retest" | "reversion";

// ─── ตรวจ timeframe จากข้อมูลเอง ────────────────────────────────
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
  const median = gaps[Math.floor(gaps.length / 2)];
  return median / 60000;
}

/**
 * รูปแบบผลลัพธ์ที่กลยุทธ์ v3 ทุกตัวต้องคืน ไม่ว่าจะใช้สัญญาณจากแหล่งใด
 * ช่องที่กลยุทธ์นั้นไม่ใช้ให้เติม null ได้ ตัวจำลองอ่านเฉพาะ `exposure`
 * ส่วนช่องอื่นมีไว้แสดงผล ตรวจย้อนหลัง และเขียนลงไฟล์ Export
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
  regime: ("warmup" | "range" | "uptrend" | "downtrend" | "shock")[];
  /** ชนิดจังหวะที่ใช้เข้า */
  setup: (V3Setup | null)[];
  /** ทิศของสถานะที่ถืออยู่: 1 = ซื้อ, -1 = ขาย, 0 = ว่าง */
  direction: number[];
  /** ขนาดไม้ที่ใช้จริง (สัดส่วนพอร์ต 0–1) */
  size: Series;
  /** คะแนนความมั่นใจ 0–1 ที่ใช้คำนวณขนาดไม้ */
  confidence: Series;
  stop: Series;
  target: Series;
  initialRisk: Series;
  netRewardRisk: Series;
  atr: Series;
  fastEMA: Series;
  trendEMA: Series;
  rsi: Series;
  adx: Series;
  plusDI: Series;
  minusDI: Series;
  volumeRatio: Series;
  /** แนวรับ/ต้านย่อยจาก internal pivot ใช้หาจังหวะกวาดสภาพคล่อง */
  internalSupport: Series;
  internalResistance: Series;
  /** แนวรับ/ต้านใหญ่จาก swing pivot ใช้จำกัดเป้าหมาย */
  swingSupport: Series;
  swingResistance: Series;
  /** ชั่วโมง UTC ของแท่ง และผลของตัวกรองช่วงเวลา */
  utcHour: Series;
  sessionOk: (boolean | null)[];
  /** timeframe ที่ตรวจพบ (นาที) และค่าที่แปลงเป็นจำนวนแท่งแล้ว */
  timeframeMinutes: number;
  resolvedHoldBars: number;
  resolvedSetupBars: number;
  resolvedCooldownBars: number;
}

// ══ ทะเบียนกลยุทธ์ v3 ══════════════════════════════════════════
/**
 * ═══ ทะเบียนกลยุทธ์ v3 — จุดต่อขยายเดียวของทั้งระบบ ═══════════════════════
 *
 * ทุกอย่างที่ระบบต้องรู้เกี่ยวกับกลยุทธ์ v3 หนึ่งตัว อยู่ในรายการเดียวของ `V3_REGISTRY`
 * ส่วนฟังก์ชันที่ผู้เรียกใช้ (`v3Defaults`, `computeV3`, `V3_STRATEGY_INFO`, …)
 * ล้วนอ่านค่าจากตารางนี้ ไม่มีการเขียน `if (id === …)` กระจายอยู่ที่อื่น
 *
 * **วิธีเพิ่มกลยุทธ์ v3 ใหม่**
 *   1) เขียนฟังก์ชันที่คืน `V3Result` ไว้ในไฟล์ของตระกูลตัวเอง
 *   2) เพิ่มรหัสใน `V3StrategyId` (ไฟล์นี้)
 *   3) เพิ่มหนึ่งรายการใน `V3_REGISTRY` ให้ครบทุกช่องของ `V3Definition` (ไฟล์นี้)
 *   4) ถ้ามีพารามิเตอร์ใหม่ เพิ่มป้ายและขอบเขตใน `V3_PARAM_META` (ไฟล์นี้)
 * แล้วกลยุทธ์จะไปปรากฏเองใน `STRATEGIES`, `STRATEGY_FNS`, ปุ่มเลือกกลยุทธ์ในเว็บ,
 * ตารางผล, ไฟล์ Export และตัวตรวจคำขอ โดยไม่ต้องแก้ไฟล์อื่นเลย
 * (`lib/backtest.ts`, `engine.ts`, `data.ts`, `export-calculations.ts` วนจาก `V3_STRATEGY_IDS` ทั้งหมด)
 *
 * เทสต์ `V3 is wired into every registry the web UI depends on` บังคับข้อนี้ไว้:
 * ทุกรหัสต้องมีที่อยู่ในทุกทะเบียน มีป้ายพารามิเตอร์ครบ ค่าตั้งต้นอยู่ในขอบเขตของตัวเอง
 * และมีกฎสำหรับไฟล์ Export
 *
 * ═══ ทำไมตระกูล ShortTrade (SMC) ไม่อยู่ในทะเบียนแล้ว ═══════════════════
 * วัดบน BTCUSDT เต็มปีแล้วขาดทุนทุก timeframe และพิสูจน์ได้ว่าแก้ด้วยการปรับค่าไม่ได้:
 * ผลตอบแทนล่วงหน้า 5–80 แท่งในทิศที่สัญญาณบอกมีค่า t ระหว่าง −2.15 ถึง +2.10
 * และสลับเครื่องหมายระหว่างช่วง train กับ test ทุกครั้ง ส่วนการค้นหา 5,076 ชุดค่า
 * ให้สหสัมพันธ์ผลตอบแทน train↔test ก่อนหักต้นทุนเท่ากับ −0.570 คือค่าที่ดีบน train
 * เป็นค่าที่แย่บน test อย่างเป็นระบบ รายละเอียดอยู่ใน `indicators-v3-shorttrade-th.md` หัวข้อ 7
 *
 * ฟังก์ชัน `shortTradeV3()` ยังอยู่ใน `indicators-v3-ShortTrade.ts` เพื่อใช้เทียบ
 * เป็นเส้นฐานในสคริปต์วิจัย แต่ **ไม่ได้ลงทะเบียนเป็นกลยุทธ์อีกแล้ว**
 */
export type V3StrategyId =
  | "orderflow_v3"
  | "orderflow_v3_long"
  | "orderflow_v3_short";

/** ทุกสิ่งที่ระบบต้องรู้เกี่ยวกับกลยุทธ์ v3 หนึ่งตัว */
export interface V3Definition {
  /** ตระกูลสัญญาณ ใช้จัดกลุ่มและแยกกลยุทธ์ที่ใช้คนละแหล่งข้อมูล */
  family: "orderflow" | "smc";
  name: string;
  th: string;
  en: string;
  /** ป้ายกลุ่มที่แสดงข้างชื่อในเว็บ */
  group: string;
  /** เส้นที่วาดทับกราฟเป็นค่าเริ่มต้น */
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

export const V3_REGISTRY: Record<V3StrategyId, V3Definition> = {
  orderflow_v3: {
    family: "orderflow",
    name: "OrderFlow V3 (สองทาง)",
    th: "เทรดสองทางด้วยแรงซื้อขายสุทธิจาก takerBuyBaseVolume สะสม 5 วันแล้วลบค่าเฉลี่ยของตัวเอง 120 วัน เป็นกลยุทธ์เดียวในโปรเจกต์ที่ผ่านการตรวจข้ามเหรียญและข้ามช่วงเวลาแล้วยังเป็นบวก ต้องกระจายหลายเหรียญ ถือเฉลี่ยหลายวัน",
    en: "Two-way order-flow imbalance strategy from takerBuyBaseVolume, accumulated over 5 days and de-biased by its own 120-day mean; multi-day holds, requires diversification across coins",
    group: FLOW_GROUP,
    overlay: "v3.fastEMA",
    direction: { allowLong: 1, allowShort: 1 },
    defaults: orderFlowDefaults(),
    compute: orderFlowV3,
    warmupBars: orderFlowWarmup,
    validate: orderFlowValidate,
    rule: `${ORDER_FLOW_RULE_TH}. ${SCOPE.both}`,
  },
  orderflow_v3_long: {
    family: "orderflow",
    name: "OrderFlow V3 (ซื้ออย่างเดียว)",
    th: "กฎเดียวกับ OrderFlow V3 แต่เปิดเฉพาะฝั่งซื้อ ใช้กับบัญชี Spot ได้และไม่มีต้นทุน funding ใช้เทียบว่าฝั่งขายเพิ่มผลตอบแทนจริงหรือไม่",
    en: "Same rules as OrderFlow V3 but long entries only; Spot-compatible and free of funding cost",
    group: FLOW_GROUP,
    overlay: "v3.fastEMA",
    direction: { allowLong: 1, allowShort: 0 },
    defaults: orderFlowDefaults(),
    compute: orderFlowV3,
    warmupBars: orderFlowWarmup,
    validate: orderFlowValidate,
    rule: `${ORDER_FLOW_RULE_TH}. ${SCOPE.long}`,
  },
  orderflow_v3_short: {
    family: "orderflow",
    name: "OrderFlow V3 (ขายอย่างเดียว)",
    th: "กฎเดียวกับ OrderFlow V3 แต่เปิดเฉพาะฝั่งขาย ต้องเทรดบน perpetual futures และมีต้นทุน funding ใช้ตรวจว่าผลบวกมาจากการทำนายหรือจากอคติฝั่งขาย",
    en: "Same rules as OrderFlow V3 but short entries only; requires perpetual futures and carries funding cost",
    group: FLOW_GROUP,
    overlay: "v3.fastEMA",
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
 */
export interface V3ParamMeta {
  label: string;
  min: number;
  max: number;
  step: number;
  integer: boolean;
}
export const metaBars = (label: string, min: number, max: number): V3ParamMeta => ({ label, min, max, step: 1, integer: true });
export const metaPct = (label: string, min: number, max: number, step = 0.01): V3ParamMeta => ({ label, min, max, step, integer: false });
export const metaTimes = (label: string, min: number, max: number): V3ParamMeta => ({ label, min, max, step: 0.1, integer: false });

/**
 * มีเฉพาะพารามิเตอร์ของกลยุทธ์ที่ลงทะเบียนอยู่จริง ตระกูลที่ถอดออกจากทะเบียนแล้ว
 * เก็บป้ายของตัวเองไว้ในไฟล์ของตัวเอง (เช่น `SHORT_TRADE_V3_PARAM_META`)
 */
export const V3_PARAM_META: Record<string, V3ParamMeta> = {
  fastPeriod: metaBars("EMA เร็ว", 2, 200),
  trendPeriod: metaBars("EMA เทรนด์", 3, 400),
  atrPeriod: metaBars("ช่วง ATR", 2, 200),
  flowLookbackDays: metaTimes("สะสมแรงซื้อขายสุทธิย้อนหลัง (วัน)", 0.5, 60),
  flowDebiasDays: metaTimes("ลบค่าเฉลี่ยของตัวเองย้อนหลัง (วัน)", 5, 365),
  flowBand: metaPct("เกณฑ์แรงซื้อขายสุทธิที่ถือว่าแรงพอ", 0.001, 0.3, 0.001),
  flowSizePct: metaPct("ขนาดไม้ (% ของพอร์ต)", 1, 100, 1),
};
