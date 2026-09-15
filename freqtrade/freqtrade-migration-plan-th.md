# แผนงาน: ย้ายระบบเทรดทั้งหมดลง freqtrade (ทางเลือก B)

> เวอร์ชัน 1.0 — ก.ย. 2026
> โจทย์: นำ indicator 10 ตัวใน `lib/indicators.ts` และกฎสัญญาณใน `lib/backtest.ts` ไปพอร์ตลง Python เพื่อรันบน **freqtrade** ทั้ง backtest, dry-run และเทรดจริงบน Binance Spot จาก VPS ที่มี static IP
> ผลลัพธ์ที่ต้องได้: freqtrade เป็นระบบเดียวที่ตัดสินใจและยิงออเดอร์ · Next.js เหลือบทบาทแดชบอร์ดและเครื่องมือวิจัย
>
> เอกสารนี้ต่อยอดจาก [`trading-bot-system-design-th.md`](./trading-bot-system-design-th.md) (สถาปัตยกรรม VPS static IP) และแทนที่ส่วน executor ที่เคยวางแผนจะเขียนเองด้วย freqtrade

---

## 0. สถานะการทำ (อัปเดต 14 ก.ย. 2026)

| เฟส | สถานะ | หลักฐาน |
|---|---|---|
| 0 | ✅ ทำแล้ว (บนเครื่อง dev, ยังไม่ขึ้น VPS) | `freqtrade/docker-compose.yml`, image `freqtradeorg/freqtrade:stable` = 2026.8, `list-strategies` เห็นครบ 11 ตัว |
| 1 | ✅ ทำแล้ว | `freqtrade/scripts/dump-indicators.ts` + `freqtrade/user_data/scripts/compare_with_ts.py` |
| 2 | ✅ ทำแล้ว **ครบ 10 ตัว** | harness `--mode ts` PASS 31/31 คอลัมน์ ทั้ง BTC 1h และ ETH 4h (ค่าต่าง ~1e-11); ความต่างของ 3 ตัวที่แก้ lookahead บันทึกใน [`port-diff-notes.md`](./port-diff-notes.md) |
| 3 | ✅ ทำแล้ว | `BaseSignalStrategy` + subclass 10 ตัว, `config.1h.json` / `config.4h.json`, backtest ด้วย `pair_strategy_map` ได้ enter_tag ถูกต้อง |
| 4 | 🟡 ทำบนข้อมูล 120 วัน | backtest 7 ตัวรันผ่าน, lookahead-analysis = No bias (Supertrend, Trendlines, S/R, SMC), Supertrend BTC/USDT ได้ 31 trade เทียบ TS 32 trade; ผลใน [`backtest-results-202609.md`](./backtest-results-202609.md) — **ยังไม่ได้ทำ hyperopt และยังไม่ได้ใช้ข้อมูล 2 ปี** |
| 5 | 🟡 บางส่วน | เพิ่ม `api/freqtrade/route.ts` (proxy อ่านอย่างเดียว); การลบ route/cron ในโปรเจกต์ NextJS_UseBot_Crypto **ยังไม่ได้ทำ** รอตัดสินใจ |
| 6 | ⬜ ยังไม่เริ่ม | smoke test dry-run บนเครื่อง dev 45 วินาที เปิด trade จำลองได้ + API ตอบ; ยังไม่ได้ dry-run ต่อเนื่องบน VPS |

**อัปเดต 15 ก.ย. 2026:** เพิ่มบอทสัญญาณ TypeScript (`signal-bot/`) รันคู่ขนานบน VPS เพื่อแจ้งเตือนผ่าน Telegram โดย **ไม่ยิงออเดอร์** — freqtrade ยังเป็นระบบตัดสินใจเดียวตามหลักข้อ 3 · แผนช่วงเงินจริงและกฎการอยู่ร่วมกันอยู่ใน [`live-execution-plan-th.md`](../signal-bot/live-execution-plan-th.md) · คู่มือบอท TS อยู่ใน [`signal-bot-ts-runbook-th.md`](../signal-bot/README.md) · ฝั่ง TS แก้ lookahead ของ S/R, Trendlines, SMC แล้ว (harness `--mode live` PASS 31/31)

**สิ่งที่เปลี่ยนจากแผนเดิมระหว่างลงมือทำ**

- **ไม่ใช้ TA-Lib เลย** เขียน EMA/RSI/ATR ด้วย numpy loop ให้ตรง TS ทุกตำแหน่ง เพราะ `talib.ATR` seed จาก TR[1] ส่วน TS seed จาก TR[0]=high−low ทำให้ค่าไม่ตรงกันโดยเฉพาะ ATR ช่วงยาว (ผลพลอยได้: harness รันได้ด้วย numpy+pandas ล้วน)
- **S/R, Trendlines, SMC มีพารามิเตอร์ `confirmed`** — `False` = พฤติกรรม TS เดิม (ใช้พิสูจน์การพอร์ต), `True` = ยืนยัน pivot ที่ `i + rightBars` (ค่า default ใช้จริง)
- **freqtrade 2026.8 ไม่รับ `protections` ใน config** ต้องอยู่ใน strategy → `BaseSignalStrategy.protections` อ่านค่าจาก `config["strategy_protections"]`
- config ต้องมี `entry_pricing.price_side = "other"` และ `exit_pricing.price_side = "other"` เมื่อใช้ market order, และ `api_server.jwt_secret_key` ยาว ≥ 32 ตัวอักษร
- image ใช้ entrypoint `freqtrade` การรัน Python script ต้องใช้ `docker compose run --rm --entrypoint python freqtrade …`

