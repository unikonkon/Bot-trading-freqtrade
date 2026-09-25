/**
 * อินดิเคเตอร์เวอร์ชัน 4 — Horizon Flow จากคลิป YouTube
 *
 * ที่มา: คลิป "ถ้าเป้าหมายคือเทรดวันละ 100$" ช่อง Ball Goldricher (16 ก.ย. 2569)
 * ถอดความไว้ที่ horizon-flow-transcript-th.md — เลขนาทีในคอมเมนต์ด้านล่างอ้างถึงไฟล์นั้น
 *
 * กฎตามคลิป (04:42–11:30)
 *   1. EMA 100 กรองเทรนด์: อยู่เหนือเส้น = โฟกัสซื้อ, อยู่ใต้เส้น = โฟกัสขาย
 *   2. ทริก "3 แท่ง" (08:22): จะเปลี่ยนฝั่งได้ต้องมีแท่งไล่ทิศต่อกัน 3 แท่ง
 *      ขาขึ้น high ต้องสูงกว่าแท่งก่อนทุกแท่ง ขาลง low ต้องต่ำกว่า ราคาซ้ำไม่นับ (10:26)
 *      ถ้ายังไม่ครบ ฝั่งเดิมยังค้างอยู่ แม้ราคาจะข้าม EMA ไปแล้ว (22:00 เข้าขายทั้งที่ราคาอยู่เหนือเส้น)
 *   3. Stochastic ต้องอยู่ในโซน: ซื้อเมื่อ oversold ขายเมื่อ overbought (> 80)
 *      ถ้าโค้งกลับออกจากโซนแล้วยังไม่เกิน 50 ยังเข้าได้ (06:46)
 *   4. เข้าที่แท่ง Price Action ยืนยัน เช่นแท่งกลืนกิน (16:47)
 *   5. SL 500 จุด TP 1,000 จุด = RR 1:2 ออกเมื่อชน SL หรือ TP เท่านั้น
 *
 * สิ่งที่ต้องแปลงเพราะคลิปเทรดทองคำ M1 บน MT5 แต่ระบบนี้เป็น crypto บน Binance
 *   • "500 จุด" ของ XAUUSD = $5 ใช้กับ BTC ไม่ได้ จึงแปลงเป็นระยะตามความผันผวน SL = hfStopAtr × ATR
 *   • ค่าธรรมเนียม crypto สูงกว่าสเปรดทองมาก วัดบน BTCUSDT หนึ่งปี (SL 1.5 ATR, RR 1:2)
 *     win rate ที่ต้องได้เพื่อเสมอตัวบน Spot คือ 1m 144% · 5m 72% · 15m 53% · 30m 47%
 *     ท่านี้จึงมีโอกาสเฉพาะ 15m ขึ้นไป — บน 1m ค่าธรรมเนียมใหญ่กว่า SL เอง
 *   • แท่ง PA ในคลิปตัดสินด้วยตา ในโค้ดนิยามเป็น Engulfing หรือ Pin bar เท่านั้น
 *
 * การปิดไม้: SL/TP ตรวจด้วย high/low ของแท่ง และประกาศราคาปิดไว้ใน `exitFill`
 * ให้ตัวจำลองปิดที่ราคานั้นจริง แทนที่จะรอ open แท่งถัดไป (ซึ่งบิดระยะ R ของท่าที่ใช้ SL/TP ตายตัว)
 * ถ้าแท่งเดียวแตะทั้ง SL และ TP นับว่าชน SL ก่อนเสมอ ถ้าเปิดแท่งกระโดดข้ามระดับไป ปิดที่ราคาเปิด
 *
 * ผลลัพธ์ใช้รูปแบบเดียวกับ v3 (exposure สองทาง) จึงวิ่งผ่าน engine / export / UI เดิมได้ทั้งหมด
 * ไฟล์นี้ import จาก indicators-v3 เฉพาะ type เพื่อไม่ให้เกิด import วนตอนโหลดโมดูล
 */
import type { KlineData } from "@/lib/types/kline";
import {
  atr, ema, sma, highest, lowest, crossOver, crossUnder,
  opens, highs, lows, closes, type Series,
} from "@/lib/indicators-v2";
import type { V3Definition, V3Result, V3Signal } from "@/lib/indicators-v3";

