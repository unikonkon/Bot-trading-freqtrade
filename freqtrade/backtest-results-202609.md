# ผล backtest เบื้องต้นบน freqtrade (แผนเฟส 4) — ก.ย. 2026

> ทำเมื่อ 14 ก.ย. 2026 บนเครื่อง dev · freqtrade 2026.8 (Docker) · ข้อมูล Binance spot **120 วัน** (16 พ.ค. – 13 ก.ย. 2026)
> timerange backtest `20260601-` · timeframe 1h · pairs BTC/USDT, ETH/USDT, SOL/USDT
> การตั้งค่า: `stake_amount` 50 USDT, `max_open_trades` 3, `dry_run_wallet` 1000, **stoploss ปิด (−99%), ROI ปิด, trailing ปิด** เพื่อเทียบกับ backtest.ts
>
> ⚠️ นี่คือผลบนข้อมูลสั้น 3.5 เดือน ใช้ยืนยันว่า pipeline ทำงานเท่านั้น **ห้ามใช้ตัดสินว่ากลยุทธ์ไหนดี** ต้องรันซ้ำบนข้อมูล 2 ปี (`--days 730`) และ out-of-sample ตามแผนข้อ 8.3

## 1. STRATEGY SUMMARY (7 ตัวที่เป็น causal)

| Strategy | Trades | Avg Profit % | Tot Profit USDT | Tot Profit % | Avg Duration | Win / Loss | Win % | Max Drawdown |
|---|---:|---:|---:|---:|---|---|---:|---|
| SupertrendStrategy | 90 | 0.28 | 12.74 | 1.27 | 1d 17h | 34 / 56 | 37.8 | 2.18% |
| CdcActionZoneStrategy | 134 | 0.41 | 27.56 | 2.76 | 1d 6h | 42 / 92 | 31.3 | 1.77% |
| UtBotStrategy | 432 | −0.16 | −34.79 | −3.48 | 9h | 125 / 307 | 28.9 | 5.74% |
| CmMacdStrategy | 307 | −0.24 | −37.06 | −3.71 | 12h | 90 / 217 | 29.3 | 5.96% |
| RsiStrategy | 36 | 0.95 | 17.23 | 1.72 | 3d 23h | 28 / 8 | 77.8 | 2.11% |
| SqueezeMomentumStrategy | 178 | 0.32 | 28.40 | 2.84 | 22h | 62 / 116 | 34.8 | 1.48% |
| MsbObStrategy | 49 | 1.55 | 37.94 | 3.79 | 3d 7h | 17 / 32 | 34.7 | 1.67% |

ข้อสังเกตเบื้องต้น (ยังไม่ใช่ข้อสรุป)
- UT Bot และ CM MACD เทรดถี่มากบน 1h (ค่าธรรมเนียม 0.1% ต่อขา กินกำไรหมด) น่าจะเหมาะกับ timeframe ใหญ่กว่า หรือใช้เป็นตัวกรองมากกว่าตัว entry
- RSI win rate สูงแต่ trade น้อยและถือนาน ต้องดูว่าเมื่อเปิด stoploss แล้วเป็นอย่างไร
- ทุกตัวยังไม่มี SL/ROI ผลจะเปลี่ยนหลัง hyperopt

## 2. BaseSignalStrategy + pair_strategy_map (config.1h.json)

| Pair | strategy_id (enter_tag) | Trades | Tot Profit % | Win % |
|---|---|---:|---:|---:|
| BTC/USDT | supertrend | 31 | 0.00 | 35.5 |
| ETH/USDT | cdc_actionzone | 54 | 0.97 | 31.5 |
| SOL/USDT | ut_bot | 152 | −1.52 | 28.9 |

ยืนยันว่า `pair_strategy_map` เลือกกฎต่อคู่ถูกต้อง (ENTER TAG STATS ตรงกับ map) และตัวเลขต่อคู่ตรงกับการรัน subclass เดี่ยว

## 3. เทียบกับ backtest.ts (เกณฑ์ ±1 trade)

| | freqtrade SupertrendStrategy BTC/USDT | backtest.ts supertrend BTC/USDT |
|---|---:|---:|
| ข้อมูล | feather ที่ freqtrade ดาวน์โหลด | ไฟล์เดียวกัน export เป็น kline JSON (`freqtrade/scripts/backtest-count.ts`) |
| Trades ตั้งแต่ 1 มิ.ย. | **31** | **32** |
| Win / Loss | 11 / 20 | 11 / 21 |
| Tot Profit % | 0.00 | −0.04 |

ผ่านเกณฑ์ ต่าง 1 trade มาจาก freqtrade เข้าที่ราคาเปิดแท่งถัดไปหลังสัญญาณ ส่วน TS เข้าที่ราคาปิดแท่งสัญญาณ และการตัดขอบ timerange

## 4. lookahead-analysis (`--minimum-trade-amount 5`, 20 สัญญาณต่อตัว)

| Strategy | has_bias | biased entries | biased exits |
|---|---|---:|---:|
| SupertrendStrategy | No | 0 | 0 |
| TrendlinesStrategy | No | 0 | 0 |
| SupportResistanceStrategy | No | 0 | 0 |
| SmcStrategy | No | 0 | 0 |

3 ตัวที่แก้ lookahead ด้วย confirmed pivot ผ่านทั้งหมด (ยังไม่ได้รันกับอีก 6 ตัวที่เหลือ ควรรันให้ครบก่อน dry-run)

## 5. recursive-analysis (CdcActionZoneStrategy, BTC/USDT, startup 100 / 300 / 500)

- "No variance on indicator(s) found due to recursive formula"
- "No lookahead bias on indicators found"

หมายเหตุ: strategy ของเรา expose คอลัมน์ `signal` (int) เท่านั้น การตรวจจึงหมายถึง "สัญญาณไม่เปลี่ยนตาม startup" ซึ่งคือสิ่งที่ต้องการ

## 6. Smoke test dry-run (ft-1h, 45 วินาที)

- โหลด whitelist 3 คู่, strategy BaseSignalStrategy, dry-run enabled
- เกิด "Long signal found" บน BTC/USDT ทันทีจากสัญญาณ Supertrend ของแท่งล่าสุด และสร้าง dry-run order สำเร็จ
- REST API ตอบ `{"status":"pong"}` ที่ 127.0.0.1:8080
- ปิดด้วย `docker compose down` เรียบร้อย

## 7. รายชื่อสถานะ (ตามแผนข้อ 8.3)

| Strategy | อนุญาต dry-run | เหตุผล |
|---|---|---|
| supertrend, cdc_actionzone, squeeze_momentum, msb_ob, rsi | รอผลข้อมูล 2 ปี + hyperopt | pipeline ผ่าน, ผล 120 วันเป็นบวกเล็กน้อย |
| ut_bot, cm_macd | รอผลบน 4h ขึ้นไป | เทรดถี่เกินไปบน 1h |
| trendlines, support_resistance, smc | รอ backtest 2 ปี | ผ่าน lookahead แล้ว แต่ยังไม่ได้รัน backtest เต็ม |

## งานที่เหลือของเฟส 4

1. `download-data --days 730` แล้วรัน `backtesting --strategy-list` ครบ 10 ตัว ทั้ง 1h และ 4h
2. `lookahead-analysis` อีก 6 ตัวที่ยังไม่ได้รัน
3. `hyperopt --spaces roi stoploss trailing` ต่อกลยุทธ์ที่ผ่าน แล้วทดสอบ out-of-sample
4. อัปเดตตารางข้อ 7 เป็นรายชื่ออนุญาต dry-run ตัวจริง