---

## 1. เป้าหมายและขอบเขต (อ่านก่อน)

**ทำไมต้องย้าย:** ของที่มีตอนนี้ครบเฉพาะฝั่ง "หาสัญญาณ" ส่วนที่ทำให้เงินจริงปลอดภัย เช่น stop-loss 24 ชม., กู้ position หลังรีสตาร์ท, กันยิงซ้ำ, ปัด LOT_SIZE, kill-switch, dry-run ยังไม่มี freqtrade ให้ทั้งหมดนี้และผ่านการใช้งานจริงมาหลายปี

**หลักการ 3 ข้อที่ห้ามละเมิดตลอดโครงการ**

1. **พิสูจน์ก่อนเชื่อ** — indicator ทุกตัวที่พอร์ตต้องผ่าน harness เทียบค่ากับ TypeScript บนข้อมูลชุดเดียวกัน (เฟส 1)
2. **ไม่มี lookahead** — ทุก strategy ต้องผ่าน `lookahead-analysis` ก่อนเปิด dry-run และห้ามเอาตัวที่ไม่ผ่านไป live
3. **ระบบตัดสินใจมีระบบเดียว** — เมื่อ freqtrade ทำงานแล้ว ต้องถอด executor และ cron ฝั่ง Next.js ออก ไม่ให้สองระบบสั่งซื้อขายสวนกัน

**อยู่ในขอบเขต:** พอร์ต 10 indicator, strategy บน freqtrade, backtest/hyperopt, dry-run, live Spot, แจ้งเตือน Discord/Telegram, ปรับ Next.js ให้เป็นแดชบอร์ด
**นอกขอบเขต:** Futures/short (ทำได้ภายหลังด้วย `trading_mode: futures`), FreqAI, Binance TH (ccxt ไม่รองรับ)

---

## 2. สถาปัตยกรรมหลังย้าย

```
                  ┌──────────────────────────────────────────────┐
                  │           Binance (api.binance.com)           │
                  └───────────▲──────────────────────▲───────────┘
                  klines (public)                signed orders
                              │                      │ (IP whitelist = VPS)
   ┌──────────────────────────┴──────────────────────┴──────────────────────┐
   │                      VPS ไทย — static IP (Docker Compose)               │
   │                                                                         │
   │   ft-1h  (freqtrade)          ft-4h  (freqtrade)                         │
   │   ├─ BaseSignalStrategy       ├─ BaseSignalStrategy                      │
   │   │   └─ ta_port/ (indicators.py, signals.py)  ← พอร์ตจาก TS            │
   │   ├─ tradesv3-1h.sqlite       ├─ tradesv3-4h.sqlite                      │
   │   └─ REST API :8080 (localhost) └─ REST API :8081 (localhost)            │
   │                                                                         │
   │   Telegram bot (สั่ง /stop /status /forceexit)   Discord webhook (แจ้งเตือน) │
   └──────────────────────────────────▲──────────────────────────────────────┘
                                      │ HTTPS + token (ผ่าน reverse proxy หรือ SSH tunnel)
                     ┌────────────────┴────────────────┐
                     │  Next.js (Vercel) — Dashboard    │
                     │  - หน้า Klines / backtest วิจัย   │
                     │  - หน้า LiveTrading อ่านจาก REST │
                     │  - ไม่ยิงออเดอร์ ไม่ถือ API key   │
                     └─────────────────────────────────┘
```

ข้อจำกัดของ freqtrade ที่กำหนดรูปแบบนี้: **หนึ่ง instance = หนึ่ง strategy + หนึ่ง timeframe หลัก** และ **หนึ่งคู่มี trade เปิดได้หนึ่งรายการต่อ instance** ดังนั้นแยก instance ตาม timeframe และให้ strategy แม่ตัวเดียวเลือกกฎสัญญาณต่อคู่จาก config (ดูข้อ 7)

---

## 3. แผนงานรวม

| เฟส | งาน | ผลลัพธ์ที่ต้องได้ | เวลาโดยประมาณ |
|---|---|---|---|
| 0 | เตรียม VPS + freqtrade + Docker | freqtrade รัน SampleStrategy แบบ dry-run ได้ | 1 วัน |
| 1 | Harness เทียบผล TS ↔ Python | script รันแล้วรายงาน ตรง/ไม่ตรง ต่อคอลัมน์ | 1–2 วัน |
| 2 | พอร์ต indicators + signals ลง Python | `ta_port/` ครบ 10 ตัว ผ่าน harness | 7–9 วัน |
| 3 | Strategy บน freqtrade + config หลาย instance | `list-strategies` เห็นครบ, backtest รันได้ | 2 วัน |
| 4 | Backtest, lookahead, recursive, hyperopt | ตารางผล 10 strategy พร้อมค่า SL/ROI | 2–3 วัน |
| 5 | ปรับ Next.js | ถอด executor/cron, หน้า LiveTrading อ่านจาก freqtrade | 2–3 วัน |
| 6 | Dry-run → Live | dry-run 2–4 สัปดาห์ แล้ว live ทุนน้อย | 1–2 วัน + รอ |

