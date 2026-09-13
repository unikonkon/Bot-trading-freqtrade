export interface KlineData {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseVolume: string;
  takerBuyQuoteVolume: string;
}

export type BinanceKlineRaw = [
  number,  // [0] Open time
  string,  // [1] Open price
  string,  // [2] High price
  string,  // [3] Low price
  string,  // [4] Close price
  string,  // [5] Volume
  number,  // [6] Close time
  string,  // [7] Quote asset volume
  number,  // [8] Number of trades
  string,  // [9] Taker buy base asset volume
  string,  // [10] Taker buy quote asset volume
];

export const INTERVALS = [
  "1s", "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
] as const;

export type Interval = (typeof INTERVALS)[number];

export const INDICATOR_REQUIREMENTS: Record<string, { minBars: number; fields: string[] }> = {
  "RSI(14)": { minBars: 15, fields: ["Close"] },
  "ATR(14)": { minBars: 15, fields: ["High", "Low", "Close"] },
  "OBV": { minBars: 1, fields: ["Close", "Volume"] },
  "VWAP": { minBars: 1, fields: ["High", "Low", "Close", "Volume", "QuoteVol"] },
  "CDC ActionZone": { minBars: 27, fields: ["Close"] },
  "SMC": { minBars: 100, fields: ["Open", "High", "Low", "Close"] },
  "CM MacD Ult MTF": { minBars: 35, fields: ["Close"] },
  "Supertrend": { minBars: 15, fields: ["High", "Low", "Close"] },
};

export function parseKline(raw: BinanceKlineRaw): KlineData {
  return {
    openTime: raw[0],
    open: raw[1],
    high: raw[2],
    low: raw[3],
    close: raw[4],
    volume: raw[5],
    closeTime: raw[6],
    quoteAssetVolume: raw[7],
    numberOfTrades: raw[8],
    takerBuyBaseVolume: raw[9],
    takerBuyQuoteVolume: raw[10],
  };
}
