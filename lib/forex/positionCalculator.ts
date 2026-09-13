// lib/forex/positionCalculator.ts

export interface ForexPair {
    symbol: string;        // "EUR/USD"
    bid: number;           // 1.08450
    ask: number;           // 1.08460
    pipSize: number;       // 0.0001 (JPY pairs = 0.01)
    quoteCurrency: string; // "USD"
    baseCurrency: string;  // "EUR"
  }
  
  export interface PositionInput {
    accountBalance: number;    // USD
    riskPercent: number;       // 1.0 = 1%
    stopLossPips: number;      // จำนวน pip ที่ยอม SL
    takeProfitPips?: number;   // optional
    leverage: number;          // 100 = 1:100
    pair: ForexPair;
    usdQuoteRate?: number;     // ใช้เมื่อ quote ไม่ใช่ USD เช่น EUR/GBP ต้องรู้ GBP/USD
  }
  
  export interface PositionResult {
    // --- Lot & Units ---
    lotSize: number;            // 0.23
    units: number;              // 23,000
    lotType: string;            // "Mini"
  
    // --- Risk ---
    riskAmount: number;         // $100
    pipValue: number;           // per standard lot in USD
    pipValueForLot: number;     // pip value × lot size
  
    // --- Margin ---
    marginRequired: number;     // USD ที่ต้องใช้ค้ำ
    marginPercent: number;      // % ของ balance
  
    // --- Spread ---
    spreadPips: number;         // ask - bid / pipSize
    spreadCost: number;         // USD ต้นทุน spread
  
    // --- TP/SL Levels ---
    stopLossAmount: number;     // USD เสีย
    takeProfitAmount?: number;  // USD ได้
    riskRewardRatio?: number;   // 1:2.5
  
    // --- Swap (daily estimate) ---
    swapEstimateLong?: number;  // ต้องรับจาก broker
  }
  
  export function calculatePosition(input: PositionInput): PositionResult {
    const { accountBalance, riskPercent, stopLossPips, takeProfitPips, leverage, pair } = input;
  
    // ── 1. Risk Amount ──────────────────────────────────────
    const riskAmount = accountBalance * (riskPercent / 100);
  
    // ── 2. Pip Value (per Standard Lot = 100,000 units) ─────
    // ถ้า USD เป็น quote (EUR/USD, GBP/USD) → pip value = 0.0001 × 100,000 = $10
    // ถ้า USD เป็น base (USD/JPY) → pip value = 0.01 × 100,000 / currentPrice
    // ถ้า cross pair → pip value ต้องแปลง quote currency → USD
    let pipValuePerStandardLot: number;
  
    if (pair.quoteCurrency === "USD") {
      pipValuePerStandardLot = pair.pipSize * 100_000; // = $10 for 4-decimal pairs
    } else if (pair.baseCurrency === "USD") {
      // USD/JPY: pip = 0.01, price ~156.00
      pipValuePerStandardLot = (pair.pipSize * 100_000) / pair.bid;
    } else {
      // Cross pair: EUR/GBP → pip value in GBP → แปลงเป็น USD ด้วย usdQuoteRate
      const usdRate = input.usdQuoteRate ?? 1;
      pipValuePerStandardLot = (pair.pipSize * 100_000) / pair.bid / usdRate;
    }
  
    // ── 3. Lot Size ──────────────────────────────────────────
    // lot = riskAmount / (SL_pips × pipValue_per_standard_lot)
    const rawLotSize = riskAmount / (stopLossPips * pipValuePerStandardLot);
    const lotSize = Math.floor(rawLotSize * 100) / 100; // round down to 0.01
    const units = Math.round(lotSize * 100_000);
  
    // ── 4. Lot Type Label ────────────────────────────────────
    const lotType =
      units >= 100_000 ? "Standard" :
      units >= 10_000  ? "Mini" :
      units >= 1_000   ? "Micro" : "Nano";
  
    // ── 5. Actual Pip Value for this lot ────────────────────
    const pipValueForLot = pipValuePerStandardLot * lotSize;
  
    // ── 6. Spread ────────────────────────────────────────────
    const spreadPips = (pair.ask - pair.bid) / pair.pipSize;
    const spreadCost = spreadPips * pipValueForLot;
  
    // ── 7. Margin Required ───────────────────────────────────
    // margin = (lot × 100,000 × price) / leverage
    const marginRequired = (lotSize * 100_000 * pair.ask) / leverage;
    const marginPercent = (marginRequired / accountBalance) * 100;
  
    // ── 8. SL / TP amounts ───────────────────────────────────
    const stopLossAmount = stopLossPips * pipValueForLot;
    const takeProfitAmount = takeProfitPips != null
      ? takeProfitPips * pipValueForLot
      : undefined;
    const riskRewardRatio = takeProfitAmount != null
      ? takeProfitAmount / stopLossAmount
      : undefined;
  
    return {
      lotSize,
      units,
      lotType,
      riskAmount,
      pipValue: pipValuePerStandardLot,
      pipValueForLot,
      marginRequired,
      marginPercent,
      spreadPips,
      spreadCost,
      stopLossAmount,
      takeProfitAmount,
      riskRewardRatio,
    };
  }