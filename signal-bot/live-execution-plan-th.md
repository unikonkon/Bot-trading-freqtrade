# แผนช่วงเงินจริง: freqtrade เป็นตัวยิงออเดอร์ · บอท TS เป็นตัวแจ้งเตือนคู่ขนาน

> เวอร์ชัน 1.0 — 15 ก.ย. 2026
> ต่อจาก [`freqtrade-migration-plan-th.md`](../freqtrade/freqtrade-migration-plan-th.md) (เฟส 4–6) และ [`signal-bot-ts-runbook-th.md`](./README.md)
> หลักข้อ 3 ของแผน migration ยังคงอยู่: **ระบบตัดสินใจและยิงออเดอร์มีระบบเดียวคือ freqtrade** บอท TS ไม่มีสิทธิ์และไม่มีโค้ดยิงออเดอร์

---

## 1. ทำไมแบ่งบทบาทแบบนี้

| | freqtrade | บอท TS (`signal-bot/`) |
|---|---|---|
| ตัดสินใจเข้า/ออก | ✅ จาก `ta_port/signals.py` | ❌ แค่รายงานสัญญาณ |
| ยิงออเดอร์ Binance | ✅ dry-run แล้วค่อย live | ❌ ไม่มี key ไม่มีโค้ด |
| stoploss / ROI / trailing / protections | ✅ | ❌ |
| กู้ position หลัง restart, LOT_SIZE, partial fill, kill-switch | ✅ | ❌ |
| แจ้งเตือน "สัญญาณเกิด" ทันทีที่แท่งปิด | ⚠️ แจ้งเฉพาะ trade ที่เปิด/ปิดจริง | ✅ ทุกสัญญาณ แม้ freqtrade ไม่เข้า (max_open_trades เต็ม, protections) |
| คุมด้วย Telegram | `/start /stop /status /forceexit …` | `/pause /resume /status /scan` (กระทบแค่การแจ้งเตือน) |
| ภาษา | Python (พอร์ตจาก TS ผ่าน harness) | TypeScript ต้นฉบับ |

ประโยชน์ของการรันคู่กัน: บอท TS เป็น **พยานอิสระ** ว่าสัญญาณเกิดจริง ถ้า freqtrade เปิด trade โดยที่ TS ไม่เห็นสัญญาณ (หรือกลับกัน) แปลว่ามีอะไรผิด ต้องหยุดดู

---

## 2. สถาปัตยกรรมบน VPS

```
 VPS static IP (Ubuntu, Docker + Node 20)
 ┌────────────────────────────────────────────────────────────────────────────────┐
 │  docker compose (freqtrade/)                          pm2                            │
 │  ┌─ ft-1h ── BaseSignalStrategy ── sqlite ─┐   ┌─ signal-bot (signal-bot/index.ts) ─┐ │
 │  │   pair_strategy_map (config.1h.json)    │   │   BOTS= (.env)              │ │
 │  │   Binance key (Spot, IP whitelist)      │   │   ไม่มี key                  │ │
 │  └─ ft-4h ── … ── sqlite ──────────────────┘   └─────────────────────────────┘ │
 │        │ ออเดอร์ (signed)                            │ klines (public)           │
 └────────┼─────────────────────────────────────────────┼─────────────────────────┘
          ▼                                             ▼
      Binance  ◄────────────────────────────────────────┘
          │
   Telegram bot A (freqtrade): trade เปิด/ปิด, /stop, /forceexit
   Telegram bot B (signal-bot): สัญญาณ BUY/SELL ทุกแท่ง, /pause
   Next.js (Vercel): แดชบอร์ดอ่าน REST ของ freqtrade ผ่าน api/freqtrade/route.ts, หน้า Klines วิจัย
```

- **บอท Telegram สองตัวคนละ token** (token เดียว poll จากสองโปรแกรมไม่ได้) จะให้ส่งเข้า chat/กลุ่มเดียวกันได้
- config ของทั้งสองระบบต้องเล่าเรื่องเดียวกัน: `BOTS` ↔ `pair_strategy_map` + `timeframe`, `STRATEGY_PARAMS` ↔ `strategy_params` → ตรวจด้วย `npm run check:sync`

---

## 3. กฎ "ระบบตัดสินใจเดียว" (บังคับตลอด)

