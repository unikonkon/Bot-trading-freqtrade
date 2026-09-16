import {
  computeStrategyIndicators,
  STRATEGY_FNS,
  type StrategyId,
} from "../../lib/backtest";
import { ema } from "../../lib/indicators";
import type { KlineData } from "../../lib/types/kline";
import { analyze } from "./engine";

export const RULES: Record<StrategyId, string> = {
  smc_adaptive: "Confirmed pivots เท่านั้น: BUY เมื่อ sweep ใต้ support แล้ว reclaim ใน discount พร้อม RSI ฟื้นและไม่ใช่ downtrend หรือเมื่อ bullish BOS/CHoCH ปิดเหนือ level + 0.1 ATR เป็นแท่งเขียว RSI < 75 และราคาเหนือ EMA ที่ไม่ลดลง; งดเข้าเมื่อ volatility shock/cooldown. SELL เมื่อ close <= stop, close >= target, bearish structure, RSI >= 70 สำหรับ reclaim หรือครบ maxHoldBars. ATR stop/target อ้างอิงราคาปิดแท่ง BUY; trailing stop เลื่อนขึ้นเท่านั้นเมื่อกำไร >= initial risk. ทุกทางออกเป็นสัญญาณ ณ ปิดแท่ง ไม่ใช่ stop order ระหว่างแท่ง; next_open fill ที่เปิดแท่งถัดไปจริงพร้อม fee/slippage. Reset สถานะว่างที่ startIndex. ดู reason/regime/stop/target รายแท่ง",
  rsi: "คำนวณ RSI ด้วย period: BUY เมื่อ RSI < buyThreshold; SELL เมื่อ RSI > sellThreshold; เท่ากับเกณฑ์หรือยังไม่มีค่าเป็น HOLD (เกิดซ้ำได้ทุกแท่ง ไม่ใช่เฉพาะจุดตัด)",
  cdc_actionzone:
    "EMA(close, fastPeriod/slowPeriod), smooth=1: BUY เมื่อเข้า green จากโซนอื่นและ trend แท่งก่อนเป็น bearish; SELL เมื่อเข้า red จากโซนอื่นและ trend ก่อนเป็น bullish. green = fastMA > slowMA และ close > fastMA; red = fastMA < slowMA และ close < fastMA. ตรวจ trend ก่อนอัปเดตสถานะ ไม่ใช้ null แทน bearish/bullish",
  smc: "ใช้ internalStructures: bullish CHoCH → BUY, bearish CHoCH → SELL โดยไม่บังคับ zone; bullish BOS ใน discount/equilibrium → BUY; bearish BOS ใน premium/equilibrium → SELL. ถ้ามีหลายเหตุการณ์ในแท่งเดียว การเขียนสัญญาณครั้งหลังใน loop เป็นผลสุดท้าย; confirmed pivots",
  cm_macd:
    "EMA(fastLength) − EMA(slowLength) เป็น MACD; signalLine ใช้ SMA(signalLength) ตาม implementation นี้. BUY เมื่อ MACD ก่อน < signalLine ก่อน และ MACD ปัจจุบัน >= signalLine ปัจจุบัน; SELL เมื่อก่อน >= และปัจจุบัน <. ต้องมีค่าทั้งสองแท่ง",
  supertrend:
    "คำนวณ ATR ตาม atrPeriod และแถบด้วย multiplier; เส้นอ้างอิงและการเลื่อนแถบดู supertrend() ใน lib/indicators.ts. BUY เมื่อ trend จาก -1 เป็น 1; SELL เมื่อ 1 เป็น -1; ทิศเดิมเป็น HOLD",
  squeeze_momentum:
    "คำนวณ BB/KC และ momentum ด้วย linear regression ตาม squeezeMomentum(). BUY เมื่อ momentum ก่อน <= 0 และปัจจุบัน > 0; SELL เมื่อก่อน >= 0 และปัจจุบัน < 0. โค้ดปัจจุบันไม่ได้บังคับ sqzOff ในเงื่อนไขส่งสัญญาณ",
  msb_ob:
    "Zigzag ใช้ zigzagLen: เมื่อเปลี่ยน trend ตรวจ swing h0,h1,l0,l1. Bullish MSB ต้อง market=-1 และ h0 > h1 + abs(h1-l0)*fibFactor; bearish MSB ต้อง market=1 และ l0 < l1 - abs(h0-l1)*fibFactor. ส่ง BUY/SELL เมื่อ market เปลี่ยนจริง. การพบ Order Block ไม่ใช่เงื่อนไขเพิ่มเติมในการส่ง signal",
  support_resistance:
    "Pivot confirmed → carry forward support/resistance. Volume oscillator = 100*(EMA(volume,5)-EMA(volume,10))/EMA(volume,10). BUY: close ก่อน <= resistance ปัจจุบัน, close > resistance, osc > volumeThresh และไม่ใช่ bullWick ((open-low) > (close-open)). SELL: close ก่อน >= support ปัจจุบัน, close < support, osc > volumeThresh และไม่ใช่ bearWick ((open-close) < (high-open)). BUY ตรวจหลัง SELL ใน loop",
  trendlines:
    "Confirmed pivots สร้าง upper/lower และ slope จาก ATR ตาม trendLength/trendMult. BUY เมื่อสถานะ upos เปลี่ยน 0→1 (ไม่มี pivotHigh ใหม่และ close > upper); SELL เมื่อ dnos เปลี่ยน 0→1 (ไม่มี pivotLow ใหม่และ close < lower). สถานะ reset เมื่อมี pivot ใหม่. ถ้าทั้งสองเกิดพร้อมกัน SELL เขียนทับ BUY",
  ut_bot:
    "ATR trailing stop ใช้ keyValue * ATR(utAtrPeriod) และ close เป็น src. BUY เมื่อ close > stop ปัจจุบัน และ close ก่อน <= stop ก่อน; SELL เมื่อ close < stop ปัจจุบัน และ close ก่อน >= stop ก่อน. ไม่มีสัญญาณเมื่อยังไม่มีค่าเพียงพอ",
};
export const INDICATOR_KEY: Record<StrategyId, string> = {
  smc_adaptive: "smcAdaptive",
  rsi: "rsi",
  cdc_actionzone: "cdcActionZone",
  smc: "smc",
  cm_macd: "cmMacd",
  supertrend: "supertrend",
  squeeze_momentum: "squeezeMomentum",
  msb_ob: "msbOb",
  support_resistance: "supportResistance",
  trendlines: "trendlines",
  ut_bot: "utBot",
};
export type Cell = number | string | boolean | null;
export function columns(
  value: unknown,
  n: number,
  prefix: string,
): Record<string, Cell[]> {
  if (Array.isArray(value))
    return value.length === n &&
      value.every(
        (v) => v === null || ["number", "boolean", "string"].includes(typeof v),
      )
      ? { [prefix]: value }
      : {};
  if (value && typeof value === "object")
    return Object.assign(
      {},
      ...Object.entries(value).map(([key, v]) =>
        columns(v, n, `${prefix}.${key}`),
      ),
    );
  return {};
}
export function calculateExport(
  k: KlineData[],
  start: number,
  id: StrategyId,
  params: Record<string, number>,
  fee: number,
  slip: number,
  mode: string,
) {
  const all = computeStrategyIndicators(k, id, params, {
    confirmedPivots: true,
    startIndex: start,
  });
  const signals = STRATEGY_FNS[id](k, all, params);
  const key = INDICATOR_KEY[id];
  const indicator = all[key as keyof typeof all];
  const series = columns(indicator, k.length, key);
  if (id === "support_resistance") {
    const fast = ema(
        k.map((b) => +b.volume),
        5,
      ),
      slow = ema(
        k.map((b) => +b.volume),
        10,
      );
    series["supportResistance.volumeOscillator"] = fast.map((v, i) =>
      v !== null && slow[i] !== null && slow[i] !== 0
        ? (100 * (v - slow[i]!)) / slow[i]!
        : null,
    );
  }
  const records = k.slice(start).map((bar, offset) => {
    const index = start + offset;
    const current = Object.fromEntries(
      Object.entries(series).map(([name, values]) => [name, values[index]]),
    );
    const previous = Object.fromEntries(
      Object.entries(series).map(([name, values]) => [
        name,
        index ? values[index - 1] : null,
      ]),
    );
    const signal = signals[index];
    let reason =
      signal === "HOLD"
        ? "ไม่มีเงื่อนไขส่ง BUY/SELL หรือ indicator ยังไม่มีค่าเพียงพอ"
        : `${key}.signal = ${signal}; ตรวจค่าปัจจุบัน/ก่อนหน้าและเหตุการณ์ประกอบตาม rules.md`;
    if (id === "rsi") {
      const value = all.rsi[index];
      reason =
        value === null
          ? "RSI ยังไม่มีค่า → HOLD"
          : signal === "BUY"
            ? `RSI ${value} < buyThreshold ${params.buyThreshold ?? 30} → BUY`
            : signal === "SELL"
              ? `RSI ${value} > sellThreshold ${params.sellThreshold ?? 70} → SELL`
              : `RSI ${value} อยู่ระหว่างเกณฑ์ (รวมเท่ากับ) → HOLD`;
    }
    if (id === "smc_adaptive") reason = all.smcAdaptive.reason[index];
    const events =
      id === "smc_adaptive"
        ? all.smcAdaptive.structures.filter((e) => e.index === index)
        :
      id === "smc"
        ? all.smc.internalStructures.filter((e) => e.index === index)
        : id === "msb_ob"
          ? all.msbOb.msbSignals.filter((e) => e.index === index)
          : [];
    return {
      index,
      openTime: bar.openTime,
      closeTime: bar.closeTime,
      signalTime: bar.closeTime,
      signalTimeUtc: new Date(bar.closeTime).toISOString(),
      symbolPrice: bar.close,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      previousClose: index ? k[index - 1].close : null,
      signal,
      reason,
      current,
      previous,
      events,
    };
  });
  return {
    strategy: id,
    params,
    startIndex: start,
    rule: RULES[id],
    series,
    indicator,
    records,
    simulations: analyze(k, start, id, params, fee, slip, mode, true)
      .simulations,
  };
}
