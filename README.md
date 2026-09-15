# Bot-trading-crypto

โครงสร้าง 3 ส่วน แยกชัดเจน

```
lib/          ไลบรารีใช้ร่วม: indicators.ts (10 ตัว), backtest.ts (กฎสัญญาณ + computeSignals), types/
api/          Next.js route ใช้ร่วม: klines (proxy Binance ให้แดชบอร์ด), freqtrade (proxy REST อ่านอย่างเดียว)
freqtrade/    ตัวยิงออเดอร์ dry-run/live + Telegram bot A (trade เปิด/ปิด, /stop, /forceexit) — Python/Docker
signal-bot/   บอทสัญญาณเขียนเอง + Telegram bot B (BUY/SELL ทุกแท่ง, /pause /resume) — TypeScript ไม่ยิงออเดอร์
```

| ส่วน | เริ่มอ่านที่ |
|---|---|
| `freqtrade/` | [`freqtrade/README.md`](freqtrade/README.md) → [`freqtrade-runbook-th.md`](freqtrade/freqtrade-runbook-th.md) |
| `signal-bot/` | [`signal-bot/README.md`](signal-bot/README.md) |
| ทั้งสองระบบอยู่ร่วมกันตอนเงินจริง | [`signal-bot/live-execution-plan-th.md`](signal-bot/live-execution-plan-th.md) |

กฎข้อเดียว: **ระบบที่ตัดสินใจและยิงออเดอร์มีระบบเดียวคือ freqtrade** `signal-bot/` ไม่มี Binance key และไม่มีโค้ดยิงออเดอร์

## คำสั่ง (รันที่ root ของ repo)

```bash
npm ci
cp signal-bot/.env.example signal-bot/.env   # ใส่ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (bot B) / BOTS
npm run bot:once                # signal-bot: สแกน 1 รอบ ดูสถานะ
npm run bot                     # signal-bot: รันค้าง (บน VPS ใช้ pm2 ตาม signal-bot/deploy/)
npm run check:sync              # BOTS ของ signal-bot ตรงกับ pair_strategy_map ของ freqtrade ไหม
npm run dump && npm run dump:live   # harness เทียบ lib/ ↔ freqtrade/ta_port (ดู freqtrade/README.md)
npm run typecheck
cd freqtrade && docker compose up -d ft-1h     # freqtrade dry-run (ดู freqtrade/freqtrade-runbook-th.md)
```
