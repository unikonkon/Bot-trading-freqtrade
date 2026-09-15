# คู่มือใช้งาน: บอทเทรดบน freqtrade (ta_port)

> เวอร์ชัน 1.0 — ก.ย. 2026
> เอกสารนี้ตอบ 4 คำถาม: **ระบบทำงานอย่างไร · ต้องมีอะไรบ้าง · รันอย่างไร · เปิดดูผลที่ไหน**
> แผนงานและเหตุผลการออกแบบอยู่ใน [`freqtrade-migration-plan-th.md`](./freqtrade-migration-plan-th.md) · ผลทดสอบล่าสุดอยู่ใน [`backtest-results-202609.md`](./backtest-results-202609.md)

---

## 1. ระบบทำงานอย่างไร

### 1.1 ภาพรวม

```
 ทุก ~5 วินาที (process_throttle_secs)
 ┌────────────────────────────────────────────────────────────────────────┐
 │ freqtrade (container ft-1h)                                             │
 │                                                                         │
 │  1. ดึงแท่งเทียนล่าสุดของทุกคู่ใน pair_whitelist จาก Binance (public)     │
 │  2. เมื่อมีแท่งใหม่ปิด → เรียก BaseSignalStrategy.populate_indicators     │
 │       └─ ดู pair_strategy_map ว่าคู่นี้ใช้กฎอะไร เช่น BTC/USDT → supertrend │
 │       └─ เรียก ta_port.signals.STRATEGY_FNS["supertrend"](df, params)     │
 │            └─ ta_port.indicators.supertrend(df) → BUY / SELL / HOLD      │
 │  3. signal == 1  → enter_long  → เปิด trade (market order)                │
 │     signal == -1 → exit_long   → ปิด trade                                │
 │     stoploss / ROI / trailing / protections ทำงานคู่ขนานทุกรอบ            │
 │  4. บันทึก trade ลง tradesv3-1h.sqlite                                    │
 │  5. แจ้งเตือน Telegram / Discord · เปิด REST API + FreqUI ที่พอร์ต 8080     │
 └────────────────────────────────────────────────────────────────────────┘
```

- **dry_run: true** → ทุกอย่างทำงานเหมือนจริงแต่ไม่ส่งออเดอร์ไป Binance ใช้กระเป๋าจำลอง `dry_run_wallet`
- **dry_run: false** → ส่งออเดอร์จริงด้วย `exchange.key` / `exchange.secret`
- หนึ่ง container = หนึ่ง timeframe (`ft-1h`, `ft-4h`) แต่ละตัวมี config, ฐานข้อมูล และพอร์ต API ของตัวเอง

### 1.2 ไฟล์ที่กำหนดพฤติกรรม

| ไฟล์ | หน้าที่ | แก้เมื่อ |
|---|---|---|
| `freqtrade/user_data/config.json` | ค่ากลาง: dry_run, stake, exchange key, Telegram, Discord, api_server, `strategy_params` | ตั้งค่าครั้งแรก, เปลี่ยน dry→live, เปลี่ยนพารามิเตอร์ indicator |
| `freqtrade/user_data/config.1h.json` | override ของ instance 1h: `pair_whitelist`, `pair_strategy_map`, `db_url`, พอร์ต | เพิ่ม/ลดคู่, เปลี่ยนว่าคู่ไหนใช้กฎอะไร |
| `freqtrade/user_data/config.4h.json` | เหมือนด้านบนสำหรับ 4h | |
| `freqtrade/user_data/strategies/BaseSignalStrategy.py` | strategy แม่: อ่าน map, เรียก ta_port, ตั้ง stoploss/ROI/protections | เปิด stoploss/ROI หลัง hyperopt |
| `freqtrade/user_data/strategies/ta_port/indicators.py` | สูตร indicator 10 ตัว (พอร์ตจาก `lib/indicators.ts`) | ไม่ควรแก้ ถ้าแก้ต้องรัน harness ใหม่ |
| `freqtrade/user_data/strategies/ta_port/signals.py` | กฎแปลง indicator → BUY/SELL (พอร์ตจาก `lib/backtest.ts`) | เพิ่มกลยุทธ์ใหม่ |
| `freqtrade/user_data/strategies/*Strategy.py` | subclass 10 ตัว ใช้ backtest/hyperopt ทีละกลยุทธ์ | ไม่ต้องแก้ |
| `freqtrade/docker-compose.yml` | รายการ container และพอร์ต | เพิ่ม instance timeframe ใหม่ |