// ══ 1) ค่าตั้งต้น ══════════════════════════════════════════════
export const HORIZON_FLOW_V4_DEFAULTS = {
  /** 1 = อนุญาตฝั่งซื้อ, 0 = ปิด (มาจากรหัสกลยุทธ์ ไม่ใช่ผู้ใช้) */
  allowLong: 1,
  /** 1 = อนุญาตฝั่งขาย (ต้องเทรดบน futures), 0 = ปิด */
  allowShort: 1,

  // ── ชั้นทิศทาง ──
  /** EMA ที่ใช้กรองเทรนด์ — คลิปใช้ 100 */
  hfEmaPeriod: 100,
  /** ต้องมีแท่งไล่ทิศต่อกันกี่แท่งจึงเปลี่ยนฝั่ง — คลิปใช้ 3 */
  hfConfirmBars: 3,
  /** EMA ต้องชันไปทางเดียวกันเทียบกับกี่แท่งก่อน (0 = ปิด) */
  hfSlopeBars: 0,

  // ── ชั้นจังหวะ ──
  hfStochLength: 14,
  hfStochSmoothK: 3,
  hfStochSmoothD: 3,
  hfStochOversold: 20,
  hfStochOverbought: 80,
  /** เส้นกลาง: โค้งกลับออกจากโซนแล้วยังเข้าได้จนกว่า %K จะข้ามเส้นนี้ — คลิปใช้ 50 */
  hfStochMid: 50,
  /** 1 = ต้องเห็น %K ตัด %D กลับทิศก่อนจึงเข้า, 0 = แค่อยู่ในโซนก็พอ */
  hfRequireCross: 0,
  /** Pin bar: ไส้ต้องยาวอย่างน้อยกี่เท่าของตัวแท่ง */
  hfPinWickMult: 2,

  // ── ชั้นการจัดการไม้ ──
  hfAtrPeriod: 14,
  /** ระยะ SL เป็นกี่เท่าของ ATR (แทน "500 จุด" ในคลิป) */
  hfStopAtr: 1.5,
  /** เป้าหมายเป็นกี่ R — คลิปใช้ 2 · 0 = ไม่มีเป้าตายตัว (ต้องมี trailing หรือออกเมื่อกลับฝั่ง) */
  hfTargetR: 2,
  /** ต้นทุนไป–กลับโดยประมาณ (%) ใช้คำนวณพื้นของ SL — 0.16% = futures taker รวม slippage */
  hfCostPct: 0.16,
  /** SL ต้องกว้างอย่างน้อยกี่เท่าของต้นทุน (0 = ปิด) — 5 = ต้นทุนกินไม่เกิน 20% ของ 1R */
  hfMinStopCostMult: 0,
  /** เลื่อน SL มาที่ราคาเข้าเมื่อกำไรถึงกี่ R (0 = ปิด) */
  hfBreakevenR: 0,
  /** trailing stop ห่างจากจุดสุดขั้วตั้งแต่เข้ากี่ ATR (0 = ปิด) เริ่มทำงานหลังถึงจุดคุ้มทุน */
  hfTrailAtr: 0,
  /** 1 = ออกเมื่อชั้นทิศทางยืนยันฝั่งตรงข้าม, 0 = ออกด้วย SL/TP เท่านั้น */
  hfExitOnFlip: 0,
  /** ขนาดไม้เป็น % ของพอร์ต */
  hfSizePct: 100,
};
export type HorizonFlowV4Params = typeof HORIZON_FLOW_V4_DEFAULTS;

