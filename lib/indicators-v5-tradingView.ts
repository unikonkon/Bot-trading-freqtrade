/**
 * อินดิเคเตอร์เวอร์ชัน 5 — Smart Money Concepts [LuxAlgo] + สัญญาณ BUY/SELL จาก TradingView
 *
 * ที่มา: lib/Smart Money Concepts [LuxAlgo] beysell.pine (Pine v6, CC BY-NC-SA 4.0 © LuxAlgo)
 * เลขบรรทัดในคอมเมนต์ด้านล่างอ้างถึงไฟล์นั้น
 *
 * แปลงเฉพาะส่วนที่กำหนดสัญญาณ BUY/SELL — ทุกบรรทัดของส่วนนี้แปลงตรงตัว:
 *   • leg() (351–360): แท่ง i−size เป็นจุดกลับตัวเมื่อ high/low ของมันสุดขั้วกว่า `size` แท่งหลังจากนั้น
 *     จึงรู้ว่าเป็น pivot ช้ากว่าจริง `size` แท่งเสมอ — ไม่ใช้ข้อมูลในอนาคต
 *   • getCurrentStructure() (423–471): เก็บระดับ pivot ของ swing (ค่าตั้งต้น 50) และ internal (ฮาร์ดโค้ด 5)
 *   • displayStructure() (565–626): ราคาปิดตัดขึ้นเหนือ pivot high ที่ยังไม่ถูกตัด = โครงสร้างขาขึ้น
 *     ถ้าเทรนด์เดิมเป็นขาลงเรียก CHoCH ไม่งั้นเรียก BOS (ขาลงกลับกัน) · internal ต้องมีระดับต่างจาก swing
 *     และผ่าน Confluence Filter (ถ้าเปิด)
 *   • สัญญาณ (841–866): เลือกโครงสร้าง (Internal/Swing/Both) × ชนิด (CHoCH/BOS/All)
 *     แล้วกรองด้วย cooldown และบังคับสลับ BUY/SELL
 *
 * ที่ไม่ได้แปลง: Order Blocks, Fair Value Gaps, EQH/EQL, Premium/Discount, ระดับ MTF, Strong/Weak High/Low
 * ทั้งหมดเป็นส่วนวาดกราฟและ alert ที่ไม่มีผลต่อสัญญาณ BUY/SELL เลย (ไม่มีตัวแปรใดไหลกลับเข้าส่วนสัญญาณ)
 *
 * รายละเอียดที่คงไว้ตาม Pine แม้จะดูแปลก เพื่อให้ป้ายตรงกับ TradingView:
 *   • Confluence Filter เขียนว่า `math.min(close, open - low)` (570–571) ไม่ใช่ `math.min(close, open) - low`
 *     บน crypto ค่า close ใหญ่กว่า open − low เกือบเสมอ จึงเท่ากับเทียบไส้บนกับ (open − low)
 *   • internal จะไม่เกิดจนกว่า swing pivot ฝั่งเดียวกันจะมีค่าแล้ว (na != x เป็น false ใน Pine)
 *   • แท่งเดียวเกิดทั้ง BUY และ SELL ได้ในทางทฤษฎี Pine บันทึก BUY เป็นสถานะ (else if) — ที่นี่ใช้ BUY เช่นกัน
 *
 * การแปลงป้ายเป็นสถานะ (ส่วนที่ Pine ไม่มี): BUY = กลับเป็นซื้อ, SELL = กลับเป็นขาย (stop-and-reverse)
 * รหัสซื้ออย่างเดียว SELL = ปิดไม้ ป้ายของอินดิเคเตอร์คำนวณทุกแท่งเหมือน TradingView (`smcSignal`)
 * ส่วนสถานะเริ่มว่างที่ `startIndex` แล้วลงมือที่ป้ายแรกหลังจากนั้น
 *
 * ผลลัพธ์ใช้รูปแบบเดียวกับ v3 (exposure สองทาง) จึงวิ่งผ่าน engine / export / UI เดิมได้ทั้งหมด
 * ไฟล์นี้ import จาก indicators-v3 เฉพาะ type เพื่อไม่ให้เกิด import วนตอนโหลดโมดูล
 */
import type { KlineData } from "@/lib/types/kline";
import { atr, highest, lowest, opens, highs, lows, closes, type Series } from "@/lib/indicators-v2";
import type { V3Definition, V3Result, V3Signal } from "@/lib/indicators-v3";

