import type { KlineData } from "@/lib/types/kline";
import { computeAll, SMC_ADAPTIVE_DEFAULTS, SMC_ADAPTIVE_V2_DEFAULTS, SMC_ADAPTIVE_SHORT_DEFAULTS, type AllIndicators } from "@/lib/indicators";
import {
  V2_STRATEGY_IDS,
  V2_PARAM_META,
  isV2StrategyId,
  resolveV2Strategy,
  v2Defaults,
  v2SignalOf,
  type V2Base,
  type V2ParamMeta,
  type V2StrategyId,
} from "@/lib/indicators-v2";
import {
  V3_STRATEGY_IDS,
  V3_PARAM_META,
  V3_STRATEGY_INFO,
  isV3StrategyId,
  v3Defaults,
  type V3StrategyId,
} from "@/lib/indicators-v3";
import { isV4StrategyId } from "@/lib/indicators-v4-inYutube";
import { isV5StrategyId } from "@/lib/indicators-v5-tradingView";

// ─── Types ─────────────────────────────────────────────────────
/**
 * BUY / SELL / HOLD คือชุดเดิมของกลยุทธ์ v1 และ v2 ซึ่งเป็น Spot ทางเดียว
 *   BUY = เปิดสถานะซื้อ, SELL = ปิดสถานะซื้อ
 *
 * SHORT / COVER เพิ่มมาสำหรับกลยุทธ์ v3 ที่เทรดสองทาง
 *   SHORT = เปิดสถานะขาย (ขายก่อนซื้อคืน), COVER = ปิดสถานะขาย
 *
 * ตัวจำลองแบบเดิม (simulateNextOpen, runBacktest) มองเห็นแค่ BUY/SELL
 * จึงข้าม SHORT/COVER ไปเงียบ ๆ พฤติกรรมของ v1/v2 เลยไม่เปลี่ยน
 * ส่วน v3 ใช้ simulateExposure ที่เข้าใจครบทั้งสี่ค่าและรองรับขนาดไม้
 */
export type SignalAction = "BUY" | "SELL" | "HOLD" | "SHORT" | "COVER";

export interface Trade {
  entryIdx: number;
  entryTime: number;
  entryPrice: number;
  exitIdx: number;
  exitTime: number;
  exitPrice: number;
  pnl: number;       // absolute
  pnlPct: number;    // percentage
  bars: number;       // holding period
  reason: string;     // why entered / exited
}

export interface BacktestResult {
  trades: Trade[];
  totalPnlPct: number;
  winRate: number;
  wins: number;
  losses: number;
  totalTrades: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
  avgBarsHeld: number;
  bestTradePct: number;
  worstTradePct: number;
  equityCurve: number[];   // cumulative % at each bar
  signals: SignalAction[];  // signal at each bar
  buyAndHoldPct: number;
}

/** กลยุทธ์ชุดเดิม อิง lib/indicators.ts */
export type V1StrategyId =
  | "rsi"
  | "cdc_actionzone"
  | "smc"
  | "smc_adaptive"
  | "smc_adaptive_v2"
  | "smc_adaptive_short"
  | "supertrend"
  | "msb_ob"
  | "support_resistance"
  | "trendlines";

/** กลยุทธ์ทั้งหมดที่ระบบรู้จัก: ชุดเดิม + v2 (20 อินดิเคเตอร์) + v3 (OrderFlow สองทาง) */
export type StrategyId = V1StrategyId | V2StrategyId | V3StrategyId;