/** ผลลัพธ์ของ v4 = รูปแบบ v3 + ค่าที่ใช้ตรวจว่าทำไมเข้าหรือไม่เข้า (ส่งออกเป็นคอลัมน์ได้) */
export interface HorizonFlowV4Result extends V3Result {
  stochK: Series;
  stochD: Series;
  /** ฝั่งที่ชั้นทิศทางยืนยันแล้วรายแท่ง: 1 ซื้อ, −1 ขาย, 0 ยังไม่เคยยืนยัน */
  regimeDir: number[];
  exitFill: Series;
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

/**
 * ทริก "3 แท่ง": แท่ง i และ n−1 แท่งก่อนหน้าปิดฝั่งเดียวกับ EMA ทั้งหมด
 * และทุกแท่งทำ high ใหม่ (ขาขึ้น) หรือ low ใหม่ (ขาลง) เทียบแท่งก่อนหน้าแบบเข้มงวด
 */
function confirmsSide(
  i: number, side: 1 | -1, n: number, c: number[], h: number[], l: number[], e: Series,
): boolean {
  if (i - n < 0) return false;
  for (let j = 0; j < n; j++) {
    const x = i - j, ex = e[x];
    if (ex === null || side * (c[x] - ex) <= 0) return false;
    if (side === 1 ? h[x] <= h[x - 1] : l[x] >= l[x - 1]) return false;
  }
  return true;
}

/** แท่ง Price Action ยืนยันฝั่ง `side` — คืนชื่อรูปแบบ หรือ null ถ้าไม่ใช่ */
function priceAction(
  i: number, side: 1 | -1, o: number[], h: number[], l: number[], c: number[], wickMult: number,
): string | null {
  if (i < 1) return null;
  const range = h[i] - l[i];
  if (range <= 0) return null;
  const body = Math.abs(c[i] - o[i]);
  const po = o[i - 1], pc = c[i - 1];
  if (side === 1 && c[i] > o[i] && pc < po && c[i] >= po && o[i] <= pc) return "แท่งกลืนกินขาขึ้น";
  if (side === -1 && c[i] < o[i] && pc > po && c[i] <= po && o[i] >= pc) return "แท่งกลืนกินขาลง";
  // Pin bar: ไส้ฝั่งที่ถูกปฏิเสธยาวอย่างน้อยครึ่งแท่ง และยาวกว่าตัวแท่ง wickMult เท่า
  const wick = side === 1 ? Math.min(o[i], c[i]) - l[i] : h[i] - Math.max(o[i], c[i]);
  if (wick >= 0.5 * range && wick >= wickMult * body) return side === 1 ? "pin bar ไส้ล่าง" : "pin bar ไส้บน";
  return null;
}

/** Stochastic แบบเดียวกับ stochasticV2 แต่ไม่มีชั้นกรองสัญญาณของ v2 */
function stochastic(k: KlineData[], len: number, smoothK: number, smoothD: number) {
  const c = closes(k), hh = highest(highs(k), len), ll = lowest(lows(k), len);
  const raw: Series = c.map((x, i) => {
    const hi = hh[i], lo = ll[i];
    if (hi === null || lo === null) return null;
    return hi === lo ? 50 : (100 * (x - lo)) / (hi - lo);
  });
  const K = sma(raw, Math.max(1, smoothK));
  return { K, D: sma(K, Math.max(1, smoothD)) };
}

// ══ 3) ตัวคำนวณ ═══════════════════════════════════════════════
export function horizonFlowV4(
  k: KlineData[],
  overrides: Partial<HorizonFlowV4Params> | Record<string, number> = {},
  startIndex = 0,
): HorizonFlowV4Result {
  const p = { ...HORIZON_FLOW_V4_DEFAULTS, ...overrides } as HorizonFlowV4Params;
  for (const [key, v] of Object.entries(p))
    if (!Number.isFinite(v) || v < 0) throw new Error(`Invalid Horizon Flow V4 parameter: ${key}`);
  const problem = validateHorizonFlow(p);
  if (problem) throw new Error(`Horizon Flow V4: ${problem}`);
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > k.length)
    throw new Error("Invalid Horizon Flow V4 startIndex");

  const n = k.length;
  const o = opens(k), h = highs(k), l = lows(k), c = closes(k);
  const emaS = ema(c, Math.max(2, Math.round(p.hfEmaPeriod)));
  const atrS = atr(k, Math.max(2, Math.round(p.hfAtrPeriod)));
  const { K, D } = stochastic(k, Math.max(2, Math.round(p.hfStochLength)),
    Math.round(p.hfStochSmoothK), Math.round(p.hfStochSmoothD));
  const confirmN = Math.max(1, Math.round(p.hfConfirmBars));
  const slopeN = Math.round(p.hfSlopeBars);
  const size = p.hfSizePct / 100;

  const blank = (): Series => new Array(n).fill(null);
  const stopS = blank(), targetS = blank(), riskS = blank(), holdS = blank(), exitFill = blank();
  const triggerDir: Series = blank();
  const r: HorizonFlowV4Result = {
    exposure: new Array(n).fill(0),
    signal: new Array(n).fill(null) as V3Signal[],
    reason: new Array(n).fill("รอให้อินดิเคเตอร์พร้อม"),
    regime: new Array(n).fill("warmup"),
    direction: new Array(n).fill(0),
    size: blank(),
    confidence: blank(),
    signalValue: K,
    atr: atrS,
    fastEMA: blank(),
    trendEMA: emaS,
    utcHour: blank(),
    timeframeMinutes: timeframeOf(k),
    resolvedLookbackBars: Math.max(2, Math.round(p.hfEmaPeriod)),
    resolvedDebiasBars: confirmN,
    stop: stopS,
    target: targetS,
    riskPct: riskS,
    holdBars: holdS,
    triggerDir,
    stochK: K,
    stochD: D,
    regimeDir: new Array(n).fill(0),
    exitFill,
  };