// ══ 1) ค่าตั้งต้น ══════════════════════════════════════════════
/** ตัวเลือกของ Pine เก็บเป็นตัวเลขเพราะพารามิเตอร์ของระบบเป็นตัวเลขทั้งหมด */
export const SMC_STRUCTURE = { internal: 0, swing: 1, both: 2 } as const;
export const SMC_TRIGGER = { all: 0, bos: 1, choch: 2 } as const;

export const SMC_LUXALGO_V5_DEFAULTS = {
  /** 1 = อนุญาตฝั่งซื้อ, 0 = ปิด (มาจากรหัสกลยุทธ์ ไม่ใช่ผู้ใช้) */
  allowLong: 1,
  /** 1 = อนุญาตฝั่งขาย (ต้องเทรดบน futures), 0 = ปิด */
  allowShort: 1,

  /** swingsLengthInput (101) — Pine ค่าตั้งต้น 50, ขั้นต่ำ 10 */
  smcSwingLength: 50,
  /** ความยาว internal structure — Pine ฮาร์ดโค้ด 5 (797) */
  smcInternalLength: 5,
  /** internalFilterConfluenceInput (91): 1 = กรอง internal break ด้วยรูปไส้แท่ง */
  smcConfluenceFilter: 0,

  /** signalStructureInput (143): 0 Internal, 1 Swing, 2 Both — Pine ค่าตั้งต้น Internal */
  smcSignalStructure: SMC_STRUCTURE.internal,
  /** signalTriggerInput (144): 0 All, 1 BOS, 2 CHoCH — Pine ค่าตั้งต้น CHoCH */
  smcSignalTrigger: SMC_TRIGGER.choch,
  /** signalCooldownInput (145): ห่างจากสัญญาณก่อนอย่างน้อยกี่แท่ง */
  smcCooldownBars: 5,
  /** signalAlternateInput (146): 1 = BUY/SELL ต้องสลับกัน */
  smcAlternate: 1,

  /** ขนาดไม้เป็น % ของพอร์ต */
  smcSizePct: 100,
};
export type SmcLuxAlgoV5Params = typeof SMC_LUXALGO_V5_DEFAULTS;

/** รหัสเหตุการณ์โครงสร้างรายแท่ง: ±1 BOS, ±2 CHoCH (บวก = ขาขึ้น), 0 = ไม่มี */
export const SMC_BREAK = { bullBos: 1, bullChoch: 2, bearBos: -1, bearChoch: -2 } as const;

/** ผลลัพธ์ของ v5 = รูปแบบ v3 + ระดับโครงสร้างที่ใช้ตรวจว่าทำไมเกิดหรือไม่เกิดสัญญาณ */
export interface SmcLuxAlgoV5Result extends V3Result {
  /** ระดับ pivot ปัจจุบันรายแท่ง (หลังอัปเดต pivot ของแท่งนั้น) */
  internalHigh: Series;
  internalLow: Series;
  swingHigh: Series;
  swingLow: Series;
  /** bias ของเทรนด์หลังปิดแท่ง: 1 ขาขึ้น, −1 ขาลง, 0 ยังไม่เคยเกิดโครงสร้าง */
  internalTrend: number[];
  swingTrend: number[];
  /** เหตุการณ์โครงสร้างของแท่ง (ดู SMC_BREAK) */
  internalBreak: number[];
  swingBreak: number[];
  /** ป้ายที่ TradingView วาดทุกแท่ง รวมช่วงอุ่นเครื่อง: 1 BUY, −1 SELL, 0 ไม่มี */
  smcSignal: number[];
}

// ══ 2) ส่วนประกอบ ══════════════════════════════════════════════
/** ระยะห่างของแท่งเป็นนาที (ค่ามัธยฐานของ 200 ช่วงแรก) — ใช้รายงานผลเท่านั้น */
function timeframeOf(k: KlineData[]): number {
  const gaps: number[] = [];
  for (let i = 1; i <= Math.min(k.length - 1, 200); i++) {
    const g = k[i].openTime - k[i - 1].openTime;
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] / 60000;
}

/** สถานะของ pivot หนึ่งจุด (UDT `pivot` บรรทัด 234) */
interface Pivot { level: number | null; crossed: boolean }