export interface StrategyConfig {
  id: StrategyId;
  name: string;
  descriptionEn: string;
  descriptionTh: string;
  params: Record<string, number>;
  /** 1 = ชุดเดิม, 2 = 20 อินดิเคเตอร์ตามเอกสาร TradingView, 3 = OrderFlow สองทาง, 4 = Horizon Flow จาก YouTube, 5 = SMC LuxAlgo จาก TradingView */
  version?: 1 | 2 | 3 | 4 | 5;
  /** true = กลยุทธ์เทรดสองทาง ต้องใช้ตัวจำลองที่รองรับสถานะขายและขนาดไม้ */
  twoWay?: boolean;
  /** กลุ่มการใช้งาน เช่น แนวโน้ม / โมเมนตัม / ความผันผวน */
  group?: string;
  /** ป้ายและขอบเขตของแต่ละพารามิเตอร์ (มีเฉพาะกลยุทธ์ v2) */
  paramMeta?: Record<string, V2ParamMeta>;
  /** คอลัมน์ที่ Web UI เลือกวาดทับกราฟราคาโดยปริยาย */
  defaultOverlay?: string;
}

const V1_STRATEGIES: StrategyConfig[] = [
  {
    id: "rsi",
    name: "RSI Overbought/Oversold",
    descriptionEn: "Buy when RSI < 30, Sell when RSI > 70",
    descriptionTh: "ซื้อ เมื่อ RSI < 30, ขาย เมื่อ RSI > 70",
    params: { period: 14, buyThreshold: 30, sellThreshold: 70 },
  },
  {
    id: "cdc_actionzone",
    name: "CDC ActionZone V3",
    descriptionEn: "EMA crossover zones — Buy on first Green bar, Sell on first Red bar",
    descriptionTh: "โซน EMA ตัดกัน — ซื้อ เมื่อแท่งเขียวแรก, ขาย เมื่อแท่งแดงแรก",
    params: { fastPeriod: 12, slowPeriod: 26 },
  },
  {
    id: "smc",
    name: "Smart Money Concepts (SMC)",
    descriptionEn: "Buy on Bullish CHoCH/BOS (discount zone), Sell on Bearish CHoCH/BOS (premium zone)",
    descriptionTh: "ซื้อ เมื่อ CHoCH/BOS ขาขึ้น (โซนส่วนลด), ขาย เมื่อ CHoCH/BOS ขาลง (โซนพรีเมียม)",
    params: { swingSize: 50, internalSize: 5 },
  },
  {
    id: "smc_adaptive",
    name: "SMC Adaptive",
    descriptionEn: "Confirmed SMC liquidity reclaim / structure breakout, volatility filter and close-based ATR exits",
    descriptionTh: "SMC ยืนยันโครงสร้าง + กวาดสภาพคล่อง/ทะลุ BOS พร้อมกรองความผันผวนและออกตาม ATR ณ ปิดแท่ง",
    params: { ...SMC_ADAPTIVE_DEFAULTS },
  },
  {
    id: "smc_adaptive_v2",
    name: "SMC Adaptive V2",
    descriptionEn: "Confirmed SMC + Trendlines breakouts and EMA pullback re-entry; ADX/DI filters, ATR/percentage close stops",
    descriptionTh: "SMC + Trendlines เข้าเมื่อทะลุหรือย่อกลับเหนือ EMA เพิ่มจังหวะเข้า กรอง ADX/DI พร้อม Stop ตาม ATR และระยะขั้นต่ำ %",
    params: { ...SMC_ADAPTIVE_V2_DEFAULTS },
  },
  {
    id: "smc_adaptive_short",
    name: "SMC Adaptive Short trade",
    descriptionEn: "Short-duration SPOT longs: confirmed SMC sweep/retest, cost-adjusted target gate, volatility cooldown and time exits",
    descriptionTh: "Spot ซื้อแล้วขายระยะสั้น: SMC sweep/retest กรองระยะเป้าหมายหลังต้นทุน พักเมื่อผันผวนสูง และจำกัดเวลาถือ (ไม่ใช่เปิด Short)",
    params: { ...SMC_ADAPTIVE_SHORT_DEFAULTS },
  },
  {
    id: "supertrend",
    name: "Supertrend",
    descriptionEn: "ATR-based trend follower — Buy when trend turns bullish, Sell when turns bearish",
    descriptionTh: "ตามเทรนด์ด้วย ATR — ซื้อ เมื่อเทรนด์เปลี่ยนเป็นขาขึ้น, ขาย เมื่อเปลี่ยนเป็นขาลง",
    params: { atrPeriod: 10, multiplier: 3.0 },
  },
  {
    id: "msb_ob",
    name: "Market Structure Break & OB",
    descriptionEn: "ZigZag MSB — Buy on Bullish MSB with Order Block, Sell on Bearish MSB with Order Block",
    descriptionTh: "ZigZag MSB — ซื้อ เมื่อ Bullish MSB พร้อม Order Block, ขาย เมื่อ Bearish MSB พร้อม Order Block",
    params: { zigzagLen: 9, fibFactor: 0.33 },
  },
  {
    id: "support_resistance",
    name: "Support & Resistance Breaks",
    descriptionEn: "Pivot S/R + Volume — Buy when breaking Resistance, Sell when breaking Support with Volume",
    descriptionTh: "Pivot S/R + Volume — ซื้อ เมื่อทะลุแนวต้าน, ขาย เมื่อหลุดแนวรับ พร้อม Volume ยืนยัน",
    params: { leftBars: 15, rightBars: 15, volumeThresh: 20 },
  },
  {
    id: "trendlines",
    name: "Trendlines with Breaks [LuxAlgo]",
    descriptionEn: "Dynamic trendlines — Buy when breaking resistance line, Sell when breaking support line",
    descriptionTh: "เส้นเทรนด์ไดนามิก — ซื้อ เมื่อทะลุเส้นแนวต้าน, ขาย เมื่อหลุดเส้นแนวรับ",
    params: { trendLength: 14, trendMult: 1.0 },
  },
];