  // สถานะของชั้นทิศทาง / ชั้นจังหวะ / ไม้ที่ถือ
  let regime = 0;
  let armed = 0, crossed = false;          // armed: 1 = รอซื้อ, −1 = รอขาย
  let dir = 0, pending = 0, pendingRisk = 0;
  let entry = 0, stop = 0, target: number | null = null, risk = 0, oneR = 0, best = 0, held = 0;
  let protectedStop = false;                // SL ถูกเลื่อนมาที่ทุนหรือเป็น trailing แล้ว

  const sideTh = (s: number) => (s === 1 ? "ซื้อ" : "ขาย");
  const fmt = (x: number) => x.toPrecision(6);

  for (let i = 0; i < n; i++) {
    r.utcHour[i] = new Date(k[i].openTime).getUTCHours();
    const e = emaS[i], a = atrS[i], kk = K[i], dd = D[i];

    // ── ชั้นทิศทาง: เปลี่ยนฝั่งเมื่อครบ 3 แท่งเท่านั้น ไม่ครบ = ค้างฝั่งเดิม ──
    if (confirmsSide(i, 1, confirmN, c, h, l, emaS)) regime = 1;
    else if (confirmsSide(i, -1, confirmN, c, h, l, emaS)) regime = -1;
    r.regimeDir[i] = regime;
    r.regime[i] = e === null ? "warmup" : regime === 1 ? "uptrend" : regime === -1 ? "downtrend" : "range";

    if (e === null || a === null || kk === null || dd === null || i < startIndex) {
      if (i < startIndex && e !== null) r.reason[i] = "warmup (no position)";
      dir = 0; pending = 0;
      continue;
    }

    // ── ชั้นจังหวะ: เข้าโซนแล้ว "ติดอาวุธ" ไว้จนกว่า %K จะข้ามเส้นกลาง ──
    if (armed !== regime) { armed = 0; crossed = false; }
    if (regime === 1) {
      if (kk <= p.hfStochOversold) armed = 1;
      else if (kk >= p.hfStochMid) { armed = 0; crossed = false; }
      if (armed === 1) {
        if (crossOver(K, D, i)) crossed = true;
        else if (crossUnder(K, D, i)) crossed = false;
      }
    } else if (regime === -1) {
      if (kk >= p.hfStochOverbought) armed = -1;
      else if (kk <= p.hfStochMid) { armed = 0; crossed = false; }
      if (armed === -1) {
        if (crossUnder(K, D, i)) crossed = true;
        else if (crossOver(K, D, i)) crossed = false;
      }
    }

    // ── ไม้ที่สั่งเข้าเมื่อปิดแท่งก่อน เปิดจริงที่ราคาเปิดแท่งนี้ (ตรงกับ engine โหมด next_open) ──
    if (pending !== 0) {
      dir = pending; pending = 0; held = 0;
      entry = o[i]; risk = pendingRisk; oneR = entry * (risk / 100);
      stop = entry - dir * oneR;
      target = p.hfTargetR > 0 ? entry + dir * oneR * p.hfTargetR : null;
      best = entry; protectedStop = false;
    }

    let exited = false;
    if (dir !== 0) {
      held++;
      // ชน SL ก่อนเสมอถ้าแท่งเดียวแตะทั้งคู่ · เปิดแท่งกระโดดข้ามระดับ = ปิดที่ราคาเปิด
      let fill: number | null = null, why = "";
      const stopName = protectedStop ? (stop === entry ? "จุดคุ้มทุน" : "trailing stop") : "SL";
      if (dir * (o[i] - stop) <= 0) { fill = o[i]; why = `เปิดแท่งทะลุ ${stopName}`; }
      else if (dir * (dir === 1 ? l[i] - stop : h[i] - stop) <= 0) { fill = stop; why = `ชน ${stopName}`; }
      else if (target !== null && dir * (o[i] - target) >= 0) { fill = o[i]; why = "เปิดแท่งทะลุ TP"; }
      else if (target !== null && dir * (dir === 1 ? h[i] - target : l[i] - target) >= 0) { fill = target; why = "ถึง TP"; }

      if (fill !== null) {
        exitFill[i] = fill;
        const pnlR = (dir * (fill - entry)) / oneR;
        r.signal[i] = dir === 1 ? "SELL" : "COVER";
        r.reason[i] = `ออก (${why}) ที่ ${fmt(fill)} = ${pnlR >= 0 ? "+" : ""}${pnlR.toFixed(2)}R หลังถือ ${held} แท่ง`;
        dir = 0; exited = true;
      } else if (p.hfExitOnFlip >= 0.5 && regime === -dir) {
        // ปิดที่ราคาปิดแท่งนี้ → engine ลงมือที่ราคาเปิดแท่งถัดไป
        r.signal[i] = dir === 1 ? "SELL" : "COVER";
        r.reason[i] = `ออก (ชั้นทิศทางยืนยันฝั่ง${sideTh(-dir)} ${confirmN} แท่ง) หลังถือ ${held} แท่ง`;
        dir = 0; exited = true;
      } else {
        // อัปเดต SL ด้วยข้อมูลของแท่งที่ปิดแล้ว มีผลตั้งแต่แท่งถัดไป — ไม่ใช้ข้อมูลในอนาคต
        best = dir === 1 ? Math.max(best, h[i]) : Math.min(best, l[i]);
        const reachedBe = p.hfBreakevenR > 0 && dir * (best - entry) >= p.hfBreakevenR * oneR;
        if (reachedBe && dir * (entry - stop) > 0) { stop = entry; protectedStop = true; }
        if (p.hfTrailAtr > 0 && (p.hfBreakevenR <= 0 || protectedStop)) {
          const trail = best - dir * p.hfTrailAtr * a;
          if (dir * (trail - stop) > 0) { stop = trail; protectedStop = true; }
        }
        r.reason[i] = `ถือ${sideTh(dir)} ${held} แท่ง · SL ${fmt(stop)}${target !== null ? ` · TP ${fmt(target)}` : ""}`;
      }
    }

    // ── หาจุดเข้าใหม่ (ไม่เข้าในแท่งเดียวกับที่เพิ่งออก เพื่อให้สัญญาณสลับเปิด–ปิดเสมอ) ──
    if (dir === 0 && !exited) {
      const side = armed as 0 | 1 | -1;
      const allowed = side === 1 ? p.allowLong >= 0.5 : side === -1 ? p.allowShort >= 0.5 : false;
      const pa = side !== 0 ? priceAction(i, side, o, h, l, c, p.hfPinWickMult) : null;
      triggerDir[i] = pa ? side : 0;
      const slopeOk = slopeN <= 0 || (i - slopeN >= 0 && emaS[i - slopeN] !== null &&
        side * (e - (emaS[i - slopeN] as number)) > 0);
      const crossOk = p.hfRequireCross < 0.5 || crossed;

      if (regime === 0) r.reason[i] = `ว่าง: ชั้นทิศทางยังไม่เคยครบ ${confirmN} แท่ง`;
      else if (side === 0) {
        const zone = regime === 1 ? `oversold ≤ ${p.hfStochOversold}` : `overbought ≥ ${p.hfStochOverbought}`;
        r.reason[i] = `ว่าง: โฟกัส${sideTh(regime)} รอ Stoch ${zone} (%K ${kk.toFixed(1)})`;
      } else if (!allowed) r.reason[i] = `ว่าง: รหัสนี้ไม่เปิดฝั่ง${sideTh(side)}`;
      else if (!slopeOk) r.reason[i] = `ข้าม: EMA ยังไม่ชันไปฝั่ง${sideTh(side)} (${slopeN} แท่ง)`;
      else if (!crossOk) r.reason[i] = `รอ: Stoch อยู่ในโซนแล้ว รอ %K ตัด %D กลับทิศ`;
      else if (!pa) r.reason[i] = `รอ: Stoch พร้อมฝั่ง${sideTh(side)} รอแท่ง PA ยืนยัน (%K ${kk.toFixed(1)})`;
      else {
        const atrPct = (a / c[i]) * 100;
        const floor = p.hfMinStopCostMult * p.hfCostPct;
        const want = Math.max(p.hfStopAtr * atrPct, floor);
        pending = side; pendingRisk = want;
        armed = 0; crossed = false;
        r.signal[i] = side === 1 ? "BUY" : "SHORT";
        r.reason[i] = `${sideTh(side)}: ${pa} · Stoch %K ${kk.toFixed(1)} · SL ${want.toFixed(2)}%` +
          `${want === floor && floor > 0 ? " (พื้นต้นทุน)" : ""}` +
          `${p.hfTargetR > 0 ? ` · TP ${p.hfTargetR}R` : " · ไม่มี TP ตายตัว"}`;
      }
    }

    // exposure ของแท่งนี้ = สถานะที่ต้องการหลังปิดแท่ง (engine next_open ลงมือแท่งถัดไป)
    const heldDir = dir !== 0 ? dir : pending;
    r.direction[i] = heldDir;
    r.exposure[i] = heldDir * size;
    if (heldDir !== 0) r.size[i] = size;
    // แท่งที่ออกก็ยังถือไม้อยู่ระหว่างแท่ง จึงบันทึกระดับที่มีผลในแท่งนั้นด้วย
    // (ไม่งั้นไม้ที่เปิดแล้วชน SL ในแท่งเดียวกันจะไม่มีระยะเสี่ยงให้คำนวณ R)
    if (dir !== 0 || exited) {
      stopS[i] = stop; targetS[i] = target; riskS[i] = risk; holdS[i] = held;
    }
  }
  return r;
}

