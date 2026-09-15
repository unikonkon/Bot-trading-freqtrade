# signal-bot/ — บอทสัญญาณ TypeScript + Telegram bot B — วิเคราะห์การทำงานและคู่มือใช้งาน

> เวอร์ชัน 1.0 — 15 ก.ย. 2026
> บอทนี้ **แจ้งเตือนสัญญาณเท่านั้น ไม่ยิงออเดอร์** ตัวยิงออเดอร์ด้วยเงินจริงคือ freqtrade ตามแผน [`live-execution-plan-th.md`](./live-execution-plan-th.md)
> ไม่ต้องใช้ Next.js, ไม่ต้องใช้ API route, ไม่ถือ Binance API key

---

## 1. บอททำอะไร

```
 Binance klines (public)  →  lib/indicators.ts  →  STRATEGY_FNS (lib/backtest.ts)  →  Telegram
        ดึงตรง                 คำนวณ indicator          แปลงเป็น BUY/SELL/HOLD          แจ้งเตือน + รับคำสั่ง
```

| ทำ | ไม่ทำ |
|---|---|
| ตื่นมาสแกน "หลังแท่งปิด" ของแต่ละ interval | ยิงออเดอร์ / ถือ API key / คุยกับ endpoint ที่ต้อง sign |
| ส่ง BUY/SELL เข้า Telegram เมื่อแท่งที่เพิ่งปิดเกิดสัญญาณ | จำลอง position, stop-loss, กำไรขาดทุน |
| รับคำสั่ง `/status /scan /pause /resume /bots /help` | polling ราคาถี่ ๆ (ใช้เวลาปิดแท่งเป็นตัวปลุก) |
| จำว่าส่งสัญญาณไหนไปแล้ว รอด restart | เก็บประวัติแท่งเทียนลงฐานข้อมูล |

ใช้ **indicators.ts ชุดเดียวกับหน้า Klines และ harness** และตั้งแต่ 15 ก.ย. 2026 pivot ของ Support/Resistance, Trendlines, SMC เป็นโหมด `confirmed` (ไม่มี lookahead) ตรงกับ `ta_port/indicators.py` ของ freqtrade 1:1 — harness `--mode live` PASS 31/31 คอลัมน์ทั้ง BTC 1h และ ETH 4h

---

## 2. วิเคราะห์การทำงาน

### 2.1 วงจรหนึ่งรอบ (ต่อ interval)