### 1.3 กลยุทธ์ที่มีให้เลือก (`strategy_id`)

| strategy_id | กฎ | หมายเหตุ |
|---|---|---|
| `supertrend` | ATR band พลิกเทรนด์ → BUY/SELL | causal, ผ่าน harness 1:1 |
| `cdc_actionzone` | EMA12/26 แท่งเขียวแรก/แดงแรก | causal |
| `ut_bot` | ATR trailing stop ราคาตัดขึ้น/ลง | causal, เทรดถี่บน 1h |
| `cm_macd` | MACD ตัด signal line (SMA) | causal, เทรดถี่บน 1h |
| `rsi` | RSI < 30 ซื้อ, > 70 ขาย | causal |
| `squeeze_momentum` | โมเมนตัมข้ามศูนย์ | causal |
| `msb_ob` | ZigZag market structure break | causal |
| `support_resistance` | ทะลุแนวรับ/ต้าน + volume | pivot ยืนยันช้า 15 แท่ง (แก้ lookahead แล้ว) |
| `trendlines` | ทะลุเส้นเทรนด์ | pivot ยืนยันช้า 14 แท่ง |
| `smc` | BOS/CHoCH + premium/discount | pivot ยืนยันช้า 5/50 แท่ง |

พารามิเตอร์ของแต่ละตัวอยู่ใน `config.json → strategy_params` ชื่อเดียวกับใน `lib/backtest.ts` เช่น `supertrend: {atrPeriod: 10, multiplier: 3.0}`

---

## 2. ต้องมีอะไรบ้าง

### 2.1 ขั้นต่ำเพื่อรัน dry-run บนเครื่องตัวเอง

| สิ่งที่ต้องมี | ใช้ทำอะไร | ตรวจว่ามี |
|---|---|---|
| **Docker Desktop** (macOS/Windows) หรือ Docker Engine + Compose v2 (Linux) | รัน freqtrade ทั้งหมด ไม่ต้องติดตั้ง Python เอง | `docker compose version` |
| อินเทอร์เน็ตถึง `api.binance.com` | ดึงราคา (ไม่ต้องมี API key) | `curl -s https://api.binance.com/api/v3/ping` |
| พื้นที่ดิสก์ ~3 GB | image freqtrade ~1.5 GB + ข้อมูลแท่งเทียน | |
| RAM ว่าง ~1 GB | container ละ ~250 MB | |

### 2.2 เพิ่มเติมสำหรับงานพัฒนา (harness เทียบผล TS ↔ Python)

| สิ่งที่ต้องมี | ใช้ทำอะไร |
|---|---|
| Node.js 20+ และ `npm install` ที่ root โปรเจกต์ | รัน `freqtrade/scripts/dump-indicators.ts` (ฝั่ง TypeScript) |
| Python 3.11+ พร้อม `numpy`, `pandas` (หรือใช้ใน container ก็ได้) | รัน `compare_with_ts.py` |

### 2.3 เพิ่มเติมสำหรับเทรดจริง