// ══ 4) ตรวจพารามิเตอร์ ═════════════════════════════════════════
function validateHorizonFlow(p: Record<string, number>): string | null {
  if (!(p.hfStochOversold < p.hfStochMid && p.hfStochMid < p.hfStochOverbought))
    return "ต้องเป็น oversold < เส้นกลาง < overbought";
  if (p.hfStopAtr <= 0 && p.hfMinStopCostMult <= 0)
    return "ต้องมี SL: ตั้ง hfStopAtr หรือ hfMinStopCostMult มากกว่า 0";
  if (p.hfMinStopCostMult > 0 && p.hfCostPct <= 0)
    return "พื้นต้นทุนของ SL ต้องการ hfCostPct มากกว่า 0";
  if (p.hfTargetR <= 0 && p.hfTrailAtr <= 0 && p.hfExitOnFlip < 0.5)
    return "ไม่มีทางออกฝั่งกำไร: ตั้ง TP หรือ trailing stop หรือออกเมื่อกลับฝั่ง อย่างน้อยหนึ่งอย่าง";
  if (p.hfSizePct <= 0 || p.hfSizePct > 100) return "ขนาดไม้ต้องอยู่ระหว่าง 1–100%";
  return null;
}

// ══ 5) ทะเบียนกลยุทธ์ ══════════════════════════════════════════
export type V4StrategyId = "horizon_flow_v4" | "horizon_flow_v4_strict" | "horizon_flow_v4_trail";