รวมงานลงมือทำประมาณ **3–4 สัปดาห์** สำหรับผู้พัฒนาหนึ่งคน ไม่รวมช่วงรอ dry-run

**งานที่ต้องทำก่อนเริ่มเฟส 0 (ด่วน):** reset token ของ Discord bot ใน Developer Portal และลบค่าจริงออกจาก `.env.example` เพราะไฟล์นี้ถูก commit ลง git

---

## 4. เฟส 0: เตรียม VPS และ freqtrade

**สเปก:** VPS ไทย 2 vCPU / 4 GB RAM / 40 GB NVMe + dedicated IPv4 (ผู้ให้บริการตามเอกสารเดิม) ติดตั้ง Docker + Docker Compose

```bash
mkdir -p ~/ft && cd ~/ft
curl https://raw.githubusercontent.com/freqtrade/freqtrade/stable/docker-compose.yml -o docker-compose.yml
docker compose pull
docker compose run --rm freqtrade create-userdir --userdir user_data
docker compose run --rm freqtrade new-config --config user_data/config.json
# ทดสอบว่า image ใช้งานได้
docker compose run --rm freqtrade list-strategies
docker compose up -d && docker compose logs -f
```

**ค่าใน `user_data/config.json` ที่ต้องตั้งตั้งแต่เฟสนี้**

```json
{
  "dry_run": true,
  "dry_run_wallet": 1000,
  "stake_currency": "USDT",
  "stake_amount": 50,
  "max_open_trades": 3,
  "timeframe": "1h",
  "exchange": {
    "name": "binance",
    "key": "",
    "secret": "",
    "pair_whitelist": ["BTC/USDT", "ETH/USDT"],
    "pair_blacklist": ["BNB/.*"]
  },
  "api_server": {
    "enabled": true,
    "listen_ip_address": "127.0.0.1",
    "listen_port": 8080,
    "username": "ft",
    "password": "<เปลี่ยน>",
    "jwt_secret_key": "<สุ่มยาว>"
  },
  "telegram": { "enabled": false, "token": "", "chat_id": "" },
  "discord": { "enabled": false, "webhook_url": "" }
}
```

**เกณฑ์ผ่านเฟส 0:** `docker compose logs` เห็น SampleStrategy วิเคราะห์คู่ใน whitelist ทุก ~5 วินาที และเปิด FreqUI ที่ `localhost:8080` ผ่าน SSH tunnel ได้

---

## 5. เฟส 1: Harness เทียบผล TypeScript กับ Python

ทำก่อนพอร์ต indicator ตัวแรก เพราะเป็นเครื่องมือเดียวที่บอกได้ว่า "ผลต่างเพราะพอร์ตผิด" หรือ "ต่างเพราะตรรกะเปลี่ยน"

### 5.1 ข้อมูลทดสอบ

```bash
# ดึงชุดเดียวเก็บเป็นไฟล์ ใช้ซ้ำทุกครั้ง ห้ามดึงใหม่ระหว่างเทียบ
curl "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000" > fixtures/BTCUSDT-1h.json
curl "https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=4h&limit=1000" > fixtures/ETHUSDT-4h.json
```

### 5.2 ฝั่ง TypeScript: dump ทุกคอลัมน์ออก CSV

สร้าง `freqtrade/scripts/dump-indicators.ts` ในโปรเจกต์ Next.js รันด้วย `npx tsx`

```ts
import fs from "node:fs";
import { parseKline, type BinanceKlineRaw } from "@/lib/types/kline";
import { computeAll } from "@/lib/indicators";
import { runBacktest, STRATEGIES } from "@/lib/backtest";

const [, , file, out] = process.argv;
const raw = JSON.parse(fs.readFileSync(file, "utf8")) as BinanceKlineRaw[];
const klines = raw.map(parseKline);
const ind = computeAll(klines);

const cols: Record<string, (number | string | null | boolean)[]> = {
  openTime: klines.map(k => k.openTime),
  rsi: ind.rsi, atr: ind.atr,
  cdc_fast: ind.cdcActionZone.fastMA, cdc_slow: ind.cdcActionZone.slowMA, cdc_zone: ind.cdcActionZone.zone,
  macd: ind.cmMacd.macdLine, macd_signal: ind.cmMacd.signalLine, macd_hist: ind.cmMacd.histogram,
  st_line: ind.supertrend.supertrend, st_trend: ind.supertrend.trend,
  sqz_val: ind.squeezeMomentum.value, sqz_on: ind.squeezeMomentum.sqzOn,
  ut_stop: ind.utBot.trailingStop, ut_pos: ind.utBot.pos,
  msb_market: ind.msbOb.market,
  sr_res: ind.supportResistance.resistance, sr_sup: ind.supportResistance.support,
  tl_upper: ind.trendlines.upper, tl_lower: ind.trendlines.lower,
  smc_internal_trend: ind.smc.internalTrend, smc_pd: ind.smc.premiumDiscount,
};
for (const s of STRATEGIES) cols[`sig_${s.id}`] = runBacktest(klines, s.id).signals;

const keys = Object.keys(cols);
const lines = [keys.join(",")];
for (let i = 0; i < klines.length; i++) lines.push(keys.map(k => cols[k][i] ?? "").join(","));
fs.writeFileSync(out, lines.join("\n"));
```