| สิ่งที่ต้องมี | รายละเอียด |
|---|---|
| **VPS ที่มี static IP** | ผู้ให้บริการตามเอกสารออกแบบเดิม สเปก 2 vCPU / 4 GB |
| **Binance API key** | สร้างที่ Binance → API Management: เปิดเฉพาะ *Enable Spot & Margin Trading*, **ไม่เปิด Withdraw**, เลือก *Restrict access to trusted IPs only* ใส่ IP ของ VPS |
| ยอด USDT ใน Spot wallet | อย่างน้อย `stake_amount × max_open_trades` + ส่วนเผื่อ |
| **Telegram bot** (แนะนำอย่างยิ่ง) | สร้างกับ @BotFather ได้ `token`, หา `chat_id` จาก @userinfobot → ใส่ใน `config.json → telegram` |
| **Discord webhook** (ออปชัน) | Server → Channel → Integrations → Webhooks → Copy URL → `config.json → discord.webhook_url` |

---

## 3. รันอย่างไร

ทุกคำสั่งรันในโฟลเดอร์ `freqtrade/`

### 3.1 ครั้งแรก

```bash
cd ft
docker compose pull                                    # ดึง image freqtrade:stable
docker compose run --rm freqtrade list-strategies \
  --userdir /freqtrade/user_data --config /freqtrade/user_data/config.json
# ต้องเห็น BaseSignalStrategy + อีก 10 ตัว สถานะ OK
```

แก้ `user_data/config.json` ก่อนใช้จริง

| คีย์ | ต้องทำ |
|---|---|
| `api_server.username` / `password` | ตั้งรหัสของคุณ (ใช้ล็อกอิน FreqUI) |
| `api_server.jwt_secret_key` | สุ่มใหม่ ≥ 32 ตัวอักษร: `openssl rand -hex 32` |
| `api_server.ws_token` | สุ่มใหม่: `openssl rand -hex 16` |
| `telegram.enabled/token/chat_id` | ใส่ถ้าต้องการแจ้งเตือนและสั่งงานจากมือถือ |
| `discord.enabled/webhook_url` | ใส่ถ้าต้องการแจ้งเตือนเข้า Discord |
| `dry_run` | **คงเป็น `true`** จนกว่าจะผ่าน checklist ข้อ 5 |

### 3.2 ดาวน์โหลดข้อมูลและ backtest

```bash
docker compose run --rm freqtrade download-data --userdir /freqtrade/user_data \
  --config /freqtrade/user_data/config.json --exchange binance \
  --pairs BTC/USDT ETH/USDT SOL/USDT -t 1h 4h --days 730

# backtest ทีละกลยุทธ์หรือหลายตัวพร้อมกัน
docker compose run --rm freqtrade backtesting --userdir /freqtrade/user_data \
  --config /freqtrade/user_data/config.json -i 1h --timerange 20250101- \
  --pairs BTC/USDT ETH/USDT SOL/USDT \
  --strategy-list SupertrendStrategy CdcActionZoneStrategy MsbObStrategy

# backtest แบบเดียวกับที่จะรันจริง (ใช้ pair_strategy_map)
docker compose run --rm freqtrade backtesting --userdir /freqtrade/user_data \
  --config /freqtrade/user_data/config.json --config /freqtrade/user_data/config.1h.json \
  --timerange 20250101- --strategy BaseSignalStrategy
```

ตรวจความถูกต้องก่อนเชื่อผล

```bash
docker compose run --rm freqtrade lookahead-analysis --userdir /freqtrade/user_data \
  --config /freqtrade/user_data/config.json -i 1h --timerange 20250101- \
  --strategy-list SupertrendStrategy SmcStrategy --minimum-trade-amount 5
docker compose run --rm freqtrade recursive-analysis --userdir /freqtrade/user_data \
  --config /freqtrade/user_data/config.json -i 1h --timerange 20250101- \
  -p BTC/USDT --strategy CdcActionZoneStrategy --startup-candle 100 300 500
```

### 3.3 เลือกคู่และกลยุทธ์ที่จะรัน

แก้ `user_data/config.1h.json`

```json
{
  "exchange": { "pair_whitelist": ["BTC/USDT", "ETH/USDT", "SOL/USDT"] },
  "pair_strategy_map": {
    "BTC/USDT": "supertrend",
    "ETH/USDT": "cdc_actionzone",
    "SOL/USDT": "msb_ob"
  }
}
```