/**
 * ตัวติดตาม leg + pivot ของ size หนึ่งค่า (getCurrentStructure ที่ไม่รวม EQH/EQL)
 * leg: 0 = ขาลง (เพิ่งเกิด pivot high), 1 = ขาขึ้น (เพิ่งเกิด pivot low) — เริ่มที่ 0 ตาม `var int legValue = 0`
 */
function structureTracker(h: number[], l: number[], size: number) {
  const hh = highest(h, size), ll = lowest(l, size);
  const high: Pivot = { level: null, crossed: false };
  const low: Pivot = { level: null, crossed: false };
  let legValue = 0;
  return {
    high, low,
    update(i: number) {
      if (i < size) return;
      const prev = legValue;
      // ta.highest(size) รวมแท่งปัจจุบัน = แท่ง i−size+1..i จึงไม่รวมแท่ง i−size เอง
      if (hh[i] !== null && h[i - size] > (hh[i] as number)) legValue = 0;
      else if (ll[i] !== null && l[i - size] < (ll[i] as number)) legValue = 1;
      const change = legValue - prev;
      if (change === 1) { low.level = l[i - size]; low.crossed = false; }
      else if (change === -1) { high.level = h[i - size]; high.crossed = false; }
    },
  };
}

// ══ 3) ตัวคำนวณ ═══════════════════════════════════════════════
export function smcLuxAlgoV5(
  k: KlineData[],
  overrides: Partial<SmcLuxAlgoV5Params> | Record<string, number> = {},
  startIndex = 0,
): SmcLuxAlgoV5Result {
  const p = { ...SMC_LUXALGO_V5_DEFAULTS, ...overrides } as SmcLuxAlgoV5Params;
  for (const [key, v] of Object.entries(p))
    if (!Number.isFinite(v) || v < 0) throw new Error(`Invalid SMC LuxAlgo V5 parameter: ${key}`);
  const problem = validateSmcLuxAlgo(p);
  if (problem) throw new Error(`SMC LuxAlgo V5: ${problem}`);
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > k.length)
    throw new Error("Invalid SMC LuxAlgo V5 startIndex");

  const n = k.length;
  const o = opens(k), h = highs(k), l = lows(k), c = closes(k);
  const swingLen = Math.round(p.smcSwingLength), internalLen = Math.round(p.smcInternalLength);
  const structure = Math.round(p.smcSignalStructure), trigger = Math.round(p.smcSignalTrigger);
  const useInternal = structure === SMC_STRUCTURE.internal || structure === SMC_STRUCTURE.both;
  const useSwing = structure === SMC_STRUCTURE.swing || structure === SMC_STRUCTURE.both;
  const useChoch = trigger === SMC_TRIGGER.choch || trigger === SMC_TRIGGER.all;
  const useBos = trigger === SMC_TRIGGER.bos || trigger === SMC_TRIGGER.all;
  const cooldown = Math.round(p.smcCooldownBars);
  const alternate = p.smcAlternate >= 0.5, confluence = p.smcConfluenceFilter >= 0.5;
  const size = p.smcSizePct / 100;

  const blank = (): Series => new Array(n).fill(null);
  const zeros = (): number[] => new Array(n).fill(0);
  const r: SmcLuxAlgoV5Result = {
    exposure: zeros(),
    signal: new Array(n).fill(null) as V3Signal[],
    reason: new Array(n).fill("รอให้อินดิเคเตอร์พร้อม"),
    regime: new Array(n).fill("warmup"),
    direction: zeros(),
    size: blank(),
    confidence: blank(),
    signalValue: blank(),
    // ta.atr(200) = atrMeasure ของ Pine (329) ใช้กรอง Order Block — รายงานไว้เป็นความผันผวนอ้างอิง
    atr: atr(k, 200),
    fastEMA: blank(),
    trendEMA: blank(),
    utcHour: blank(),
    timeframeMinutes: timeframeOf(k),
    resolvedLookbackBars: swingLen,
    resolvedDebiasBars: internalLen,
    internalHigh: blank(),
    internalLow: blank(),
    swingHigh: blank(),
    swingLow: blank(),
    internalTrend: zeros(),
    swingTrend: zeros(),
    internalBreak: zeros(),
    swingBreak: zeros(),
    smcSignal: zeros(),
  };

  const swing = structureTracker(h, l, swingLen);
  const internal = structureTracker(h, l, internalLen);
  let swingBias = 0, internalBias = 0;
  // `var bullishBar/bearishBar = true` แยกตาม call site แต่ใช้ผลเฉพาะฝั่ง internal (579, 604)
  let bullishBar = true, bearishBar = true;
  let lastSignalBar: number | null = null, lastSignalBias = 0;
  let dir = 0;

  const sideTh = (s: number) => (s === 1 ? "ซื้อ" : "ขาย");
  const tagOf = (code: number) => `${Math.abs(code) === 2 ? "CHoCH" : "BOS"}${code > 0 ? "↑" : "↓"}`;
  const fmt = (x: number) => x.toPrecision(6);
  /** ta.crossover(close, level) กับประวัติของระดับที่ call site นั้นเห็นในแท่งก่อน */
  const crossOver = (i: number, level: Series) =>
    i > 0 && level[i] !== null && level[i - 1] !== null &&
    c[i] > (level[i] as number) && c[i - 1] <= (level[i - 1] as number);
  const crossUnder = (i: number, level: Series) =>
    i > 0 && level[i] !== null && level[i - 1] !== null &&
    c[i] < (level[i] as number) && c[i - 1] >= (level[i - 1] as number);

  for (let i = 0; i < n; i++) {
    r.utcHour[i] = new Date(k[i].openTime).getUTCHours();

    // ── getCurrentStructure: swing ก่อน internal ตามลำดับใน Pine (796–797) ──
    swing.update(i);
    internal.update(i);
    r.swingHigh[i] = swing.high.level; r.swingLow[i] = swing.low.level;
    r.internalHigh[i] = internal.high.level; r.internalLow[i] = internal.low.level;

    // ── displayStructure(true) แล้วตามด้วย displayStructure() (803, 806) ──
    if (confluence) {
      const upperWick = h[i] - Math.max(c[i], o[i]);
      const lowerSide = Math.min(c[i], o[i] - l[i]); // ตาม Pine ตรงตัว ดูหมายเหตุหัวไฟล์
      bullishBar = upperWick > lowerSide;
      bearishBar = upperWick < lowerSide;
    }
    let iBreak = 0, sBreak = 0;

    // internal: ระดับต้องต่างจาก swing (na เทียบกับอะไรก็เป็น false)
    const iHighOk = internal.high.level !== null && swing.high.level !== null &&
      internal.high.level !== swing.high.level && bullishBar;
    if (crossOver(i, r.internalHigh) && !internal.high.crossed && iHighOk) {
      iBreak = internalBias === -1 ? SMC_BREAK.bullChoch : SMC_BREAK.bullBos;
      internal.high.crossed = true; internalBias = 1;
    }
    const iLowOk = internal.low.level !== null && swing.low.level !== null &&
      internal.low.level !== swing.low.level && bearishBar;
    if (crossUnder(i, r.internalLow) && !internal.low.crossed && iLowOk) {
      iBreak = internalBias === 1 ? SMC_BREAK.bearChoch : SMC_BREAK.bearBos;
      internal.low.crossed = true; internalBias = -1;
    }

    if (crossOver(i, r.swingHigh) && !swing.high.crossed) {
      sBreak = swingBias === -1 ? SMC_BREAK.bullChoch : SMC_BREAK.bullBos;
      swing.high.crossed = true; swingBias = 1;
    }
    if (crossUnder(i, r.swingLow) && !swing.low.crossed) {
      sBreak = swingBias === 1 ? SMC_BREAK.bearChoch : SMC_BREAK.bearBos;
      swing.low.crossed = true; swingBias = -1;
    }
    r.internalBreak[i] = iBreak; r.swingBreak[i] = sBreak;
    r.internalTrend[i] = internalBias; r.swingTrend[i] = swingBias;

    // ── สัญญาณ BUY/SELL (853–866) ──
    const wanted = (code: number, bull: boolean) =>
      (bull ? code > 0 : code < 0) && ((useChoch && Math.abs(code) === 2) || (useBos && Math.abs(code) === 1));
    const bullishBreak = (useInternal && wanted(iBreak, true)) || (useSwing && wanted(sBreak, true));
    const bearishBreak = (useInternal && wanted(iBreak, false)) || (useSwing && wanted(sBreak, false));
    const cooldownOver = lastSignalBar === null || i - lastSignalBar >= cooldown;
    const buy = bullishBreak && cooldownOver && (!alternate || lastSignalBias !== 1);
    const sell = bearishBreak && cooldownOver && (!alternate || lastSignalBias !== -1);
    let smc = 0;
    if (buy) { lastSignalBar = i; lastSignalBias = 1; smc = 1; }
    else if (sell) { lastSignalBar = i; lastSignalBias = -1; smc = -1; }
    r.smcSignal[i] = smc;

    const bias = useSwing && !useInternal ? swingBias : internalBias;
    r.signalValue[i] = bias;
    const ready = (useInternal ? internal.high.level !== null || internal.low.level !== null : true) &&
      (useSwing ? swing.high.level !== null || swing.low.level !== null : true);
    r.regime[i] = !ready ? "warmup" : bias === 1 ? "uptrend" : bias === -1 ? "downtrend" : "range";

    const events = [iBreak ? `internal ${tagOf(iBreak)}` : "", sBreak ? `swing ${tagOf(sBreak)}` : ""]
      .filter(Boolean).join(" + ");

    if (i < startIndex) {
      r.reason[i] = ready ? "warmup (no position)" : r.reason[i];
      continue;
    }

    // ── แปลงป้ายเป็นสถานะ: ลงมือที่ราคาปิดแท่งป้าย (engine next_open เปิดที่แท่งถัดไป) ──
    if (smc !== 0) {
      const allowed = smc === 1 ? p.allowLong >= 0.5 : p.allowShort >= 0.5;
      const next = allowed ? smc : 0;
      const label = smc === 1 ? "BUY" : "SELL";
      if (next === dir) {
        r.reason[i] = dir === 0
          ? `ป้าย ${label} (${events}) แต่รหัสนี้ไม่เปิดฝั่ง${sideTh(smc)} จึงว่างต่อ`
          : `ป้าย ${label} (${events}) ซ้ำฝั่งที่ถืออยู่ ถือต่อ`;
      } else {
        // สลับข้างใช้สัญญาณเปิดฝั่งใหม่ (alternateSignals ตีความเป็นการพลิกข้าง) · ปิดอย่างเดียวใช้ SELL/COVER
        r.signal[i] = next === 1 ? "BUY" : next === -1 ? "SHORT" : dir === 1 ? "SELL" : "COVER";
        const action = next === 0 ? `ปิดไม้${sideTh(dir)}` : dir === 0 ? `เปิด${sideTh(next)}` : `กลับจาก${sideTh(dir)}เป็น${sideTh(next)}`;
        r.reason[i] = `${action}: ป้าย ${label} จาก ${events} ที่ราคาปิด ${fmt(c[i])}`;
        dir = next;
      }
    } else if (!ready) {
      r.reason[i] = `รอ pivot แรก (swing ${swingLen} แท่ง · internal ${internalLen} แท่ง)`;
    } else if (bullishBreak || bearishBreak) {
      const why = !cooldownOver ? `ยังไม่ครบ cooldown ${cooldown} แท่ง` : "ป้ายต้องสลับฝั่งกับป้ายก่อน";
      r.reason[i] = `ข้าม ${events}: ${why}`;
    } else {
      const lvl = (x: number | null) => (x === null ? "—" : fmt(x));
      const [hi, lo] = useSwing && !useInternal
        ? [swing.high.level, swing.low.level] : [internal.high.level, internal.low.level];
      const wait = dir === 1 ? `รอโครงสร้างขาลง: ปิดใต้ ${lvl(lo)}`
        : dir === -1 ? `รอโครงสร้างขาขึ้น: ปิดเหนือ ${lvl(hi)}`
          : `รอปิดเหนือ ${lvl(hi)} หรือใต้ ${lvl(lo)}`;
      r.reason[i] = `${dir === 0 ? "ว่าง" : `ถือ${sideTh(dir)}`}${events ? ` · ${events} (ไม่ใช่ชนิดที่ตั้งให้ยิง)` : ""} · ${wait}`;
    }

    r.direction[i] = dir;
    r.exposure[i] = dir * size;
    if (dir !== 0) r.size[i] = size;
  }
  return r;
}