// ─── กลยุทธ์เวอร์ชัน 2 ─────────────────────────────────────────
/**
 * สร้างจากทะเบียนใน lib/indicators-v2.ts โดยตรง อินดิเคเตอร์หนึ่งตัวให้สองกลยุทธ์
 *   <id>            = กฎพื้นฐานของอินดิเคเตอร์นั้นล้วน ๆ
 *   <id>_filtered   = กฎเดิม + ตัวกรองเทรนด์/ADX/ความผันผวน + ATR stop/trailing/เวลาถือ
 * เทียบสองตัวนี้บนข้อมูลชุดเดียวกันจะเห็นว่าตัวกรองช่วยหรือทำลายสัญญาณดิบ
 */
const V2_STRATEGIES: StrategyConfig[] = V2_STRATEGY_IDS.map((id) => {
  const { def, filtered } = resolveV2Strategy(id);
  const params = v2Defaults(id);
  const paramMeta: Record<string, V2ParamMeta> = {};
  for (const key of Object.keys(params)) {
    const meta = V2_PARAM_META[key];
    if (meta) paramMeta[key] = meta;
  }
  return {
    id,
    name: filtered ? `${def.name} + ตัวกรอง` : def.name,
    descriptionEn: filtered
      ? `${def.descriptionEn}. Gated by trend/ADX/volatility filters with ATR stop, trailing and max hold.`
      : def.descriptionEn,
    descriptionTh: filtered
      ? `${def.descriptionTh} · เพิ่มตัวกรอง EMA เทรนด์ + ADX/DI + ความผันผวน และบริหารการออกด้วย ATR stop/trailing/เวลาถือ`
      : def.descriptionTh,
    params,
    version: 2 as const,
    group: def.group,
    paramMeta,
    defaultOverlay: filtered ? `${def.key}.filterStop` : def.overlay,
  };
});

// ─── กลยุทธ์เวอร์ชัน 3: OrderFlow สองทาง (swing) ───────────────
/**
 * ต่างจาก v1/v2 ตรงที่เป็นกลยุทธ์สองทาง (เปิดสถานะขายได้) และกำหนดขนาดไม้เอง
 * จึงต้องใช้ตัวจำลอง simulateExposure ไม่ใช่ simulateNextOpen แบบ Spot ทางเดียว
 * ทิศทางถูกล็อกด้วยรหัสกลยุทธ์ ผู้ใช้จึงเทียบ สองทาง / ซื้ออย่างเดียว / ขายอย่างเดียว ได้ในรอบเดียว
 */