คู่ที่อยู่ใน whitelist แต่ไม่อยู่ใน map จะใช้ `strategy_id` ค่า default ของ BaseSignalStrategy (`supertrend`)

### 3.4 รัน dry-run

```bash
docker compose up -d                 # รัน ft-1h และ ft-4h
docker compose up -d ft-1h           # หรือรันแค่ตัวเดียว
docker compose logs -f ft-1h         # ดู log สด (Ctrl+C ออก)
docker compose ps                    # สถานะ container
docker compose restart ft-1h         # หลังแก้ config
docker compose down                  # หยุดทั้งหมด (trade ที่เปิดอยู่จะถูกจำใน sqlite และกู้คืนเมื่อรันใหม่)
```

log ที่ควรเห็นภายใน 1 นาทีแรก

```
Whitelist with 3 pairs: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']
Dry run is enabled. All trades are simulated.
Uvicorn running on http://0.0.0.0:8080
Bot heartbeat. PID=1, version='2026.8', state='RUNNING'
```

### 3.5 harness เทียบผลกับ TypeScript (เมื่อแก้ indicators.py)

```bash
# ที่ root โปรเจกต์
npm install
npm run dump          # → freqtrade/fixtures/*.ts.csv   (confirmedPivots=false เทียบกับ --mode ts)
npm run dump:live     # → freqtrade/fixtures/*.live.csv (confirmedPivots=true  เทียบกับ --mode live = ค่าที่ใช้จริง)
cd ft
docker compose run --rm --entrypoint python freqtrade \
  /freqtrade/user_data/scripts/compare_with_ts.py /fixtures/BTCUSDT-1h.json /fixtures/BTCUSDT-1h.ts.csv --mode ts
docker compose run --rm --entrypoint python freqtrade \
  /freqtrade/user_data/scripts/compare_with_ts.py /fixtures/BTCUSDT-1h.json /fixtures/BTCUSDT-1h.live.csv --mode live
```

ต้องได้ `PASS` ทุกคอลัมน์ทั้งสองโหมด และโหมด live ต้อง**ไม่มี** บรรทัด `CHANGED` (ตั้งแต่ 15 ก.ย. 2026 TS มี confirmed pivot แล้ว) ถ้าไม่ผ่านห้าม deploy ทั้ง freqtrade และบอท TS

---

## 4. เปิดดูผลที่ไหน

### 4.1 FreqUI (หน้าเว็บของ freqtrade)

| | |
|---|---|
| URL บนเครื่องที่รัน | http://127.0.0.1:8080 (ft-1h) · http://127.0.0.1:8081 (ft-4h) |
| จาก VPS | พอร์ตผูกกับ 127.0.0.1 เท่านั้น เปิดผ่าน SSH tunnel: `ssh -L 8080:127.0.0.1:8080 user@VPS_IP` แล้วเข้า http://127.0.0.1:8080 บนเครื่องตัวเอง |
| ล็อกอิน | `api_server.username` / `password` จาก config.json |
| ดูอะไรได้ | trade ที่เปิดอยู่, ประวัติ, กำไรรวม, กราฟพร้อมจุดเข้าออก, ปุ่ม stop/start, force exit, ดู log |

FreqUI ติดมากับ Docker image แล้ว ไม่ต้อง `install-ui`

### 4.2 REST API (ใช้กับ script หรือแดชบอร์ด Next.js)

```bash
U=ft; P=รหัสผ่านใน-config
curl -s -u $U:$P http://127.0.0.1:8080/api/v1/ping
curl -s -u $U:$P http://127.0.0.1:8080/api/v1/status      | jq   # trade ที่เปิดอยู่
curl -s -u $U:$P http://127.0.0.1:8080/api/v1/profit      | jq   # สรุปกำไร
curl -s -u $U:$P http://127.0.0.1:8080/api/v1/trades?limit=20 | jq
curl -s -u $U:$P http://127.0.0.1:8080/api/v1/balance     | jq
curl -s -u $U:$P http://127.0.0.1:8080/api/v1/show_config | jq
```