// ══ 4) ตรวจพารามิเตอร์ ═════════════════════════════════════════
function validateSmcLuxAlgo(p: Record<string, number>): string | null {
  const isInt = (x: number) => Number.isInteger(x);
  if (!isInt(p.smcSwingLength) || p.smcSwingLength < 10) return "ความยาว swing ต้องเป็นจำนวนเต็มอย่างน้อย 10 (ขั้นต่ำเดียวกับ Pine)";
  if (!isInt(p.smcInternalLength) || p.smcInternalLength < 2) return "ความยาว internal ต้องเป็นจำนวนเต็มอย่างน้อย 2";
  if (![0, 1, 2].includes(p.smcSignalStructure)) return "โครงสร้างที่ใช้ยิงต้องเป็น 0 Internal, 1 Swing หรือ 2 Both";
  if (![0, 1, 2].includes(p.smcSignalTrigger)) return "ชนิดที่ใช้ยิงต้องเป็น 0 All, 1 BOS หรือ 2 CHoCH";
  if (!isInt(p.smcCooldownBars)) return "cooldown ต้องเป็นจำนวนเต็ม";
  if (p.smcSizePct <= 0 || p.smcSizePct > 100) return "ขนาดไม้ต้องอยู่ระหว่าง 1–100%";
  return null;
}