```
 ┌─ loop ของ interval "1h" (บอททุกตัวที่เป็น 1h อยู่ในกลุ่มนี้) ─────────────────────┐
 │                                                                                      │
 │ 1. คำนวณเวลาปิดแท่งถัดไป  next = floor(now / 1h) * 1h + 1h   (signal-bot/schedule.ts)       │
 │ 2. หลับจนถึง next + CLOSE_DELAY_SEC (default 8 วิ เผื่อ Binance ปิดแท่งช้า)           │
 │ 3. ดึง klines ครั้งเดียวต่อ (symbol, interval) → ตัดแท่งสุดท้ายที่ยังไม่ปิดออก          │
 │ 4. ต่อบอท: computeSignals(klines, strategyId, params) → สัญญาณของแท่งที่เพิ่งปิด        │
 │ 5. ถ้าแท่งล่าสุดที่ได้ยังเก่ากว่าที่คาด (Binance ยังไม่อัปเดต) → รอ 15 วิ ลองใหม่ ≤ 4 ครั้ง │
 │ 6. สัญญาณ ≠ HOLD และยังไม่เคยส่ง (closeTime ใหม่กว่าใน state) และไม่เก่าเกิน 1 ช่วง      │
 │       → ส่ง Telegram → บันทึก lastAlert[bot] = closeTime                               │
 │ 7. กลับไปข้อ 1                                                                       │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

- interval ที่ความยาวคงที่ (1m … 3d, 1w) ใช้ตารางเวลาแบบนี้ทั้งหมด; 1w ชดเชยให้ตรงกับ Binance ที่เปิดแท่งวันจันทร์ 00:00 UTC (ตรวจแล้วตรงกับ closeTime จริง)
- `1M` ความยาวไม่คงที่ → polling ทุก `FALLBACK_POLL_SEC` แทน (กันซ้ำด้วย closeTime อยู่แล้ว)
- หลาย interval ทำงานเป็น loop คู่ขนาน ตัวละ loop; การสแกนถูกกันไม่ให้ซ้อนกัน (`/scan` ระหว่างรอบตามเวลาจะรอคิว)

### 2.2 ทำไมต้องรอ "แท่งปิด"

indicator ทุกตัวคำนวณจากราคาปิด ถ้าคำนวณระหว่างแท่งยังไม่ปิด สัญญาณจะกระพริบ (เกิดแล้วหาย) ตัวดึงข้อมูลจึงตัดแท่งที่ `closeTime > now` ทิ้งเสมอ และตัวจัดตารางตื่นหลังเวลาปิดเท่านั้น — เป็นพฤติกรรมเดียวกับ freqtrade (`process_only_new_candles`)

### 2.3 กันยิงซ้ำและ restart

- state เก็บใน `signal-bot/data/signal-bot-state.json` (เขียนแบบ atomic: tmp แล้ว rename) มี `paused`, `lastAlert[botId] = {closeTime, signal, price}`, `telegramOffset`
- หลัง restart บอทสแกนทันที 1 รอบเพื่อให้ `/status` ตอบได้ แต่จะ **ไม่ส่ง** สัญญาณที่ (ก) เคยส่งแล้ว (closeTime เท่าเดิม) หรือ (ข) เก่ากว่า 1 ช่วง interval — กันสแปมสัญญาณย้อนหลังตอนเครื่องดับนาน
- `/pause` ไม่หยุดสแกน แค่ไม่ส่ง; สัญญาณที่เกิดระหว่าง pause ถูกบันทึกว่าเห็นแล้ว เพื่อไม่ให้ทะลักออกมาตอน `/resume`

### 2.4 Telegram

- ใช้ **long polling** (`getUpdates` timeout 30 วิ) ไม่ต้องเปิดพอร์ต ไม่ต้องมีโดเมน/TLS เหมาะกับ VPS
- รับคำสั่งเฉพาะ chat id ใน `TELEGRAM_CHAT_ID` + `TELEGRAM_ALLOWED_CHAT_IDS` คนอื่นส่งมาจะถูกเมินและ log ไว้
- ข้อความเป็น HTML ถ้าส่งไม่ผ่าน (ตัวอักษรพิเศษ) จะส่งซ้ำแบบ plain text อัตโนมัติ; ข้อความยาวถูกตัดเป็นชิ้น ≤ 4000 ตัวอักษร
- **ต้องเป็นบอท Telegram คนละตัวกับของ freqtrade** — token เดียวกันถูก poll จากสองโปรแกรมพร้อมกันไม่ได้ (Telegram ตอบ 409 Conflict)

### 2.5 ความผิดพลาด

| เหตุการณ์ | พฤติกรรม |
|---|---|
| Binance ตอบ 5xx / 429 / timeout 10 วิ | retry 3 ครั้ง (หน่วง 1.5s, 3s) แล้วรายงาน error ของกลุ่มนั้น บอทกลุ่มอื่นทำงานต่อ |
| Binance ตอบ 4xx อื่น (เช่น symbol ผิด) | ไม่ retry รายงานทันที |
| error ซ้ำ ๆ | ส่งเข้า Telegram ไม่เกิน 1 ครั้ง / 15 นาที ต่อข้อความ (log ครบทุกครั้ง) |
| Telegram ล่ม | polling ถอยหลัง 1s → 2s → … → 60s แล้วลองใหม่เรื่อย ๆ; alert ที่ส่งไม่ได้จะ throw และ **ไม่ถูกบันทึกว่าส่งแล้ว** จึงถูกส่งซ้ำรอบถัดไป (ภายใน 1 ช่วง) |
| process ตาย | pm2/systemd รีสตาร์ทใน 5 วิ, state บนดิสก์ทำให้ไม่ส่งซ้ำ |
| SIGINT/SIGTERM | หยุด loop, บันทึก state, ส่ง "หยุดทำงาน" (รอไม่เกิน 3 วิ) |

### 2.6 ความปลอดภัย

- ไม่มี Binance key ในโปรเจกต์นี้เลย endpoint ที่ใช้เป็น public ทั้งหมด
- `.env` อยู่ใน `.gitignore`; `.env.example` ไม่มีค่าจริง
- Telegram allowlist ตาม chat id; คำสั่งทุกตัวเป็นอ่าน/หยุด/เริ่ม ไม่มีคำสั่งที่กระทบเงิน

---

## 3. ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `signal-bot/index.ts` | main: lifecycle, loop ต่อ interval, ตัดสินใจส่ง alert, คำสั่ง Telegram, `--once` |
| `signal-bot/env.ts` | อ่าน `.env` (ไม่ใช้ไลบรารี), parse `BOTS`, ตรวจชื่อ strategy/interval |
| `signal-bot/binance.ts` | ดึง klines จาก Binance ตรง ตัดแท่งที่ยังไม่ปิด, timeout + retry |
| `signal-bot/scanner.ts` | จัดกลุ่ม symbol+interval, `analyzeBot` → สัญญาณล่าสุด + สถานะ (ย้ายจาก `NextJS_UseBot_Crypto/lib/scanner.ts`) |
| `signal-bot/schedule.ts` | เวลาปิดแท่งถัดไป / แท่งล่าสุดที่ปิดแล้ว ต่อ interval |
| `signal-bot/state.ts` | state JSON เขียนแบบ atomic |
| `signal-bot/telegram.ts` | Telegram Bot API (sendMessage, getUpdates long polling, setMyCommands) |
| `signal-bot/format.ts` | ข้อความแจ้งเตือน/สถานะ (แก้หน้าตาข้อความที่นี่) |
| `lib/backtest.ts → computeSignals()` | จุดร่วมของ backtest และบอท: indicator → สัญญาณ (เพิ่มใหม่) |
| `lib/indicators.ts → pivotEvents()` | pivot แบบ confirmed ใช้ร่วมกันโดย S/R, Trendlines, SMC (เพิ่มใหม่) |
| `signal-bot/deploy/ecosystem.config.cjs` | pm2 |
| `signal-bot/deploy/signal-bot.service` | systemd |
| `signal-bot/.env.example` | ตัวอย่างค่าตั้ง (คัดลอกเป็น `signal-bot/.env`) |
| `signal-bot/scripts/check-config-sync.ts` | ตรวจ `BOTS` ↔ `pair_strategy_map` ของ freqtrade |

---

## 4. ต้องมีอะไรบ้าง

| | |
|---|---|
| Node.js 20+ (ทดสอบบน 24) | `node -v` |
| `npm ci` ที่ root โปรเจกต์ | ติดตั้ง `tsx` (รัน TS ตรงไม่ต้อง build) |
| อินเทอร์เน็ตถึง `api.binance.com` และ `api.telegram.org` | ไม่ต้องมี static IP (ไม่ยิงออเดอร์) |
| Telegram bot token + chat id | @BotFather → token, @userinfobot → chat id |
| VPS (ตัวเดียวกับ freqtrade ได้) | RAM ~100 MB |

---

## 5. ตั้งค่า

```bash
cp signal-bot/.env.example signal-bot/.env     # รันทุกคำสั่งจาก root ของ repo
```

| คีย์ | ค่า |
|---|---|
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | บอท **คนละตัว** กับของ freqtrade; เว้นว่างทั้งคู่ = ปิด Telegram (ข้อความลง log) |
| `BOTS` | `SYMBOL:INTERVAL:STRATEGY,…` เช่น `BTCUSDT:1h:supertrend,ETHUSDT:1h:cdc_actionzone` — ให้ตรงกับ `pair_strategy_map` ของ freqtrade (ตรวจด้วย `npm run check:sync`) |
| `STRATEGY_PARAMS` | JSON ต่อกลยุทธ์ ชื่อพารามิเตอร์เดียวกับ `lib/backtest.ts` และ `config.json → strategy_params` |
| `KLINE_LIMIT` | 300–1000 (default 500) |
| `CLOSE_DELAY_SEC` | หน่วงหลังแท่งปิด (default 8) |
| `HEARTBEAT_MIN` | สรุปสถานะทุกกี่นาที (default 240, 0 = ปิด) |
| `STATE_FILE` | default `./signal-bot/data/signal-bot-state.json` |

---

## 6. รันบนเครื่อง

```bash
npm ci
npm run bot:once              # สแกน 1 รอบ พิมพ์สถานะทุกบอทแล้วออก (ไม่ส่ง Telegram)
npx tsx signal-bot/index.ts --once --send   # เหมือนบนแต่ส่งสรุปเข้า Telegram (ทดสอบ token/chat id)
npm run bot                   # รันค้าง Ctrl+C หยุด
```

ผล `--once` หน้าตาแบบนี้

```
BTCUSDT:1h:supertrend   state=FLAT last=HOLD price=76984.05 close=2026-09-15T09:59:59.999Z flip=SELL@2026-09-15T00:59:59.999Z bars=500
```

`state` = ทิศจากสัญญาณพลิกล่าสุด (LONG หลัง BUY, FLAT หลัง SELL) · `last` = สัญญาณของแท่งที่เพิ่งปิด · `flip` = สัญญาณพลิกล่าสุดและเวลา

---

## 7. Deploy บน VPS

```bash
# ครั้งแรก
git clone <repo> ~/Bot-trading-crypto && cd ~/Bot-trading-crypto
npm ci
cp signal-bot/.env.example signal-bot/.env && nano signal-bot/.env
npm run bot:once                      # ต้องเห็นสถานะครบทุกบอท ไม่มี ERROR

