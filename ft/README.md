# ft/ — freqtrade port ของ lib/indicators.ts + lib/backtest.ts

คู่มือใช้งาน: [`../docs/freqtrade-runbook-th.md`](../docs/freqtrade-runbook-th.md) · แผนงาน: [`../docs/freqtrade-migration-plan-th.md`](../docs/freqtrade-migration-plan-th.md)

```
ft/
├─ docker-compose.yml            ft-1h, ft-4h (trade) + freqtrade (คำสั่งครั้งเดียว)
├─ fixtures/                     klines 1000 แท่ง สำหรับ harness (json) + ผล dump ฝั่ง TS (csv)
└─ user_data/
   ├─ config.json                ค่ากลาง
   ├─ config.1h.json / 4h.json   override ต่อ instance (timeframe, whitelist, db, pair_strategy_map)
   ├─ strategies/
   │  ├─ ta_port/indicators.py   พอร์ต 1:1 จาก lib/indicators.ts (ผ่าน harness แล้ว)
   │  ├─ ta_port/signals.py      พอร์ต STRATEGY_FNS จาก lib/backtest.ts
   │  ├─ BaseSignalStrategy.py   strategy แม่ เลือกกฎต่อคู่จาก config
   │  └─ *Strategy.py            subclass 10 ตัว ใช้กับ backtest/hyperopt ทีละกลยุทธ์
   └─ scripts/compare_with_ts.py harness เทียบผล TS ↔ Python
```

## Harness (เฟส 1–2)

```bash
# ฝั่ง TS (รันจาก root ของ repo)
npm install
npm run dump                      # → ft/fixtures/*.ts.csv

# ฝั่ง Python (ต้องมี numpy + pandas; ไม่ต้องมี TA-Lib)
cd ft
python user_data/scripts/compare_with_ts.py fixtures/BTCUSDT-1h.json fixtures/BTCUSDT-1h.ts.csv --mode ts
python user_data/scripts/compare_with_ts.py fixtures/BTCUSDT-1h.json fixtures/BTCUSDT-1h.ts.csv --mode live
```

- `--mode ts` ต้อง `PASS` ทุกคอลัมน์ = พอร์ตถูก 1:1
- `--mode live` คอลัมน์ของ S/R, Trendlines, SMC จะขึ้น `CHANGED` = ต่างโดยตั้งใจ (แก้ lookahead) ส่วนที่เหลือต้อง `OK`

## freqtrade (เฟส 3–4)

```bash
cd ft
docker compose pull
docker compose run --rm freqtrade list-strategies
docker compose run --rm freqtrade download-data --config user_data/config.json \
  --exchange binance --pairs BTC/USDT ETH/USDT SOL/USDT -t 1h 4h --days 730

docker compose run --rm freqtrade backtesting --config user_data/config.json -i 1h --timerange 20250101- \
  --strategy-list SupertrendStrategy CdcActionZoneStrategy UtBotStrategy CmMacdStrategy RsiStrategy SqueezeMomentumStrategy MsbObStrategy

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