// ══ 5) ทะเบียนกลยุทธ์ ══════════════════════════════════════════
export type V5StrategyId = "smc_luxalgo_v5" | "smc_luxalgo_v5_long";

export const SMC_LUXALGO_RULE_TH =
  "Smart Money Concepts [LuxAlgo] + Buy & Sell Signals (แปลงจาก Pine v6 ตรงตัวเฉพาะส่วนที่กำหนดสัญญาณ). " +
  "Pivot: แท่ง i−N เป็น pivot high เมื่อ high ของมันสูงกว่าทุกแท่งใน N แท่งถัดมา (pivot low กลับกัน) " +
  "จึงรู้ช้า N แท่งเสมอ · swing ใช้ N = smcSwingLength, internal ใช้ N = smcInternalLength (Pine ฮาร์ดโค้ด 5). " +
  "โครงสร้าง: ราคาปิดตัดขึ้นเหนือ pivot high ที่ยังไม่ถูกตัด = ขาขึ้น เรียก CHoCH ถ้าเทรนด์เดิมเป็นขาลง ไม่งั้นเรียก BOS " +
  "(ขาลงกลับกันด้วย pivot low) · internal ต้องมีระดับต่างจาก swing และผ่าน Confluence Filter ถ้าเปิด. " +
  "สัญญาณ: BUY/SELL เมื่อเกิดโครงสร้างชนิด smcSignalTrigger (0 All, 1 BOS, 2 CHoCH) บน smcSignalStructure " +
  "(0 Internal, 1 Swing, 2 Both) ห่างจากป้ายก่อนอย่างน้อย smcCooldownBars แท่ง และต้องสลับฝั่งถ้า smcAlternate = 1. " +
  "สถานะ: BUY กลับเป็นซื้อ SELL กลับเป็นขาย (stop-and-reverse) ลงมือที่ราคาเปิดแท่งถัดไป ไม่มี SL/TP. " +
  "ข้อจำกัด: Pine ต้นฉบับเป็นเครื่องมือวาดกราฟ ไม่มีการจัดการไม้ และไม่ได้ผ่านการวัดความได้เปรียบก่อนลงทะเบียน " +
  "ผลย้อนหลังในเว็บจึงเป็นการวัดครั้งแรก ไม่ใช่หลักฐานว่าใช้ได้";