const V3_STRATEGIES: StrategyConfig[] = V3_STRATEGY_IDS.map((id) => {
  const params = v3Defaults(id);
  const paramMeta: Record<string, V2ParamMeta> = {};
  for (const key of Object.keys(params)) {
    const meta = V3_PARAM_META[key];
    if (meta) paramMeta[key] = meta;
  }
  const info = V3_STRATEGY_INFO[id];
  return {
    id,
    name: info.name,
    descriptionEn: info.en,
    descriptionTh: info.th,
    params,
    // v4/v5 ใช้ทะเบียนและตัวจำลองเดียวกับ v3 แยกเลขเวอร์ชันไว้ให้ UI จัดกลุ่มเท่านั้น
    version: isV5StrategyId(id) ? (5 as const) : isV4StrategyId(id) ? (4 as const) : (3 as const),
    group: info.group,
    paramMeta,
    defaultOverlay: info.overlay,
    twoWay: true,
  };
});

export const STRATEGIES: StrategyConfig[] = [
  ...V1_STRATEGIES.map((s) => ({ ...s, version: 1 as const })),
  ...V2_STRATEGIES,
  ...V3_STRATEGIES,
];

// ─── Signal Generators ─────────────────────────────────────────
type SignalFn = (klines: KlineData[], ind: AllIndicators, params: Record<string, number>) => SignalAction[];

function rsiStrategy(_klines: KlineData[], ind: AllIndicators, params: Record<string, number>): SignalAction[] {
  const buyTh = params.buyThreshold ?? 30;
  const sellTh = params.sellThreshold ?? 70;
  return ind.rsi.map((v) => {
    if (v === null) return "HOLD";
    if (v < buyTh) return "BUY";
    if (v > sellTh) return "SELL";
    return "HOLD";
  });
}

function cdcActionZoneStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  const cdc = ind.cdcActionZone;
  return cdc.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function smcStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.smc.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function supertrendStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.supertrend.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function msbObStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.msbOb.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function supportResistanceStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.supportResistance.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function trendlinesStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.trendlines.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

/**
 * ตัวสร้างสัญญาณของกลยุทธ์ v2 ทุกตัวใช้รูปแบบเดียวกัน
 * อ่านผลลัพธ์ของอินดิเคเตอร์ต้นทางจาก AllIndicators แล้วเลือกคอลัมน์สัญญาณตามโหมด
 */
const V2_STRATEGY_FNS = Object.fromEntries(
  V2_STRATEGY_IDS.map((id) => {
    const { def } = resolveV2Strategy(id);
    const fn: SignalFn = (_k, ind) => {
      const result = (ind as unknown as Record<string, unknown>)[def.key] as V2Base | undefined;
      if (!result)
        throw new Error(`ยังไม่ได้คำนวณอินดิเคเตอร์ ${def.key} สำหรับกลยุทธ์ ${id}`);
      return v2SignalOf(id, result).map((s) => s ?? "HOLD");
    };
    return [id, fn];
  }),
) as Record<V2StrategyId, SignalFn>;

/**
 * กลยุทธ์ v3 คืน BUY/SELL/SHORT/COVER ตรงจากอินดิเคเตอร์
 * ตัวจำลองแบบ Spot ทางเดียวจะเห็นเฉพาะ BUY/SELL ส่วน simulateExposure ใช้คอลัมน์ exposure
 */
const V3_STRATEGY_FNS = Object.fromEntries(
  V3_STRATEGY_IDS.map((id) => {
    const fn: SignalFn = (_k, ind) => {
      const result = ind.v3;
      if (!result) throw new Error(`ยังไม่ได้คำนวณผลของกลยุทธ์ v3 ${id}`);
      return result.signal.map((s) => s ?? "HOLD");
    };
    return [id, fn];
  }),
) as Record<V3StrategyId, SignalFn>;

