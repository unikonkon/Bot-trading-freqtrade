# freqtrade/ — ตัวยิงออเดอร์ (dry-run/live) + Telegram bot A

ทุกอย่างที่เกี่ยวกับ freqtrade อยู่ในโฟลเดอร์นี้: compose, config, strategy ที่พอร์ตจาก `lib/`, harness, สคริปต์ TS ฝั่ง freqtrade และเอกสาร
โฟลเดอร์ `lib/` และ `api/` ที่ root ใช้ร่วมกับ `signal-bot/` · **รันคำสั่ง docker ในโฟลเดอร์นี้ · รันคำสั่ง npm ที่ root ของ repo**

| เอกสาร | เนื้อหา |
|---|---|
| [`freqtrade-runbook-th.md`](./freqtrade-runbook-th.md) | ระบบทำงานอย่างไร · ต้องมีอะไร · รันอย่างไร · ดูผลที่ไหน · Telegram bot A |
| [`freqtrade-migration-plan-th.md`](./freqtrade-migration-plan-th.md) | แผนงานพอร์ต 6 เฟสและสถานะ |
| [`backtest-results-202609.md`](./backtest-results-202609.md) | ผล backtest/lookahead ล่าสุด |
| [`port-diff-notes.md`](./port-diff-notes.md) | ความต่างของ indicator ที่พอร์ตและผล harness |
| [`../signal-bot/live-execution-plan-th.md`](../signal-bot/live-execution-plan-th.md) | แผนช่วงเงินจริง: freqtrade ยิงออเดอร์ + signal-bot แจ้งเตือนคู่ขนาน |

```
freqtrade/
├─ docker-compose.yml            ft-1h (trade) + freqtrade (คำสั่งครั้งเดียว) + ft-web (FreqUI backtest)
├─ fixtures/                     klines 1000 แท่ง สำหรับ harness (json) + ผล dump ฝั่ง TS (csv, gitignore)
├─ scripts/
│  ├─ dump-indicators.ts         harness ฝั่ง TS: dump indicator ทุกคอลัมน์ (--mode ts|live)
│  └─ backtest-count.ts          เทียบจำนวน trade ของ backtest.ts กับ freqtrade
└─ user_data/
   ├─ config.json                ค่ากลาง (dry_run, stake, exchange, telegram = bot A, api_server, strategy_params)
   ├─ config.1h.json             override ของ instance (timeframe, whitelist, db, pair_strategy_map)
   ├─ config.web.json            FreqUI โหมด webserver
   ├─ strategies/
   │  ├─ ta_port/indicators.py   พอร์ต 1:1 จาก lib/indicators.ts (ผ่าน harness แล้ว)
   │  ├─ ta_port/signals.py      พอร์ต STRATEGY_FNS จาก lib/backtest.ts
   │  ├─ BaseSignalStrategy.py   strategy แม่ เลือกกฎต่อคู่จาก config
   │  └─ *Strategy.py            subclass 10 ตัว ใช้กับ backtest/hyperopt ทีละกลยุทธ์
   └─ scripts/compare_with_ts.py harness เทียบผล TS ↔ Python
```

## Telegram bot A (ของ freqtrade)

freqtrade มี Telegram ในตัว ไม่ต้องเขียนโค้ด ตั้งใน `user_data/config.json` (หรือ `config.local.json` ที่ gitignore)

```json
"telegram": { "enabled": true, "token": "<token ของ bot A>", "chat_id": "<chat id>" }
```

- หน้าที่: แจ้ง trade เปิด/ปิด, สตาร์ท/หยุด, error และรับคำสั่งที่ **กระทบเงิน**: `/start` `/stop` `/status` `/profit` `/balance` `/forceexit all` `/reload_config` (รายการเต็มในคู่มือข้อ 4.6)
- **ต้องเป็นบอทคนละตัวกับ bot B ของ `signal-bot/`** (token เดียวกัน poll จากสองโปรแกรมพร้อมกันไม่ได้) ส่งเข้า chat/กลุ่มเดียวกันได้
- ถ้าต้องการให้ Next.js สั่งงาน ใช้ REST API ผ่าน `api/freqtrade/route.ts` (ตอนนี้อ่านอย่างเดียว)

## Harness (เฟส 1–2)

```bash
# ฝั่ง TS (รันจาก root ของ repo)
npm install
npm run dump                      # → freqtrade/fixtures/*.ts.csv   (confirmedPivots=false ใช้กับ --mode ts)
npm run dump:live                 # → freqtrade/fixtures/*.live.csv (confirmedPivots=true  ใช้กับ --mode live)

# ฝั่ง Python (ต้องมี numpy + pandas; ไม่ต้องมี TA-Lib)
cd ft
python user_data/scripts/compare_with_ts.py fixtures/BTCUSDT-1h.json fixtures/BTCUSDT-1h.ts.csv --mode ts
python user_data/scripts/compare_with_ts.py fixtures/BTCUSDT-1h.json fixtures/BTCUSDT-1h.ts.csv --mode live
```

- `--mode ts` ต้อง `PASS` ทุกคอลัมน์ = พอร์ตถูก 1:1
- `--mode live` ใช้กับไฟล์ `*.live.csv` ต้อง `PASS` และ **ไม่มี** `CHANGED` (ตั้งแต่ 15 ก.ย. 2026 TS มี confirmed pivot ตรงกับ Python แล้ว); ถ้าเอา `*.ts.csv` มาเทียบโหมดนี้จะเห็น `CHANGED` 9 คอลัมน์ซึ่งคือความต่างของโหมดเก่า

## freqtrade (เฟส 3–4)

```bash
cd ft
docker compose pull
docker compose run --rm freqtrade list-strategies
docker compose run --rm freqtrade download-data --config user_data/config.json \
  --exchange binance --pairs BTC/USDT ETH/USDT SOL/USDT -t 1h 4h --days 730

docker compose run --rm freqtrade backtesting --config user_data/config.json -i 1h --timerange 20250101- \
  --strategy-list SupertrendStrategy CdcActionZoneStrategy RsiStrategy MsbObStrategy

docker compose run --rm freqtrade lookahead-analysis --config user_data/config.json -i 1h --timerange 20250101- --strategy SmcStrategy
docker compose run --rm freqtrade recursive-analysis --config user_data/config.json -i 1h --timerange 20250101- \
  --strategy CdcActionZoneStrategy -p BTC/USDT --startup-candle 100 300 500
docker compose run --rm freqtrade hyperopt --config user_data/config.json -i 1h --timerange 20250101- \
  --strategy SupertrendStrategy --spaces roi stoploss trailing --hyperopt-loss SharpeHyperOptLoss -e 300
```

## รันจริง (เฟส 6)

1. แก้ `user_data/config.json`: `api_server.password`, `jwt_secret_key`, `ws_token`, telegram/discord
2. `dry_run: true` ก่อนเสมอ → `docker compose up -d` → `docker compose logs -f ft-1h`
3. ก่อน live: ใส่ `exchange.key/secret` (สิทธิ์ Spot เท่านั้น + IP whitelist ของ VPS), `dry_run: false`, ลด `stake_amount`

ไฟล์ที่ห้าม commit: `user_data/*.sqlite*`, `user_data/logs/`, `user_data/data/`, และ config ที่มี key จริง (ดู `.gitignore`)