const SCOPE_V5: Record<V5StrategyId, string> = {
  smc_luxalgo_v5: "รหัสนี้เทรดสองทาง ต้องใช้บน futures — ถือตลอดเวลาหลังป้ายแรก ไม่มีช่วงว่าง",
  smc_luxalgo_v5_long:
    "รหัสนี้ซื้ออย่างเดียว ใช้บน Spot ได้ — BUY เปิดซื้อ SELL ปิดไม้แล้วว่างจนกว่าจะมี BUY ถัดไป " +
    "ป้ายของอินดิเคเตอร์เหมือนรหัสสองทางทุกแท่ง ต่างกันแค่การลงมือ",
};

const SMC_GROUP = "SMC LuxAlgo (TradingView)";
/** เส้นที่วาดทับกราฟ = pivot high ของ internal structure (ระดับที่ต้องปิดเหนือเพื่อเกิด BUY ตามค่าตั้งต้น) */
const SMC_OVERLAY = "v3.internalHigh";

function smcDefaults(overrides: Partial<SmcLuxAlgoV5Params> = {}): Record<string, number> {
  const { allowLong: _l, allowShort: _s, ...rest } = SMC_LUXALGO_V5_DEFAULTS;
  return { ...rest, ...overrides };
}
/** ต้องมี swing pivot ทั้งสองฝั่งก่อน internal จึงยิงได้ — เผื่อหลายช่วง swing */
const smcWarmup = (p: Record<string, number>) => Math.max(300, 6 * (p.smcSwingLength ?? 50));
const smcCompute: V3Definition["compute"] = (k, params, startIndex) => smcLuxAlgoV5(k, params, startIndex);