ฝั่ง Next.js มี proxy อ่านอย่างเดียวที่ `api/freqtrade/route.ts` ตั้ง env `FREQTRADE_URL`, `FREQTRADE_USER`, `FREQTRADE_PASS` แล้วเรียก `GET /api/freqtrade?path=status`

### 4.3 Log

| ที่ | คำสั่ง / path |
|---|---|
| log สดของ container | `docker compose logs -f ft-1h` |
| ไฟล์ log | `freqtrade/user_data/logs/ft-1h.log` (หมุนอัตโนมัติ) |
| ค้นหาสัญญาณ | `grep "signal found" freqtrade/user_data/logs/ft-1h.log` |
| ค้นหา error | `grep -i "error\|exception" freqtrade/user_data/logs/ft-1h.log` |

### 4.4 ฐานข้อมูล trade

- `freqtrade/user_data/tradesv3-1h.sqlite`, `tradesv3-4h.sqlite` (dry-run และ live ใช้ไฟล์เดียวกันตาม `db_url`; ถ้าอยากแยกให้เปลี่ยน `db_url` ก่อน live)
- ดูด้วย `docker compose run --rm freqtrade show-trades --userdir /freqtrade/user_data --config /freqtrade/user_data/config.json --config /freqtrade/user_data/config.1h.json --print-json`
- หรือเปิดด้วย DB Browser for SQLite / `sqlite3` ตาราง `trades`, `orders`

### 4.5 ผล backtest และ hyperopt

- ตารางแสดงใน terminal ทันทีที่รันจบ
- ไฟล์: `freqtrade/user_data/backtest_results/` (เมื่อใส่ `--export trades`) และ `freqtrade/user_data/hyperopt_results/`
- ดูย้อนหลัง: `docker compose run --rm freqtrade backtesting-show --userdir /freqtrade/user_data --export-filename user_data/backtest_results/<ไฟล์>.json`
- **backtest ผ่านหน้าเว็บ:** แท็บ Backtesting ของ FreqUI ใช้ได้เฉพาะโหมด `webserver` (container `ft-1h` ที่รันโหมด `trade` จะไม่ให้กด) → `docker compose up -d ft-web` แล้วเข้า http://127.0.0.1:8082 ล็อกอินด้วย username/password เดียวกัน
  1. แท็บ **Backtesting** → **Run backtest**
  2. เลือก Strategy (เช่น SupertrendStrategy หรือ BaseSignalStrategy), Timeframe, Timerange (หรือ Days), Max open trades, Stake amount, และคู่จาก whitelist ของ `config.web.json`
  3. กด **Start backtest** → รอ progress → ผลแสดงในหน้าเดียวกัน: สรุปกำไร, ต่อคู่, ต่อ enter tag, ตาราง trade ทุกไม้
  4. แท็บย่อย **Visualize results** ดูกราฟพร้อมจุดเข้าออก; **Load results** เปิดผลที่เคยรัน (ไฟล์ใน `user_data/backtest_results/`)
  - ข้อมูลต้อง `download-data` ไว้ก่อน (ข้อ 3.2) คู่/timeframe ที่ไม่มีข้อมูลจะไม่ขึ้นให้เลือก
  - hyperopt, lookahead-analysis, recursive-analysis ไม่มีในหน้าเว็บ ต้องใช้ CLI

### 4.6 Telegram (เมื่อเปิดใน config)

| คำสั่ง | ผล |
|---|---|
| `/status` | trade ที่เปิดอยู่ |
| `/profit` | กำไรรวม |
| `/daily` | กำไรรายวัน |
| `/balance` | ยอดกระเป๋า |
| `/stop` | หยุดเปิด trade ใหม่ (trade เดิมยังจัดการต่อ) |
| `/start` | กลับมาทำงาน |
| `/forceexit all` | ปิดทุก trade ทันที |
| `/reload_config` | โหลด config ใหม่โดยไม่รีสตาร์ท |
| `/logs` | log ล่าสุด |