export const HORIZON_FLOW_RULE_TH =
  "Horizon Flow (จากคลิป YouTube ช่อง Ball Goldricher). " +
  "ชั้นทิศทาง: เปลี่ยนเป็นฝั่งซื้อเมื่อ hfConfirmBars แท่งติดกันปิดเหนือ EMA(hfEmaPeriod) และทุกแท่งทำ high ใหม่เทียบแท่งก่อน " +
  "(ฝั่งขายกลับกันด้วย low) ถ้ายังไม่ครบฝั่งเดิมค้างอยู่แม้ราคาจะข้าม EMA แล้ว. " +
  "ชั้นจังหวะ: ฝั่งซื้อรอ Stoch %K ≤ hfStochOversold แล้วเข้าได้จนกว่า %K จะขึ้นถึง hfStochMid " +
  "(ฝั่งขายรอ ≥ hfStochOverbought แล้วเข้าได้จนกว่าจะลงถึง hfStochMid). " +
  "เข้าเมื่อปิดแท่ง Price Action ตามฝั่ง (แท่งกลืนกิน หรือ pin bar ที่ไส้ยาว ≥ ครึ่งแท่งและ ≥ hfPinWickMult เท่าของตัวแท่ง) " +
  "และเปิดไม้ที่ราคาเปิดแท่งถัดไป. " +
  "SL = ค่าที่กว้างกว่าระหว่าง hfStopAtr x ATR กับ hfMinStopCostMult x hfCostPct (แทน 500 จุดของทองคำในคลิป), " +
  "TP = hfTargetR เท่าของระยะ SL. ตรวจ SL/TP ด้วย high/low และปิดที่ราคานั้นจริง ถ้าแท่งเดียวแตะทั้งคู่นับ SL ก่อน. " +
  "ข้อจำกัด: ค่าธรรมเนียม crypto ทำให้ท่านี้เป็นไปไม่ได้บน 1m (ต้องชนะเกิน 100% ของไม้บน Spot) ใช้ 15m ขึ้นไป " +
  "และผล 12 ไม้ในคลิป (win 58%) เป็นตัวอย่างบนทองคำที่เล็กเกินกว่าจะใช้ยืนยันอะไรได้";