```bash
npx tsx freqtrade/scripts/dump-indicators.ts fixtures/BTCUSDT-1h.json fixtures/BTCUSDT-1h.ts.csv
```

### 5.3 ฝั่ง Python: คำนวณแล้วเทียบ

`user_data/scripts/compare_with_ts.py`

```python
import sys, json, numpy as np, pandas as pd
from ta_port import indicators as ti, signals as ts_sig

fixture, ts_csv = sys.argv[1], sys.argv[2]
raw = json.load(open(fixture))
df = pd.DataFrame(raw).iloc[:, :6]
df.columns = ["date", "open", "high", "low", "close", "volume"]
df["date"] = pd.to_datetime(df["date"], unit="ms", utc=True)
df[["open", "high", "low", "close", "volume"]] = df[["open", "high", "low", "close", "volume"]].astype(float)

py = ti.compute_all(df)                 # คืน DataFrame คอลัมน์ชื่อเดียวกับ CSV ฝั่ง TS
ts = pd.read_csv(ts_csv)

WARMUP = 300                            # ข้ามช่วง warm-up ที่ค่าไม่นิ่ง
report = []
for col in ts.columns:
    if col == "openTime" or col not in py.columns:
        continue
    a, b = ts[col].iloc[WARMUP:], py[col].iloc[WARMUP:]
    if a.dtype.kind in "fi":
        ok = np.allclose(a.fillna(-1e18), b.fillna(-1e18), rtol=1e-6, atol=1e-8)
        diff = float(np.nanmax(np.abs(a - b)))
    else:
        ok = (a.fillna("").astype(str) == b.fillna("").astype(str)).all()
        diff = int((a.fillna("").astype(str) != b.fillna("").astype(str)).sum())
    report.append((col, "OK " if ok else "DIFF", diff))

for col, status, diff in report:
    print(f"{status} {col:<22} max_diff={diff}")
sys.exit(0 if all(r[1] == "OK " for r in report) else 1)
```

```bash
docker compose run --rm -v $PWD/fixtures:/fixtures freqtrade \
  python user_data/scripts/compare_with_ts.py /fixtures/BTCUSDT-1h.json /fixtures/BTCUSDT-1h.ts.csv
```

**เกณฑ์ผ่านเฟส 1:** script รันจบและรายงานได้ (ตอนนี้จะ DIFF ทุกคอลัมน์ เพราะยังไม่พอร์ต) และคอลัมน์ `sig_*` ถูกเทียบแบบต่อแท่ง

---

## 6. เฟส 2: พอร์ต indicators และ signals

### 6.1 กติกาการพอร์ต

- ไฟล์ `user_data/strategies/ta_port/indicators.py` ใช้ **ชื่อฟังก์ชันและพารามิเตอร์เดียวกับ TS** เพื่อให้ตามโค้ดสองฝั่งได้
- **ไม่ใช้ TA-Lib** (เปลี่ยนจากแผนเดิม) เขียน EMA/RSI/ATR เป็น numpy loop ตาม TS: EMA seed ด้วย SMA, RSI/ATR แบบ Wilder, ATR seed จาก TR[0]=high−low ซึ่ง `talib.ATR` ทำต่างออกไป **ห้ามใช้** `pandas.ewm` เพราะ seed ต่างกัน
- CM MACD: signal line ของ TS เป็น **SMA** ของ MACD ไม่ใช่ EMA (`talib.MACD` ใช้ EMA จึงใช้ไม่ได้)
- indicator ที่มีสถานะข้ามแท่ง (Supertrend, UT Bot, MSB, Trendlines, SMC) เขียนเป็น loop บน `numpy` array คัดลอกตรรกะจาก TS บรรทัดต่อบรรทัด ถ้าช้าค่อยใส่ `@numba.njit`
- **pivot ที่ต้องมองไปข้างหน้า** (`detectPivots`, S/R, Trendlines) ให้ยืนยันที่แท่ง `i + rightBars` เสมอ ห้ามเขียนค่าที่แท่ง `i`
- ทุกฟังก์ชันคืน `pd.Series` ยาวเท่า dataframe โดยช่วง warm-up เป็น `NaN`

### 6.2 ลำดับและวิธีพอร์ตรายตัว