| ข้อ | ตรวจอย่างไร |
|---|---|
| โปรเจกต์นี้ไม่มีโค้ดยิงออเดอร์ที่ใช้งาน | `lib/executeSignal.ts` เรียก `/api/binance/order` ซึ่งไม่มีในรีโปนี้ → ลบทิ้งในเฟส A; `grep -r "api/v3/order" lib bot` ต้องว่าง |
| บอท TS ไม่มี Binance key | `.env` ไม่มี `BINANCE_*_KEY/SECRET`; `grep -ri "X-MBX-APIKEY" bot` ต้องว่าง |
| Next.js ไม่ยิงออเดอร์ | ทำเฟส 5 ของแผน migration: ลบ `app/api/binance/order/**`, `cron/scan`, workflow `signal-poll.yml`; Vercel ไม่มี `BINANCE_SECRET_KEY` |
| freqtrade instance ต่อคู่มีตัวเดียว | คู่หนึ่งอยู่ใน whitelist ของ instance เดียว (1h หรือ 4h) ไม่ซ้ำสองที่ |
| Binance key ใช้จากที่เดียว | key ที่ whitelist IP ของ VPS ใส่ใน `config.local.json` ของ freqtrade เท่านั้น |

---

## 4. ความต่างที่ "ถูกต้อง" ระหว่างสัญญาณ TS กับ trade ของ freqtrade

ต้องรู้ก่อน ไม่งั้นจะคิดว่าบั๊ก

| กรณี | เพราะ |
|---|---|
| TS ส่ง BUY ตอน 18:00 · freqtrade เข้าที่ราคาเปิดแท่ง 18:00 (ไม่ใช่ราคาปิด 17:59) | freqtrade เข้าแท่งถัดไปหลังสัญญาณ (backtest-results ข้อ 3 ต่างกัน 1 trade เพราะเรื่องนี้) |
| TS ส่ง BUY แต่ freqtrade ไม่เปิด trade | `max_open_trades` เต็ม, protections (CooldownPeriod/StoplossGuard) กำลังล็อก, ยอด USDT ไม่พอ, คู่ยังมี trade เปิดอยู่ |
| freqtrade ปิด trade โดย TS ไม่ส่ง SELL | stoploss / ROI / trailing / protections ปิดก่อนสัญญาณ |
| TS ส่ง SELL แต่ freqtrade ไม่ทำอะไร | ไม่มี trade เปิดในคู่นั้น (spot ไม่ short) |
| สัญญาณต่างกันเล็กน้อยหลัง restart | `startup_candle_count` 300 กับ `KLINE_LIMIT` 500 ให้ warm-up ต่างกัน ผ่าน recursive-analysis แล้วว่าไม่มีผลกับสัญญาณ ถ้าต่างจริงให้ตั้งสองค่านี้ให้เท่ากัน |

สิ่งที่ **ไม่ควรเกิด**: freqtrade เปิด long ในแท่งที่ TS ไม่มี BUY (และไม่มี BUY ในแท่งก่อนหน้า) → หยุด (`/stop`) แล้วรัน harness

---

## 5. เฟสและเกณฑ์ผ่าน

### เฟส A — ตอนนี้ (ไม่มีเงินจริง)

| งาน | เกณฑ์ผ่าน |
|---|---|
| A1 deploy บอท TS บน VPS ด้วย pm2 (runbook ข้อ 7) | ได้ heartbeat ครบ 3 วัน ไม่มี restart loop, `/status` ตอบภายใน 3 วิ |
| A2 ทำเฟส 4 ของ freqtrade ให้จบ: `download-data --days 730`, backtest 10 ตัว 1h/4h, lookahead-analysis อีก 6 ตัว, hyperopt SL/ROI + out-of-sample | ตาราง `backtest-results-YYYYMM.md` มีรายชื่อ "อนุญาต dry-run" ตัวจริง |
| A3 ตั้ง `BOTS` ให้ตรง `pair_strategy_map` เฉพาะกลยุทธ์ที่อนุญาต | `npm run check:sync` = OK |
| A4 ลบ `lib/executeSignal.ts` และ reset token Discord ที่เคยหลุดใน `.env.example` ของโปรเจกต์ Next.js | grep ตามข้อ 3 ว่าง |

### เฟส B — dry-run คู่ขนาน 2–4 สัปดาห์