/**
 * บังคับให้สตรีมสัญญาณสลับ "เปิด" กับ "ปิด" เสมอ — สัญญาณซื้อสองครั้งติดกันเป็นไปไม่ได้
 *
 * ═══ ทำไมต้องมี ══════════════════════════════════════════════════════════
 * ตัวสร้างสัญญาณส่วนใหญ่ตอบคำถามว่า "ตอนนี้เงื่อนไขเป็นจริงไหม" ไม่ใช่ "ควรลงมือไหม"
 * RSI ต่ำกว่า 30 ติดกัน 78 แท่งจึงกลายเป็น BUY 78 ครั้งติดกัน วัดบน BTCUSDT 30m เต็มปี
 * พบว่า 17 จาก 57 กลยุทธ์มีสัญญาณซ้ำฝั่งแบบนี้ รวม 11,898 ครั้งจาก 36,976 สัญญาณ (32%)
 * หนักสุดคือ `rsi` (ซ้ำ 1,533 ครั้ง ชุดยาวสุด 78) และ `volume_v2` (2,091 ครั้ง ชุดยาวสุด 62)
 *
 * ตัวจำลองไม่เคยเห็นปัญหานี้เพราะมันเมินคำสั่งซื้อตอนที่ถือของอยู่แล้ว **ผลตอบแทนจึงไม่เปลี่ยน**
 * (วัดแล้ว: เท่ากันทุกหลักใน 15 จาก 17 กลยุทธ์ ส่วนอีก 2 ตัวต่างเพราะการตัดสัญญาณขาย
 * ที่มาก่อนการซื้อครั้งแรกทิ้ง) แต่สิ่งที่ **เห็นปัญหา** คือคนกับบอท: คอลัมน์สัญญาณในเว็บ
 * ไฟล์ Export และการแจ้งเตือนของบอทสัญญาณ ซึ่งเคยแจ้ง "ซื้อ" ซ้ำ ๆ ทั้งที่ถือของอยู่แล้ว
 *
 * ═══ กฎที่ใช้ ════════════════════════════════════════════════════════════
 * เป็นเครื่องสถานะเครื่องเดียวที่ครอบทั้งกลยุทธ์ทางเดียวและสองทาง
 *   ว่าง  → BUY เปิดสถานะซื้อ · SHORT เปิดสถานะขาย (เฉพาะกลยุทธ์สองทาง)
 *   ซื้อ  → SELL ปิด · SHORT พลิกข้าง (เฉพาะสองทาง)
 *   ขาย  → COVER ปิด · BUY พลิกข้าง
 * สัญญาณที่ทำไม่ได้จากสถานะปัจจุบันจะถูกตัดเป็น HOLD
 *
 * สำหรับกลยุทธ์ Spot ทางเดียว กฎนี้ให้ผลเป็น BUY → SELL → BUY → SELL เป๊ะ ๆ ตามที่ต้องการ
 * และตัดสัญญาณขายที่มาก่อนการซื้อครั้งแรกทิ้งไปด้วย เพราะไม่มีของให้ขาย
 *
 * ตระกูล v3 ไม่ถูกกระทบ: ที่ดูเหมือน "ซ้ำฝั่ง" ของมันคือคู่ SELL→SHORT และ COVER→BUY
 * ซึ่งเป็นการปิดแล้วเปิดใหม่ ไม่ใช่การเปิดซ้ำ วัดแล้วได้ 33/33 และ 32/32 เป็นคู่ปิด→เปิดทั้งหมด
 * ถ้าบังคับให้สลับ BUY/SELL แบบเคร่งครัดกับมัน คอลัมน์สัญญาณจะขัดกับคอลัมน์ exposure
 * ที่ตัวจำลองใช้จริง แล้วหน้าเว็บจะแสดงข้อมูลที่ไม่ตรงกับสิ่งที่จำลอง
 *
 * ═══ สิ่งที่พิจารณาแล้วไม่เอา ════════════════════════════════════════════
 * "เก็บสัญญาณตัวสุดท้ายของชุดแทนตัวแรก" ฟังดูดีกว่าแต่ **ทำไม่ได้** เพราะจะรู้ว่าแท่งไหน
 * เป็นตัวสุดท้ายก็ต่อเมื่อชุดจบไปแล้ว การเขียนสัญญาณย้อนกลับไปที่แท่งนั้นคือการมองอนาคต
 * ส่วนรุ่นที่เป็นเหตุเป็นผลตามเวลาคือ "รอจนเงื่อนไขหยุดเป็นจริงแล้วค่อยเข้า" ซึ่งวัดแล้ว
 * แย่ลงบนช่วง train (มัธยฐาน −32.04% เทียบกับ −31.02%) จึงตกไปตามเกณฑ์ที่ใช้เลือกค่าทุกครั้ง
 * รายละเอียดอยู่ใน `signal-bot/web ui/research/signal-alternation-policy.ts`
 */