| ลำดับ | Indicator | วิธี | ความยาก | ผลเทียบ TS ที่คาดหวัง |
|---|---|---|---|---|
| 1 | Supertrend | loop numpy (ATR แบบ Wilder + band adjust) | กลาง | ตรง 100% |
| 2 | CDC ActionZone | `talib.EMA` 12/26 + zone vector + trend ffill | ง่าย | ตรง 100% |
| 3 | UT Bot | loop numpy | กลาง | ตรง 100% |
| 4 | CM MACD | EMA12−EMA26, `rolling(9).mean()`, cross ด้วย `shift(1)` | ง่าย | ตรง 100% |
| 5 | RSI | `talib.RSI` | ง่าย | ตรง 100% |
| 6 | Squeeze Momentum | `talib.STDDEV(nbdev=1)`, `talib.LINEARREG`, rolling max/min | ง่าย | ตรง 100% |
| 7 | MSB-OB | loop numpy + list swing point | กลาง–ยาก | ตรง 100% (ตรรกะ causal อยู่แล้ว) |
| 8 | Support/Resistance | pivot ยืนยันที่ `i+rightBars` แล้ว ffill | กลาง | **ต่างโดยตั้งใจ** level โผล่ช้าลง 15 แท่ง สัญญาณส่วนใหญ่คงเดิม |
| 9 | Trendlines | เริ่มเส้นที่แท่งยืนยัน ตาม Pine | กลาง | **ต่างโดยตั้งใจ** ผล backtest จะแย่ลงจาก TS เพราะของเดิมมี lookahead |
| 10 | SMC | เขียนใหม่เฉพาะ internal structure + premium/discount ด้วย pivot ยืนยันแล้ว ตัด OB/FVG/swing label ออก | ยากที่สุด | **ต่างโดยตั้งใจ** premium/discount ใน TS reset ที่แท่ง pivot ซึ่งยังไม่รู้ในเวลาจริง |

หยุดพักหลังตัวที่ 7 แล้วข้ามไปทำเฟส 3–4 กับ 7 ตัวนี้ก่อนได้ ตัวที่ 8–10 เป็นงานแยกที่ผลเปลี่ยนแน่นอน ไม่ควรให้ถ่วงตัวอื่น

### 6.3 ตัวอย่างโครง `indicators.py` (Supertrend และ CDC)

> โค้ดจริงที่ผ่าน harness แล้วอยู่ที่ `freqtrade/user_data/strategies/ta_port/indicators.py` (ไม่ใช้ talib — ดูข้อ 0) ด้านล่างเป็นโครงร่างตอนวางแผน

```python
import numpy as np, pandas as pd, talib

def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    return pd.Series(talib.ATR(df["high"], df["low"], df["close"], timeperiod=period), index=df.index)

def supertrend(df: pd.DataFrame, atr_period: int = 10, multiplier: float = 3.0) -> pd.DataFrame:
    h, l, c = df["high"].values, df["low"].values, df["close"].values
    a = atr(df, atr_period).values
    n = len(df)
    line = np.full(n, np.nan); trend = np.zeros(n); sig = np.zeros(n)
    prev_up, prev_dn, prev_trend = 0.0, np.inf, 1
    for i in range(n):
        if np.isnan(a[i]):
            continue
        src = (h[i] + l[i]) / 2
        up, dn = src - multiplier * a[i], src + multiplier * a[i]
        if i > 0 and c[i - 1] > prev_up: up = max(up, prev_up)
        if i > 0 and c[i - 1] < prev_dn: dn = min(dn, prev_dn)
        t = prev_trend
        if prev_trend == -1 and c[i] > prev_dn: t = 1
        elif prev_trend == 1 and c[i] < prev_up: t = -1
        line[i] = up if t == 1 else dn
        trend[i] = t
        sig[i] = 1 if (t == 1 and prev_trend == -1) else (-1 if (t == -1 and prev_trend == 1) else 0)
        prev_up, prev_dn, prev_trend = up, dn, t
    return pd.DataFrame({"st_line": line, "st_trend": trend, "st_signal": sig}, index=df.index)

def cdc_action_zone(df: pd.DataFrame, fast: int = 12, slow: int = 26) -> pd.DataFrame:
    p = df["close"]
    f = pd.Series(talib.EMA(p, fast), index=df.index)
    s = pd.Series(talib.EMA(p, slow), index=df.index)
    bull, bear = f > s, f < s
    zone = pd.Series(None, index=df.index, dtype="object")
    zone[bull & (p > f)] = "green"
    zone[bear & (p > f) & (p > s)] = "blue"
    zone[bear & (p > f) & (p < s)] = "lightblue"
    zone[bear & (p < f)] = "red"
    zone[bull & (p < f) & (p < s)] = "orange"
    zone[bull & (p < f) & (p > s)] = "yellow"
    buy_cond = (zone == "green") & (zone.shift(1) != "green")
    sell_cond = (zone == "red") & (zone.shift(1) != "red")
    # trend: bullish ถ้า buy_cond ล่าสุดใหม่กว่า sell_cond ล่าสุด (เทียบ lastBuyBar/lastSellBar ใน TS)
    last_buy = pd.Series(np.where(buy_cond, np.arange(len(df)), np.nan), index=df.index).ffill()
    last_sell = pd.Series(np.where(sell_cond, np.arange(len(df)), np.nan), index=df.index).ffill()
    trend = pd.Series(np.where(last_buy > last_sell, "bullish", np.where(last_sell > last_buy, "bearish", None)), index=df.index)
    prev_trend = trend.shift(1)
    sig = pd.Series(0, index=df.index)
    sig[buy_cond & (prev_trend == "bearish")] = 1
    sig[sell_cond & (prev_trend == "bullish")] = -1
    return pd.DataFrame({"cdc_fast": f, "cdc_slow": s, "cdc_zone": zone, "cdc_signal": sig})
```