export const V5_REGISTRY: Record<V5StrategyId, V3Definition> = {
  smc_luxalgo_v5: {
    name: "SMC LuxAlgo V5 (สองทาง)",
    th: "ป้าย BUY/SELL ของ Smart Money Concepts [LuxAlgo] จาก TradingView: internal CHoCH, cooldown 5 แท่ง, สลับฝั่งเสมอ — BUY กลับเป็นซื้อ SELL กลับเป็นขาย",
    en: "BUY/SELL labels of Smart Money Concepts [LuxAlgo] (internal CHoCH, 5-bar cooldown, alternating) traded stop-and-reverse",
    group: SMC_GROUP,
    overlay: SMC_OVERLAY,
    direction: { allowLong: 1, allowShort: 1 },
    defaults: smcDefaults(),
    compute: smcCompute,
    warmupBars: smcWarmup,
    validate: validateSmcLuxAlgo,
    rule: `${SMC_LUXALGO_RULE_TH}. ${SCOPE_V5.smc_luxalgo_v5}`,
  },
  smc_luxalgo_v5_long: {
    name: "SMC LuxAlgo V5 (ซื้ออย่างเดียว)",
    th: "ป้ายเดียวกับตัวสองทาง แต่ SELL แค่ปิดไม้ ไม่เปิดขาย — ใช้บน Spot ได้",
    en: "Same labels as the two-way version, but SELL only closes the long — Spot compatible",
    group: SMC_GROUP,
    overlay: SMC_OVERLAY,
    direction: { allowLong: 1, allowShort: 0 },
    defaults: smcDefaults(),
    compute: smcCompute,
    warmupBars: smcWarmup,
    validate: validateSmcLuxAlgo,
    rule: `${SMC_LUXALGO_RULE_TH}. ${SCOPE_V5.smc_luxalgo_v5_long}`,
  },
};

export const V5_STRATEGY_IDS = Object.keys(V5_REGISTRY) as V5StrategyId[];
const V5_ID_SET = new Set<string>(V5_STRATEGY_IDS);
export function isV5StrategyId(id: string): id is V5StrategyId {
  return V5_ID_SET.has(id);
}

/** ป้ายและขอบเขตของพารามิเตอร์ (รูปแบบเดียวกับ V3ParamMeta) */
const bars = (label: string, min: number, max: number) => ({ label, min, max, step: 1, integer: true });
const num = (label: string, min: number, max: number, step: number) => ({ label, min, max, step, integer: false });

export const V5_PARAM_META: Record<string, { label: string; min: number; max: number; step: number; integer: boolean }> = {
  smcSwingLength: bars("ความยาว swing structure (Pine = 50)", 10, 500),
  smcInternalLength: bars("ความยาว internal structure (Pine = 5)", 2, 50),
  smcConfluenceFilter: bars("Confluence Filter ของ internal (0 = ปิด, 1 = เปิด)", 0, 1),
  smcSignalStructure: bars("โครงสร้างที่ยิงสัญญาณ (0 Internal, 1 Swing, 2 Both)", 0, 2),
  smcSignalTrigger: bars("ชนิดที่ยิงสัญญาณ (0 All, 1 BOS, 2 CHoCH)", 0, 2),
  smcCooldownBars: bars("Cooldown ระหว่างสัญญาณ (แท่ง)", 0, 500),
  smcAlternate: bars("BUY/SELL ต้องสลับกัน (0 = ไม่, 1 = ใช่)", 0, 1),
  smcSizePct: num("ขนาดไม้ (% ของพอร์ต)", 1, 100, 1),
};