export function alternateSignals(signals: SignalAction[], twoWay = false): SignalAction[] {
  const out: SignalAction[] = new Array(signals.length).fill("HOLD");
  let state: "flat" | "long" | "short" = "flat";
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    if (s === "HOLD") continue;
    const next: "flat" | "long" | "short" | null =
      state === "flat" ? (s === "BUY" ? "long" : s === "SHORT" && twoWay ? "short" : null)
        : state === "long" ? (s === "SELL" ? "flat" : s === "SHORT" && twoWay ? "short" : null)
          : s === "COVER" ? "flat" : s === "BUY" ? "long" : null;
    if (next === null) continue;
    out[i] = s;
    state = next;
  }
  return out;
}

/**
 * ตัวสร้างสัญญาณดิบ ก่อนผ่านกฎสลับเปิด–ปิด
 * ไม่ส่งออกนอกไฟล์ เพราะทุกผู้เรียกต้องได้สตรีมที่ผ่านกฎแล้วเสมอ
 */
const RAW_STRATEGY_FNS: Record<StrategyId, SignalFn> = {
  ...V2_STRATEGY_FNS,
  ...V3_STRATEGY_FNS,
  rsi: rsiStrategy,
  cdc_actionzone: cdcActionZoneStrategy,
  smc: smcStrategy,
  smc_adaptive: (_k, ind) => ind.smcAdaptive.signal.map(s => s ?? "HOLD"),
  smc_adaptive_v2: (_k, ind) => ind.smcAdaptiveV2.signal.map(s => s ?? "HOLD"),
  smc_adaptive_short: (_k, ind) => ind.smcAdaptiveShort.signal.map(s => s ?? "HOLD"),
  supertrend: supertrendStrategy,
  msb_ob: msbObStrategy,
  support_resistance: supportResistanceStrategy,
  trendlines: trendlinesStrategy,
};

/**
 * สัญญาณของทุกกลยุทธ์ทุกเวอร์ชัน ผ่านกฎสลับเปิด–ปิดแล้ว
 *
 * ห่อไว้ที่นี่ที่เดียวแทนที่จะไปห่อใน `computeSignals` เพราะ `engine.ts` เรียกตารางนี้ตรง ๆ
 * การห่อที่ตัวตารางจึงเป็นจุดเดียวที่เลี่ยงไม่ได้ ไม่ว่าใครจะเรียกทางไหน
 */
export const STRATEGY_FNS: Record<StrategyId, SignalFn> = Object.fromEntries(
  (Object.keys(RAW_STRATEGY_FNS) as StrategyId[]).map((id) => {
    const raw = RAW_STRATEGY_FNS[id];
    const twoWay = isV3StrategyId(id);
    const fn: SignalFn = (k, ind, params) => alternateSignals(raw(k, ind, params), twoWay);
    return [id, fn];
  }),
) as Record<StrategyId, SignalFn>;

// ─── Signal computation (ใช้ร่วมกันโดย backtest และบอทสัญญาณ signal-bot/) ───
export interface SignalOptions {
  lazyIndicators?: boolean;
  /** false = โหมด TS เดิมมี lookahead ใช้เฉพาะ harness; default true */
  confirmedPivots?: boolean;
  /** Stateful strategies start flat here; prior bars only warm up features. */
  startIndex?: number;
}