const SCOPE_V4 = {
  classic:
    "รหัสนี้คือกฎตามคลิปตรงตัว (baseline) เปิดทั้งสองฝั่ง SL 1.5 ATR TP 2R ออกด้วย SL/TP เท่านั้น",
  strict:
    "รหัสนี้ต่างจาก horizon_flow_v4 ที่จุดเข้าเท่านั้น: ต้องเห็น %K ตัด %D กลับทิศขณะอยู่ในโซน (hfRequireCross = 1), " +
    "EMA ต้องชันไปฝั่งเดียวกันเทียบ 10 แท่งก่อน (hfSlopeBars = 10) และ SL ต้องกว้างอย่างน้อย 5 เท่าของต้นทุน " +
    "(hfMinStopCostMult = 5 ตามบทเรียนของ TradePlan V3 ที่ stop แคบกว่าต้นทุนมากทำให้ win rate ที่ต้องได้เกิน 100%) " +
    "ใช้เทียบว่าการกรองจุดเข้าชดเชยค่าธรรมเนียมได้หรือไม่",
  trail:
    "รหัสนี้ต่างจาก horizon_flow_v4 ที่จุดออกเท่านั้น: ไม่มี TP ตายตัว (hfTargetR = 0) " +
    "เลื่อน SL มาที่ทุนเมื่อกำไรถึง 1R (hfBreakevenR = 1) จากนั้น trail ห่างจุดสุดขั้ว 2 ATR (hfTrailAtr = 2) " +
    "และออกเมื่อชั้นทิศทางยืนยันฝั่งตรงข้าม (hfExitOnFlip = 1) ใช้เทียบว่า TP 2R ตัดกำไรทิ้งหรือไม่",
} as const;

const HF_GROUP = "Horizon Flow (YouTube)";
/** เส้นที่วาดทับกราฟ = EMA 100 ของชั้นทิศทาง (อินดิเคเตอร์ v4 เก็บอยู่ใต้คีย์ v3 ร่วมกับตระกูล v3) */
const HF_OVERLAY = "v3.trendEMA";
const HF_DIRECTION = { allowLong: 1, allowShort: 1 };

function hfDefaults(overrides: Partial<HorizonFlowV4Params> = {}): Record<string, number> {
  const { allowLong: _l, allowShort: _s, ...rest } = HORIZON_FLOW_V4_DEFAULTS;
  return { ...rest, ...overrides };
}
/** EMA ต้องการราว 3 เท่าของ period จึงนิ่ง + Stoch + ห่วงโซ่ยืนยัน */
const hfWarmup = (p: Record<string, number>) =>
  Math.max(300, Math.ceil(3 * (p.hfEmaPeriod ?? 100)) + (p.hfStochLength ?? 14) + (p.hfConfirmBars ?? 3) + 5);
const hfCompute: V3Definition["compute"] = (k, params, startIndex) => horizonFlowV4(k, params, startIndex);

export const V4_REGISTRY: Record<V4StrategyId, V3Definition> = {
  horizon_flow_v4: {
    name: "Horizon Flow V4 (ตามคลิป)",
    th: "ท่าเทรดจากคลิป YouTube: EMA100 กรองฝั่ง + ต้องไล่ high/low ใหม่ 3 แท่งจึงเปลี่ยนฝั่ง + Stochastic อยู่ในโซน + แท่ง PA ยืนยัน · SL 1.5 ATR TP 2R ปิดที่ราคา SL/TP จริง · สองทาง ใช้ 15m ขึ้นไปเพราะบน 1m ค่าธรรมเนียมใหญ่กว่า SL",
    en: "Horizon Flow from a YouTube clip: EMA100 side filter, 3-bar higher-high/lower-low confirmation to switch side, Stochastic zone, price-action trigger; SL 1.5 ATR, TP 2R filled at the level. Two-way; use 15m+ since fees exceed the stop on 1m",
    group: HF_GROUP,
    overlay: HF_OVERLAY,
    direction: HF_DIRECTION,
    defaults: hfDefaults(),
    compute: hfCompute,
    warmupBars: hfWarmup,
    validate: validateHorizonFlow,
    rule: `${HORIZON_FLOW_RULE_TH}. ${SCOPE_V4.classic}`,
  },
  horizon_flow_v4_strict: {
    name: "Horizon Flow V4 (กรองจุดเข้า)",
    th: "เหมือนตัวตามคลิปทุกข้อ ต่างที่จุดเข้า: ต้องเห็น %K ตัด %D กลับทิศในโซน, EMA100 ต้องชันไปฝั่งเดียวกัน และ SL ต้องกว้างอย่างน้อย 5 เท่าของต้นทุน เพื่อตัดไม้ที่ค่าธรรมเนียมกินหมด",
    en: "Same as the clip version except entries: requires a %K/%D turn inside the zone, an EMA100 slope in the trade direction, and a stop at least 5x round-trip cost",
    group: HF_GROUP,
    overlay: HF_OVERLAY,
    direction: HF_DIRECTION,
    defaults: hfDefaults({ hfRequireCross: 1, hfSlopeBars: 10, hfMinStopCostMult: 5 }),
    compute: hfCompute,
    warmupBars: hfWarmup,
    validate: validateHorizonFlow,
    rule: `${HORIZON_FLOW_RULE_TH}. ${SCOPE_V4.strict}`,
  },
  horizon_flow_v4_trail: {
    name: "Horizon Flow V4 (trailing exit)",
    th: "เข้าเหมือนตัวตามคลิปทุกข้อ ต่างที่จุดออก: ไม่มี TP ตายตัว เลื่อน SL มาที่ทุนเมื่อกำไร 1R แล้ว trail 2 ATR และออกเมื่อชั้นทิศทางยืนยันฝั่งตรงข้าม",
    en: "Same entries as the clip version; exits differ: no fixed TP, stop to breakeven at +1R, then a 2-ATR trailing stop, and exit when the side filter confirms the opposite side",
    group: HF_GROUP,
    overlay: HF_OVERLAY,
    direction: HF_DIRECTION,
    defaults: hfDefaults({ hfTargetR: 0, hfBreakevenR: 1, hfTrailAtr: 2, hfExitOnFlip: 1 }),
    compute: hfCompute,
    warmupBars: hfWarmup,
    validate: validateHorizonFlow,
    rule: `${HORIZON_FLOW_RULE_TH}. ${SCOPE_V4.trail}`,
  },
};