`signals.py` พอร์ต `STRATEGY_FNS` จาก `backtest.ts` ให้เป็น dict ชื่อเดียวกัน คืน Series ค่า `1` (BUY) / `-1` (SELL) / `0` (HOLD) และมี `compute_all(df)` ที่รวมทุกคอลัมน์ให้ harness ใช้

**เกณฑ์ผ่านเฟส 2:** harness รายงาน `OK` ทุกคอลัมน์ของตัวที่ 1–7 บน fixture ทั้ง 2 ชุด และสำหรับตัวที่ 8–10 มีไฟล์ `freqtrade/port-diff-notes.md` บันทึกว่าต่างตรงไหนเพราะอะไร

---

## 7. เฟส 3: Strategy บน freqtrade

### 7.1 โครงสร้างไฟล์

```
~/ft/
├─ docker-compose.yml               # หลาย service: ft-1h, ft-4h
├─ fixtures/                        # ข้อมูลทดสอบจากเฟส 1
└─ user_data/
   ├─ config.json                   # ค่ากลาง (exchange, telegram, discord)
   ├─ config.1h.json                 # override: timeframe, pair_whitelist, db_url, api port, pair_strategy_map
   ├─ config.4h.json
   ├─ strategies/
   │  ├─ ta_port/
   │  │  ├─ __init__.py
   │  │  ├─ indicators.py
   │  │  └─ signals.py
   │  ├─ BaseSignalStrategy.py       # เลือกกฎสัญญาณต่อคู่จาก config
   │  ├─ SupertrendStrategy.py       # subclass ตัวเดียวต่อกลยุทธ์ ใช้กับ backtest/hyperopt
   │  └─ ... อีก 9 ไฟล์
   └─ scripts/compare_with_ts.py
```

### 7.2 Strategy แม่

```python
# user_data/strategies/BaseSignalStrategy.py
from freqtrade.strategy import IStrategy
from pandas import DataFrame
from ta_port import signals as S

class BaseSignalStrategy(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "1h"
    can_short = False
    startup_candle_count = 300          # ครอบคลุม ATR200 + swing50 ของ SMC
    process_only_new_candles = True
    use_exit_signal = True
    # ปิดกลไกที่ TS ไม่มี เพื่อให้ backtest เทียบกับของเดิมได้ก่อน แล้วค่อยเปิดในเฟส 4
    stoploss = -0.99
    minimal_roi = {}
    trailing_stop = False

    strategy_id = "supertrend"          # subclass override หรือ config.pair_strategy_map override ต่อคู่

    def _strategy_for(self, pair: str) -> str:
        return self.config.get("pair_strategy_map", {}).get(pair, self.strategy_id)

    def populate_indicators(self, df: DataFrame, metadata: dict) -> DataFrame:
        sid = self._strategy_for(metadata["pair"])
        params = self.config.get("strategy_params", {}).get(sid, {})
        df["signal"] = S.STRATEGY_FNS[sid](df, params)      # 1 / -1 / 0
        return df

    def populate_entry_trend(self, df: DataFrame, metadata: dict) -> DataFrame:
        df.loc[df["signal"] == 1, ["enter_long", "enter_tag"]] = (1, self._strategy_for(metadata["pair"]))
        return df

    def populate_exit_trend(self, df: DataFrame, metadata: dict) -> DataFrame:
        df.loc[df["signal"] == -1, "exit_long"] = 1
        return df
```

```python
# user_data/strategies/SupertrendStrategy.py
from BaseSignalStrategy import BaseSignalStrategy
class SupertrendStrategy(BaseSignalStrategy):
    strategy_id = "supertrend"
```

### 7.3 Config ต่อ instance และ compose

```json
// user_data/config.1h.json
{
  "timeframe": "1h",
  "db_url": "sqlite:////freqtrade/user_data/tradesv3-1h.sqlite",
  "api_server": { "listen_port": 8080 },
  "exchange": { "pair_whitelist": ["BTC/USDT", "ETH/USDT", "SOL/USDT"] },
  "pair_strategy_map": { "BTC/USDT": "supertrend", "ETH/USDT": "cdc_actionzone", "SOL/USDT": "ut_bot" },
  "strategy_params": { "supertrend": { "atrPeriod": 10, "multiplier": 3.0 } }
}
```

```yaml
# docker-compose.yml (ย่อ)
services:
  ft-1h:
    image: freqtradeorg/freqtrade:stable
    restart: unless-stopped
    volumes: ["./user_data:/freqtrade/user_data"]
    ports: ["127.0.0.1:8080:8080"]
    command: trade --config user_data/config.json --config user_data/config.1h.json --strategy BaseSignalStrategy
  ft-4h:
    image: freqtradeorg/freqtrade:stable
    restart: unless-stopped
    volumes: ["./user_data:/freqtrade/user_data"]
    ports: ["127.0.0.1:8081:8080"]
    command: trade --config user_data/config.json --config user_data/config.4h.json --strategy BaseSignalStrategy
```