/**
 * คำนวณ indicator ทั้งชุด โดยใช้พารามิเตอร์ของกลยุทธ์ที่เลือก
 * Web UI และ computeSignals ใช้การแปลงพารามิเตอร์ชุดเดียวกัน
 */
export function computeStrategyIndicators(
  klines: KlineData[],
  strategyId: StrategyId,
  params: Record<string, number> = {},
  opts: SignalOptions = {},
): AllIndicators {
  const v2 = isV2StrategyId(strategyId);
  const v3 = isV3StrategyId(strategyId);
  return computeAll(klines, {
    lazy: opts.lazyIndicators,
    confirmedPivots: opts.confirmedPivots,
    v2Strategy: v2 ? strategyId : undefined,
    v2Params: v2 ? params : undefined,
    v3Strategy: v3 ? strategyId : undefined,
    v3Params: v3 ? params : undefined,
    smcAdaptiveParams: strategyId === "smc_adaptive" ? params : undefined,
    smcAdaptiveV2Params: strategyId === "smc_adaptive_v2" ? params : undefined,
    smcAdaptiveShortParams: strategyId === "smc_adaptive_short" ? params : undefined,
    smcAdaptiveStartIndex: opts.startIndex,
    cdcFastPeriod: strategyId === "cdc_actionzone" ? params.fastPeriod : undefined,
    cdcSlowPeriod: strategyId === "cdc_actionzone" ? params.slowPeriod : undefined,
    rsiPeriod: strategyId === "rsi" ? (params.period ?? 14) : undefined,
    smcSwingSize: strategyId === "smc" ? (params.swingSize ?? 50) : undefined,
    smcInternalSize: strategyId === "smc" ? (params.internalSize ?? 5) : undefined,
    supertrendPeriod: strategyId === "supertrend" ? (params.atrPeriod ?? 10) : undefined,
    supertrendMultiplier: strategyId === "supertrend" ? (params.multiplier ?? 3.0) : undefined,
    msbZigzagLen: strategyId === "msb_ob" ? (params.zigzagLen ?? 9) : undefined,
    msbFibFactor: strategyId === "msb_ob" ? (params.fibFactor ?? 0.33) : undefined,
    srLeftBars: strategyId === "support_resistance" ? (params.leftBars ?? 15) : undefined,
    srRightBars: strategyId === "support_resistance" ? (params.rightBars ?? 15) : undefined,
    srVolumeThresh: strategyId === "support_resistance" ? (params.volumeThresh ?? 20) : undefined,
    trendLength: strategyId === "trendlines" ? (params.trendLength ?? 14) : undefined,
    trendMult: strategyId === "trendlines" ? (params.trendMult ?? 1.0) : undefined,
  });
}

/** แปลง indicator เป็น BUY/SELL/HOLD โดยไม่มีการจำลอง trade */
export function computeSignals(
  klines: KlineData[], strategyId: StrategyId,
  params: Record<string, number> = {}, opts: SignalOptions = {},
): SignalAction[] {
  return STRATEGY_FNS[strategyId](klines, computeStrategyIndicators(klines, strategyId, params, opts), params);
}