export const V4_STRATEGY_IDS = Object.keys(V4_REGISTRY) as V4StrategyId[];
const V4_ID_SET = new Set<string>(V4_STRATEGY_IDS);
export function isV4StrategyId(id: string): id is V4StrategyId {
  return V4_ID_SET.has(id);
}

/** ป้ายและขอบเขตของพารามิเตอร์ (รูปแบบเดียวกับ V3ParamMeta) */
const bars = (label: string, min: number, max: number) => ({ label, min, max, step: 1, integer: true });
const num = (label: string, min: number, max: number, step: number) => ({ label, min, max, step, integer: false });

export const V4_PARAM_META: Record<string, { label: string; min: number; max: number; step: number; integer: boolean }> = {
  hfEmaPeriod: bars("EMA กรองเทรนด์ (คลิป = 100)", 10, 400),
  hfConfirmBars: bars("ต้องไล่ high/low ใหม่ติดกันกี่แท่งจึงเปลี่ยนฝั่ง (คลิป = 3)", 1, 10),
  hfSlopeBars: bars("EMA ต้องชันเทียบกี่แท่งก่อน (0 = ปิด)", 0, 200),
  hfStochLength: bars("Stochastic: ช่วง %K", 2, 100),
  hfStochSmoothK: bars("Stochastic: ทำให้เรียบ %K", 1, 20),
  hfStochSmoothD: bars("Stochastic: ช่วง %D", 1, 20),
  hfStochOversold: num("Stochastic: เขต oversold", 1, 49, 1),
  hfStochOverbought: num("Stochastic: เขต overbought", 51, 99, 1),
  hfStochMid: num("Stochastic: เส้นกลางที่ยังเข้าได้ (คลิป = 50)", 10, 90, 1),
  hfRequireCross: bars("ต้องเห็น %K ตัด %D กลับทิศ (0 = ไม่, 1 = ใช่)", 0, 1),
  hfPinWickMult: num("Pin bar: ไส้ยาวกี่เท่าของตัวแท่ง", 0.5, 10, 0.1),
  hfAtrPeriod: bars("ช่วง ATR", 2, 100),
  hfStopAtr: num("SL เป็นกี่เท่าของ ATR", 0, 10, 0.1),
  hfTargetR: num("TP เป็นกี่ R (0 = ไม่มี TP ตายตัว)", 0, 10, 0.1),
  hfCostPct: num("ต้นทุนไป–กลับ (%) ใช้คิดพื้น SL", 0, 2, 0.01),
  hfMinStopCostMult: num("SL ต้องกว้างอย่างน้อยกี่เท่าของต้นทุน (0 = ปิด)", 0, 20, 0.5),
  hfBreakevenR: num("เลื่อน SL มาที่ทุนเมื่อกำไรกี่ R (0 = ปิด)", 0, 10, 0.1),
  hfTrailAtr: num("Trailing stop ห่างกี่ ATR (0 = ปิด)", 0, 10, 0.1),
  hfExitOnFlip: bars("ออกเมื่อชั้นทิศทางกลับฝั่ง (0 = ไม่, 1 = ใช่)", 0, 1),
  hfSizePct: num("ขนาดไม้ (% ของพอร์ต)", 1, 100, 1),
};