**เกณฑ์ผ่านเฟส 3:** `docker compose run --rm freqtrade list-strategies` เห็นครบ 11 ตัว และ `backtesting --strategy SupertrendStrategy` รันจบไม่ error

---

## 8. เฟส 4: Backtest และการตรวจสอบ

### 8.1 ข้อมูล

```bash
docker compose run --rm freqtrade download-data --exchange binance \
  --pairs BTC/USDT ETH/USDT SOL/USDT BNB/USDT XRP/USDT -t 1h 4h --days 730
```

### 8.2 ลำดับคำสั่งต่อ strategy

```bash
# 1) backtest ทั้งชุด เทียบกันในตารางเดียว
docker compose run --rm freqtrade backtesting --timerange 20250101- -i 1h \
  --strategy-list SupertrendStrategy CdcActionZoneStrategy UtBotStrategy CmMacdStrategy RsiStrategy SqueezeMomentumStrategy MsbObStrategy \
  --export trades

# 2) ตรวจ lookahead — ต้องได้ verdict "No" ทุกตัวก่อนไปต่อ
docker compose run --rm freqtrade lookahead-analysis --strategy TrendlinesStrategy --timerange 20250101- -i 1h

# 3) ตรวจว่า startup_candle_count พอ (สำคัญกับ EMA/RMA)
docker compose run --rm freqtrade recursive-analysis --strategy CdcActionZoneStrategy -p BTC/USDT \
  --timerange 20240101- --startup-candle 100 300 500

# 4) เปิด SL/ROI/trailing แล้วหาค่า
docker compose run --rm freqtrade hyperopt --strategy SupertrendStrategy \
  --spaces roi stoploss trailing --hyperopt-loss SharpeHyperOptLoss -e 300 --timerange 20250101-
```

### 8.3 เกณฑ์ตัดสิน

| ตรวจ | ผ่านเมื่อ | ถ้าไม่ผ่าน |
|---|---|---|
| เทียบกับ backtest.ts (ตัวที่ 1–7, SL/ROI ปิด) | จำนวน trade และแท่ง entry ตรงกัน ±1 trade (ต่างได้จาก fee/slippage model) | กลับไปเฟส 2 ห้ามไปต่อ |
| lookahead-analysis | verdict No, biased entries/exits = 0 | แก้ indicator ห้าม live |
| recursive-analysis | ความต่างของ indicator ที่ startup 300 vs 500 < 0.1% | เพิ่ม `startup_candle_count` |
| hyperopt | ค่า SL/ROI ที่ได้ไม่ overfit: ทดสอบ out-of-sample ช่วง 20260101- แล้ว profit factor > 1 | ใช้ค่า default แบบระมัดระวัง เช่น SL −5% |

**ผลลัพธ์เฟส 4:** ไฟล์ `freqtrade/backtest-results-YYYYMM.md` ตารางผล 10 strategy พร้อมค่า SL/ROI ที่เลือก และรายชื่อ strategy ที่ "อนุญาตให้ dry-run" กับที่ "ยังไม่อนุญาต"

---

## 9. เฟส 5: ปรับโปรเจกต์ Next.js

| ส่วน | ทำอะไร | เหตุผล |
|---|---|---|
| `app/api/binance/order/**`, `order/cancel`, `order/open`, `account`, `trades` | **ลบ** | รับ key จากเบราว์เซอร์ + Vercel whitelist IP ไม่ได้ + ซ้ำกับ freqtrade |
| `lib/executeSignal.ts` | **ลบ** | เรียก route ที่ลบไปแล้ว |
| `app/api/cron/scan/route.ts`, `.github/workflows/signal-poll.yml`, bot state ใน Upstash | **ลบ** | freqtrade ทำ polling/heartbeat เอง |
| `app/api/discord/notify` | **ลบ** | ใช้ `"discord"` ใน config ของ freqtrade |
| `app/api/discord/interactions` (slash command) | **เลือก:** เปลี่ยนไปเรียก REST API ของ freqtrade (`/api/v1/start`, `/stop`, `/status`, `/forceexit`) ผ่าน JWT หรือตัดทิ้งแล้วใช้ Telegram ของ freqtrade | ไม่ให้มี state สองที่ |
| `app/trading/LiveTrading` | เปลี่ยนเป็นอ่าน `/api/v1/status`, `/api/v1/profit`, `/api/v1/trades` จาก freqtrade ผ่าน route กลางใน Next.js ที่ถือ token ฝั่ง server | แดชบอร์ดอย่างเดียว |
| `app/klines`, backtest UI | เก็บไว้ ติดป้าย "ผลวิจัยเบื้องต้น ตัวตัดสินคือ freqtrade backtest" | ยังมีประโยชน์ในการดูกราฟ |
| `.env.example` | ลบ token จริง | ความปลอดภัย |

**เกณฑ์ผ่านเฟส 5:** ค้นในรีโปไม่พบ `api/v3/order` และ Vercel ไม่มี env `BINANCE_SECRET_KEY`

---

## 10. เฟส 6: Dry-run แล้ว Live

### 10.1 Dry-run (2–4 สัปดาห์)