// ─── Backtest Engine ───────────────────────────────────────────
export function runBacktest(
  klines: KlineData[],
  strategyId: StrategyId,
  params: Record<string, number> = {},
  feesPct = 0.1, // 0.1% per trade (Binance default)
  opts: SignalOptions & { startIndex?: number; precomputedSignals?: SignalAction[] } = {},
): BacktestResult {
  const signals = opts.precomputedSignals ?? computeSignals(klines, strategyId, params, opts);

  const closes = klines.map(k => +k.close);
  const trades: Trade[] = [];
  let inPosition = false;
  let entryIdx = 0;
  let entryPrice = 0;
  let entryReason = "";

  // Generate trades
  const startIndex = Math.max(0, Math.min(klines.length, opts.startIndex ?? 0));
  for (let i = startIndex; i < klines.length; i++) {
    if (!inPosition && signals[i] === "BUY") {
      inPosition = true;
      entryIdx = i;
      entryPrice = closes[i];
      entryReason = "BUY signal";
    } else if (inPosition && signals[i] === "SELL") {
      const exitPrice = closes[i];
      const grossPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      const netPnlPct = grossPnlPct - feesPct * 2; // entry + exit fee
      trades.push({
        entryIdx,
        entryTime: klines[entryIdx].openTime,
        entryPrice,
        exitIdx: i,
        exitTime: klines[i].openTime,
        exitPrice,
        pnl: exitPrice - entryPrice,
        pnlPct: netPnlPct,
        bars: i - entryIdx,
        reason: `${entryReason} → SELL signal`,
      });
      inPosition = false;
    }
  }

  // Close any open position at last bar
  if (inPosition) {
    const exitPrice = closes[closes.length - 1];
    const grossPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const netPnlPct = grossPnlPct - feesPct * 2;
    trades.push({
      entryIdx,
      entryTime: klines[entryIdx].openTime,
      entryPrice,
      exitIdx: klines.length - 1,
      exitTime: klines[klines.length - 1].openTime,
      exitPrice,
      pnl: exitPrice - entryPrice,
      pnlPct: netPnlPct,
      bars: klines.length - 1 - entryIdx,
      reason: `${entryReason} → Force close (end)`,
    });
  }

  // Stats
  const wins = trades.filter(t => t.pnlPct > 0);
  const losses = trades.filter(t => t.pnlPct <= 0);
  const totalPnlPct = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  const winRate = trades.length === 0 ? 0 : (wins.length / trades.length) * 100;
  const avgWinPct = wins.length === 0 ? 0 : wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length;
  const avgLossPct = losses.length === 0 ? 0 : losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length;
  const avgBarsHeld = trades.length === 0 ? 0 : trades.reduce((s, t) => s + t.bars, 0) / trades.length;
  const bestTradePct = trades.length === 0 ? 0 : trades.reduce((best, t) => Math.max(best, t.pnlPct), -Infinity);
  const worstTradePct = trades.length === 0 ? 0 : trades.reduce((worst, t) => Math.min(worst, t.pnlPct), Infinity);

  const grossWins = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
  const profitFactor = grossLosses === 0 ? (grossWins > 0 ? Infinity : 0) : grossWins / grossLosses;

  // Equity curve (cumulative %)
  const equityCurve: number[] = [];
  let cumPnl = 0;
  let tradeIdx = 0;
  for (let i = 0; i < klines.length; i++) {
    if (tradeIdx < trades.length && i === trades[tradeIdx].exitIdx) {
      cumPnl += trades[tradeIdx].pnlPct;
      tradeIdx++;
    }
    equityCurve.push(cumPnl);
  }

  // Max drawdown
  let peak = 0, maxDD = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe (simplified — using trade returns)
  const tradePnls = trades.map(t => t.pnlPct);
  const meanRet = tradePnls.length === 0 ? 0 : tradePnls.reduce((a, b) => a + b, 0) / tradePnls.length;
  const variance = tradePnls.length <= 1 ? 0 : tradePnls.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (tradePnls.length - 1);
  const sharpe = variance === 0 ? 0 : meanRet / Math.sqrt(variance);

  // Buy & hold
  const buyAndHoldPct = closes.length - startIndex >= 2
    ? ((closes[closes.length - 1] - closes[startIndex]) / closes[startIndex]) * 100
    : 0;

  return {
    trades,
    totalPnlPct,
    winRate,
    wins: wins.length,
    losses: losses.length,
    totalTrades: trades.length,
    maxDrawdownPct: maxDD,
    sharpeRatio: sharpe,
    profitFactor,
    avgWinPct,
    avgLossPct,
    avgBarsHeld,
    bestTradePct,
    worstTradePct,
    equityCurve,
    signals,
    buyAndHoldPct,
  };
}