บอทจะส่งข้อความเองเมื่อ เปิด/ปิด trade, สตาร์ท, หยุด, และ error

### 4.7 Discord (เมื่อเปิดใน config)

ข้อความ entry_fill และ exit_fill ส่งเข้า channel ของ webhook อัตโนมัติ (อ่านอย่างเดียว สั่งงานไม่ได้ ใช้ Telegram หรือ FreqUI แทน)

---

## 5. เปลี่ยนจาก dry-run เป็นเทรดจริง

ทำตามลำดับ ห้ามข้าม

1. dry-run บน VPS ต่อเนื่องอย่างน้อย 2 สัปดาห์ ผลใกล้เคียง backtest
2. ทดสอบ `docker compose restart ft-1h` ระหว่างมี trade เปิด แล้วดูว่า `/status` ยังเห็น trade เดิม
3. ใน `config.json`
   - `exchange.key`, `exchange.secret` จาก Binance (สิทธิ์ Spot เท่านั้น + IP whitelist)
   - `dry_run: false`
   - `stake_amount` เริ่ม 10–20 USDT, `max_open_trades` 1–2
   - `db_url` ใน config.1h.json ชี้ไฟล์ใหม่ เช่น `tradesv3-1h-live.sqlite`
4. `telegram.enabled: true` และทดสอบ `/stop` ได้จากมือถือ
5. `docker compose up -d` แล้วเฝ้า log 1 ชั่วโมงแรก
6. ตั้ง backup รายวัน: `cp freqtrade/user_data/*.sqlite <ที่เก็บนอกเครื่อง>` ผ่าน cron

---

## 6. ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop ยังไม่เปิด → เปิดแล้วรอ 10 วินาที |
| `Setting 'protections' in the configuration is deprecated` | freqtrade ≥ 2024 ต้องใส่ใน strategy (ทำแล้วใน BaseSignalStrategy) ห้ามใส่ใน config |
| `'...' is too short` ที่ `jwt_secret_key` | ต้องยาว ≥ 32 ตัวอักษร |
| `Market entry orders require entry_pricing.price_side = "other"` | ตั้ง `entry_pricing.price_side` และ `exit_pricing.price_side` เป็น `"other"` |
| `freqtrade: error: argument command: invalid choice: 'python'` | image ใช้ entrypoint `freqtrade` → ใช้ `docker compose run --rm --entrypoint python freqtrade …` |
| `unknown strategy_id 'xxx' for BTC/USDT` | ชื่อใน `pair_strategy_map` สะกดผิด ดูรายชื่อในข้อ 1.3 |
| ไม่มี trade เกิดขึ้นเลยหลายวัน | ปกติสำหรับกลยุทธ์ที่เทรดน้อย ตรวจ `grep "signal" logs` และเทียบกับหน้า Klines ของ Next.js |
| Binance error `-2015 Invalid API-key, IP, or permissions` | IP whitelist ไม่ตรงกับ IP ขาออกของ VPS หรือ key ไม่มีสิทธิ์ Spot |
| ค่าใน FreqUI ไม่ตรงกับ backtest | ดู `recursive-analysis` และเทียบ `startup_candle_count`; ถ้าต่างมากให้หยุดและตรวจ |

---

## 7. ไฟล์ที่ห้าม commit / ห้ามแชร์

- `freqtrade/user_data/config.json` ที่ใส่ key จริงแล้ว (แนะนำคัดลอกเป็น `config.local.json` ซึ่งอยู่ใน `.gitignore` แล้วชี้ใน compose)
- `freqtrade/user_data/*.sqlite*` ประวัติ trade
- `freqtrade/user_data/logs/` และ `freqtrade/user_data/data/`
- token ของ Telegram / Discord และ Binance API secret