- เปิด `telegram` และ `discord` ใน config ตั้ง `dry_run: true`
- ทุกสัปดาห์บันทึก: จำนวน trade, win rate, drawdown จาก `/api/v1/profit` เทียบกับผล backtest ช่วงเดียวกัน ถ้าเบี่ยงมากกว่าที่ recursive-analysis บอกไว้ ให้หาสาเหตุ
- ทดสอบ restart container ระหว่างมี trade เปิด ต้องกู้ position ได้

### 10.2 Checklist ก่อน Live

- [ ] Binance API key: เปิดเฉพาะ **Enable Spot & Margin Trading** ไม่เปิด Withdraw
- [ ] **Restrict access to trusted IPs only** ใส่ IP ของ VPS เท่านั้น
- [ ] `dry_run: false`, `stake_amount` เริ่มที่ 10–20 USDT ต่อไม้, `max_open_trades` 1–2
- [ ] `protections` ใน config: `StoplossGuard`, `CooldownPeriod`, `MaxDrawdown`
- [ ] Telegram สั่ง `/stop`, `/forceexit all`, `/status` ได้จากมือถือ
- [ ] backup `user_data/*.sqlite` รายวัน (cron + rclone หรือ scp ออกนอกเครื่อง)
- [ ] `restart: unless-stopped` ใน compose และทดสอบ reboot VPS
- [ ] เฉพาะ strategy ที่อยู่ในรายชื่อ "อนุญาต" จากเฟส 4 เท่านั้นที่อยู่ใน `pair_strategy_map`

### 10.3 ขยายหลัง live นิ่ง

เพิ่ม `stake_amount` ทีละขั้นทุก 2 สัปดาห์ถ้า drawdown ไม่เกินที่กำหนด · เพิ่มคู่ผ่าน `pair_whitelist` · พิจารณา `VolumePairList` เมื่อคู่เยอะ · Futures ผ่าน `trading_mode: futures` เป็นโครงการแยก

---

## 11. ความเสี่ยงและการตัดสินใจล่วงหน้า

| ความเสี่ยง | ผลกระทบ | แนวทาง |
|---|---|---|
| ผล backtest ของ Trendlines, S/R, SMC เปลี่ยนหลังแก้ lookahead | อาจพบว่าตัวที่เคยดูดีที่สุดไม่ดีจริง | ยอมรับตั้งแต่ต้น ทำ 7 ตัว causal ให้จบและ dry-run ก่อน |
| SMC ประเมินเวลายาก | เฟส 2 ยืด | จำกัดขอบเขตเหลือ internal structure + premium/discount |
| loop Python ช้ากว่า TS 10–50 เท่า | hyperopt บน 5m ช้า | `@numba.njit` เฉพาะ Supertrend, UT Bot, MSB; hyperopt บน 1h ขึ้นไป |
| EMA/RMA ต่างกันตาม warm-up | live ≠ backtest เล็กน้อย | recursive-analysis + `startup_candle_count` 300–500 |
| Binance TH | ccxt ไม่รองรับ | อยู่กับ Binance global; ถ้าต้องย้ายค่อยทำ executor แยก |
| หลาย instance ใช้ RAM | VPS 2 GB ตึงเมื่อเกิน 5 instance | เริ่ม 2 instance (1h, 4h) ใช้ `pair_strategy_map` แทนการเพิ่ม instance |

---

## 12. Definition of Done ต่อเฟส (สรุป)

| เฟส | Done เมื่อ |
|---|---|
| 0 | SampleStrategy dry-run บน VPS, FreqUI เปิดได้, token Discord ถูก reset แล้ว |
| 1 | harness รันได้ทั้งสองฝั่งบน fixture 2 ชุด |
| 2 | ตัวที่ 1–7 OK ทุกคอลัมน์; ตัวที่ 8–10 มีบันทึกความต่าง |
| 3 | 11 strategy โหลดได้, backtest รันจบ |
| 4 | lookahead No ทุกตัว, มีตารางผล + รายชื่ออนุญาต dry-run |
| 5 | Next.js ไม่มี executor/cron, LiveTrading อ่านจาก freqtrade |
| 6 | dry-run ≥ 2 สัปดาห์ผลใกล้ backtest, checklist live ครบ, live ทุนน้อยรันได้ 1 สัปดาห์ไม่มี error |

---

## แหล่งอ้างอิง

- freqtrade Docker quickstart — https://www.freqtrade.io/en/stable/docker_quickstart/
- Strategy customization / `startup_candle_count` — https://www.freqtrade.io/en/stable/strategy-customization/
- Strategy callbacks — https://www.freqtrade.io/en/stable/strategy-callbacks/
- Lookahead analysis — https://www.freqtrade.io/en/stable/lookahead-analysis/
- Recursive analysis — https://www.freqtrade.io/en/stable/recursive-analysis/
- Hyperopt — https://www.freqtrade.io/en/stable/hyperopt/
- REST API — https://www.freqtrade.io/en/stable/rest-api/
- Webhook / Discord — https://www.freqtrade.io/en/stable/webhook-config/
- Protections — https://www.freqtrade.io/en/stable/plugins/#protections
- Binance API filters (LOT_SIZE, MIN_NOTIONAL) — https://developers.binance.com/docs/binance-spot-api-docs/filters