# pm2 (แนะนำ)
npm i -g pm2
pm2 start signal-bot/deploy/ecosystem.config.cjs
pm2 save && pm2 startup               # ทำตามคำสั่งที่ pm2 พิมพ์ให้ เพื่อรันเองหลัง reboot
pm2 logs signal-bot
pm2 restart signal-bot                # หลังแก้ signal-bot/.env

# systemd (ทางเลือก)
sudo cp signal-bot/deploy/signal-bot.service /etc/systemd/system/   # แก้ User/WorkingDirectory ก่อน
sudo systemctl daemon-reload && sudo systemctl enable --now signal-bot
journalctl -u signal-bot -f
```

อัปเดตโค้ด: `git pull && npm ci && pm2 restart signal-bot` — state ไม่หาย, ไม่ส่งสัญญาณซ้ำ

log ที่ควรเห็นหลังสตาร์ท

```
[boot] bots=BTCUSDT:1h:supertrend, … telegram=on state=…/data/signal-bot-state.json
[telegram] bot @your_signal_bot
[scan:startup] bots=3 groups=3 results=3 alerts=0 errors=0 210ms
[loop:1h] แท่งถัดไปปิด 15/09/2026, 18:00 → ตื่น 15/09/2026, 18:00
```

---

## 8. คำสั่ง Telegram

| คำสั่ง | ผล |
|---|---|
| `/status` | สถานะทุกบอทจากผลสแกนล่าสุด + paused/uptime/error ล่าสุด |
| `/scan` | สแกนใหม่เดี๋ยวนี้แล้วตอบ (ส่ง alert ตามกฎปกติ) |
| `/pause` | หยุดส่งแจ้งเตือน (ยังสแกน, ยังตอบ /status) |
| `/resume` | กลับมาส่ง |
| `/bots` | รายการบอทและพารามิเตอร์ที่ใช้จริง |
| `/help` | รายการคำสั่ง |

ข้อความอัตโนมัติ: สตาร์ท, หยุด, สัญญาณ BUY/SELL, heartbeat ตาม `HEARTBEAT_MIN`, error (ไม่เกิน 1/15 นาทีต่อข้อความ)

---

## 9. ตรวจสอบและปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `ต้องตั้ง env BOTS` | ยังไม่มี `signal-bot/.env` หรือ `BOTS` ว่าง (หรือรันจากโฟลเดอร์อื่นที่ไม่ใช่ root) |
| `strategy "xxx" ไม่รู้จัก` | สะกดผิด ดูรายชื่อใน `.env.example` |
| `Telegram getUpdates: Conflict` | token ถูกใช้โดยโปรแกรมอื่นอยู่ (เช่น freqtrade) → สร้างบอทใหม่ให้ตัวนี้ |
| บอทไม่ตอบคำสั่ง | chat id ไม่อยู่ใน allowlist ดู log `ปฏิเสธคำสั่งจาก chat …` แล้วเอา id นั้นใส่ `TELEGRAM_ALLOWED_CHAT_IDS` |
| `ยังไม่เห็นแท่ง … ครบทุกคู่ รอ 15s` | ปกติ Binance ปิดแท่งช้า ถ้าเกิดทุกรอบให้เพิ่ม `CLOSE_DELAY_SEC` |
| ไม่มีสัญญาณหลายวัน | ปกติสำหรับกลยุทธ์เทรดน้อย ใช้ `/status` ดู `พลิกล่าสุด` เทียบกับหน้า Klines |
| สัญญาณ TS กับ trade ของ freqtrade ไม่ตรงกัน | ดูข้อ 4 ใน `live-execution-plan-th.md` (entry ที่เปิดแท่งถัดไป, stoploss/ROI/protections ออกก่อนสัญญาณ) |

ตรวจว่าตรรกะสัญญาณยังตรงกับ Python (ทำทุกครั้งที่แก้ `lib/indicators.ts`)

```bash
npm run dump:live     # → freqtrade/fixtures/*.live.csv (confirmed pivots)
cd ft && python user_data/scripts/compare_with_ts.py fixtures/BTCUSDT-1h.json fixtures/BTCUSDT-1h.live.csv --mode live
# ต้อง PASS และไม่มีบรรทัด CHANGED
```