| งาน | เกณฑ์ผ่าน |
|---|---|
| B1 `docker compose up -d ft-1h ft-4h` (`dry_run: true`) + signal-bot รันอยู่แล้ว ทั้งคู่ส่ง Telegram เข้ากลุ่มเดียวกัน | เห็นข้อความจากบอททั้งสองตัว |
| B2 **ทุกสัปดาห์** ทำตาราง: entry ของ freqtrade (`/api/v1/trades`) ↔ alert BUY ของ TS แท่งเดียวกัน; exit ↔ SELL หรือเหตุผลออก (stoploss/ROI) | ทุก entry มี BUY ของ TS แท่งเดียวกัน 100%; exit ที่ไม่มี SELL ต้องมี `exit_reason` ที่ไม่ใช่ `exit_signal` |
| B3 ทดสอบ `docker compose restart ft-1h` ระหว่างมี trade เปิด และ `pm2 restart signal-bot` | freqtrade กู้ trade ได้; TS ไม่ส่งสัญญาณซ้ำ |
| B4 ทดสอบ kill-switch จากมือถือ: `/stop`, `/forceexit all` (freqtrade) และ `/pause` (TS) | ทำงานภายใน 1 นาที |
| B5 เทียบผล dry-run กับ backtest ช่วงเดียวกัน (`backtesting --timerange` ของช่วง dry-run) | จำนวน trade ต่าง ≤ 10% และไม่มี trade ที่อธิบายไม่ได้ |

### เฟส C — live ทุนน้อย

Checklist จากแผน migration ข้อ 10.2 ทั้งหมด **บวก**

- [ ] Binance key: Spot เท่านั้น, ไม่เปิด Withdraw, whitelist IP = VPS; ใส่ใน `freqtrade/user_data/config.local.json` (gitignore) เท่านั้น
- [ ] `dry_run: false`, `stake_amount` 10–20 USDT, `max_open_trades` 1–2, `db_url` ชี้ไฟล์ live แยกจาก dry-run
- [ ] `pair_strategy_map` มีเฉพาะกลยุทธ์ในรายชื่ออนุญาตจากเฟส A2 และ `npm run check:sync` = OK
- [ ] Telegram สองบอทแยก token, ทดสอบ `/stop` และ `/forceexit all` **หลัง** สลับเป็น live แล้วอีกครั้ง
- [ ] backup `freqtrade/user_data/*.sqlite` รายวันออกนอกเครื่อง
- [ ] เฝ้า log ของทั้งสองระบบ 1 ชั่วโมงแรก และรีวิว B2 ต่อทุกสัปดาห์

เกณฑ์ผ่าน C: live 1 สัปดาห์ ไม่มี error ใน log, ทุก trade อธิบายได้ด้วยตาราง B2

### เฟส D — ขยาย

เพิ่ม `stake_amount` ทีละขั้นทุก 2 สัปดาห์เมื่อ drawdown ไม่เกินที่กำหนด · เพิ่มคู่ผ่าน `pair_whitelist` + `pair_strategy_map` + `BOTS` พร้อมกัน (check:sync) · Futures/short เป็นโครงการแยก

---

## 6. หยุดฉุกเฉิน (ทำจากมือถือได้)

1. Telegram บอท freqtrade: `/stop` (ไม่เปิด trade ใหม่) → ถ้าต้องล้าง `/forceexit all`
2. ถ้า Telegram ใช้ไม่ได้: `ssh vps 'cd ft && docker compose stop ft-1h ft-4h'`
3. ถ้าสงสัย key รั่ว: Binance → API Management → ลบ key ทันที
4. บอท TS ปล่อยรันต่อได้ (ไม่มีผลกับเงิน) ใช้ `/status` ดูตลาดต่อ

---

## 7. งานที่ยังไม่ได้ทำ (สรุป)

- [ ] A1 deploy signal-bot บน VPS
- [ ] A2 freqtrade เฟส 4 บนข้อมูล 2 ปี + hyperopt + lookahead ครบ 10 ตัว
- [ ] A4 ลบ `lib/executeSignal.ts`; เฟส 5 ของ Next.js (ลบ route ยิงออเดอร์/cron)
- [ ] โปรเจกต์ `NextJS_UseBot_Crypto` มี `lib/indicators.ts` สำเนาแยกที่ **ยังไม่มีโหมด confirmed** — หน้า Klines ของมันจึงยังมองโลกในแง่ดีสำหรับ S/R, Trendlines, SMC ต้อง sync `pivotEvents` + `confirmedPivots` ไปด้วย
