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

## กฎของสตรีมสัญญาณ: สลับเปิด–ปิดเสมอ

กลยุทธ์ทุกตัวทุกเวอร์ชันส่งสัญญาณผ่าน `STRATEGY_FNS` ใน [`lib/backtest.ts`](lib/backtest.ts)
ซึ่งบังคับกฎเดียวกันหมด: **หลังสัญญาณซื้อ สัญญาณถัดไปเป็นได้แค่สัญญาณขาย และกลับกัน**

| ประเภท | ลำดับที่เป็นไปได้ |
|---|---|
| Spot ทางเดียว (v1, v2) | `BUY → SELL → BUY → SELL` เท่านั้น · สัญญาณขายที่มาก่อนการซื้อครั้งแรกถูกตัดทิ้ง |
| สองทาง (v3) | ต้องปิดก่อนเปิดใหม่ (`BUY → SELL → SHORT → COVER`) หรือพลิกข้างตรง ๆ (`BUY → SHORT`) แต่เปิดซ้ำทางเดิมโดยยังไม่ปิดไม่ได้ |

**ทำไม**: ตัวสร้างสัญญาณส่วนใหญ่ตอบว่า "เงื่อนไขเป็นจริงไหม" ไม่ใช่ "ควรลงมือไหม"
RSI ต่ำกว่า 30 ติดกัน 78 แท่งจึงเคยกลายเป็น BUY 78 ครั้งติดกัน
วัดบน BTCUSDT 30m เต็มปีก่อนแก้: **17 จาก 57 กลยุทธ์ส่งสัญญาณซ้ำฝั่ง รวม 11,836 ครั้ง**
หลังแก้เหลือ 0 ทั้ง v1 และ v2 ส่วน v3 ไม่ถูกกระทบเพราะสิ่งที่ดูเหมือนซ้ำของมัน
คือคู่ปิด→เปิด (วัดได้ 33/33 และ 32/32) ซึ่งถูกต้องตามดีไซน์สองทางอยู่แล้ว

**ผลตอบแทนไม่เปลี่ยนแม้แต่กลยุทธ์เดียว (0 จาก 57)** เพราะตัวจำลองเมินคำสั่งซื้อซ้ำตอนถือของอยู่แล้ว
กฎนี้จึงไม่ได้ทำให้กำไรขึ้น แต่ทำให้สิ่งที่ **คนกับบอทเห็น** ตรงกับสิ่งที่ระบบทำจริง —
คอลัมน์สัญญาณในเว็บ ไฟล์ Export และการแจ้งเตือน Telegram ของ `signal-bot/`

สคริปต์ที่ใช้วัด: [`signal-alternation.ts`](signal-bot/web%20ui/research/signal-alternation.ts)
(นับการละเมิดของทุกกลยุทธ์) และ [`signal-alternation-policy.ts`](signal-bot/web%20ui/research/signal-alternation-policy.ts)
(เทียบนโยบายเลือกสัญญาณในชุดที่ซ้ำกัน)

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
