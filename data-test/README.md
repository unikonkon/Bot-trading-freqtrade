# BTCUSDT — ข้อมูลย้อนหลังสำหรับทดสอบ

ข้อมูลมาจาก **Binance Spot** ผ่าน `api/klines/route.ts` โดยไม่มี API key หรือคำสั่งซื้อขาย

| Timeframe | ช่วงทดสอบ |
|---|---|
| 1m, 3m, 5m, 15m, 30m | ย้อนหลัง 1 ปีปฏิทิน |
| 1h, 2h, 4h, 1d | ย้อนหลัง 2 ปีปฏิทิน |

ทุกชุดใช้ `asOf` ร่วมกัน ณ เริ่มดาวน์โหลด เลือกเฉพาะแท่ง UTC ที่เปิดอยู่ภายในช่วงที่ขอและปิดสมบูรณ์ก่อน `asOf` แท่งที่คร่อมขอบช่วงจะไม่รวม จึงอาจน้อยกว่าตัวเลขประมาณ 365/730 วันหนึ่งแท่ง มีข้อมูล **warmup อีก 1,000 แท่ง** ก่อนช่วงทดสอบเก็บแยก ไม่ใช่ส่วนของผลตอบแทนช่วงทดสอบ

## ดาวน์โหลดและ Resume

รันจาก root ของโปรเจกต์:

```bash
# Terminal 1: HTTP adapter ของ api/klines/route.ts
npm run history:api

# Terminal 2: snapshot ID เดิม = โหลดต่อ; ID ใหม่ = ตรึงช่วงเวลาใหม่
npm run history:download -- btcusdt-20260917
```

ค่าเริ่มต้น adapter: `http://127.0.0.1:4311/api/klines` สามารถใช้ route ของ Web UI ที่พอร์ต 4310 แทนโดยกำหนด `KLINES_URL=http://127.0.0.1:4310/api/klines` ให้ตัวดาวน์โหลด ไม่เรียก Binance ข้าม route

คำขอทำทีละหน้า สูงสุด 1,000 แท่ง พักประมาณ 2 วินาทีพร้อม jitter เล็กน้อย ทุก process ของ adapter มีคิวร่วมระหว่างคำขอ และพักเพิ่มเมื่อ `X-MBX-USED-WEIGHT-1M` สูงถึงงบอนุรักษนิยม 500 ไม่ใช่เพดาน Binance ที่ประกาศไว้

เมื่อเจอ 429/418 จะพักตาม `Retry-After` และเก็บ cooldown ไว้บนดิสก์ การใช้ IP ร่วมกับโปรแกรมอื่นยังอาจกระทบโควตาได้ การเปลี่ยนตัวคูณเวลาเพื่อดึงเร็วขึ้นไม่ได้อยู่ในคำสั่งนี้

ข้อกำหนดที่ใช้: [Binance Kline API](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market) ระบุสูงสุด 1,000 แท่งต่อคำขอและน้ำหนัก 2; [Binance IP limits](https://developers.binance.com/en/docs/products/spot/rest-api#ip-limits) ระบุให้พักตาม `Retry-After` เมื่อได้รับ 429/418 (ตรวจเอกสารวันที่ 17 กันยายน 2026)

- กด Ctrl+C เพื่อหยุด แล้วรัน snapshot ID เดิมเพื่อ Resume
- เขียน `.partial` และ sync ก่อนเลื่อน checkpoint; ถ้ามีท้ายไฟล์ที่เขียนค้าง จะตัดกลับเฉพาะส่วนที่ยังไม่ commit
- ตรวจทุกแถวว่าต่อเนื่องและไม่ซ้ำ; หากพบข้อมูลขาดจะหยุดพร้อมรักษา checkpoint ไม่เติมแท่งสมมติ
- ชุดย่อยที่โหลดเสร็จจะตรวจ checksum และเปลี่ยนชื่อเป็น `.jsonl` ก่อนแสดงว่าพร้อมในเว็บ
- ตรวจและล้าง lock ของ process ที่ไม่อยู่แล้วอัตโนมัติ; ไม่ให้โหลด snapshot เดียวกันซ้อน
- snapshot ที่เสร็จแล้วรันซ้ำจะตรวจไฟล์เดิมโดยไม่ขอข้อมูลใหม่

## โครงสร้าง

```text
BTCUSDT/<snapshot-id>/
  manifest.json                     # ช่วงเวลา จำนวนแท่ง SHA-256 สถานะทุก timeframe
  progress.json                     # ความคืบหน้าหน้าล่าสุดและจำนวน retries ของ process ปัจจุบัน
  BTCUSDT-1m.jsonl                   # ช่วงทดสอบ; อีก 8 timeframe รูปแบบเดียวกัน
  warmup/BTCUSDT-1m.jsonl            # ประวัติก่อนช่วงทดสอบ 1,000 แท่ง
  *.partial / *.checkpoint.json     # ไฟล์ระหว่างทำงานและจุด Resume
  verification.json                 # ผลตรวจครบ 9 ชุด
  benchmark-<timeframe>.json         # ผลวัดความเร็วบนเครื่องที่รัน
```

ไฟล์ตลาดขนาดใหญ่ถูกยกเว้นจาก Git แต่ยังอยู่ในเครื่องครบตาม path ข้างต้น

## ตรวจข้อมูล

```bash
npm run history:verify -- btcusdt-20260917
npm run history:benchmark -- btcusdt-20260917 1m
npm run history:test
npm run web:check
npm run web:test
```

Verifier ตรวจครบ 9 timeframe, OHLC, Volume, เวลา, แท่งซ้ำ/ช่องว่าง, จำนวนแท่งและ SHA-256 โดยไม่เรียก API

## รูปแบบที่ indicators.ts รับได้

JSONL หนึ่งบรรทัดเป็น `KlineData` ตาม `lib/types/kline.ts` ราคาและปริมาณเป็น string; เวลาเป็น UNIX milliseconds; `numberOfTrades` เป็น number

```ts
import { readBars } from "./scripts/history-storage";
import { rsi } from "./lib/indicators";
import type { KlineData } from "./lib/types/kline";

const klines: KlineData[] = [];
for await (const bar of readBars("data-test/BTCUSDT/btcusdt-20260917/BTCUSDT-1h.jsonl")) {
  klines.push(bar);
}
const values = rsi(klines.map(bar => Number(bar.close)), 14);
```

ตัวอย่างนี้แสดงการอ่านไฟล์โดยตรง หากต้องการทดสอบพร้อม warmup และตรวจ checksum ให้ใช้ `validate()` + `loadData()` ใน `signal-bot/web ui/data.ts` ด้วย `source: "local"`, `snapshot`, `symbol`, `interval` และค่าทดสอบตาม Web UI

## Web UI

```bash
npm run web:ui
```

เปิด `http://127.0.0.1:4310` → **ไฟล์ย้อนหลังในเครื่อง** → เลือก snapshot / timeframe → ทดสอบครบช่วง หรือระบุช่วงวันที่ → รันทดสอบ

- ปุ่ม **ตรวจชุดข้อมูลล่าสุด** อัปเดตสถานะระหว่างดาวน์โหลด; เฉพาะ timeframe ที่ข้อมูลหลักและ warmup เสร็จแล้วจึงรันได้
- โหลดไฟล์และตรวจ checksum ใน worker process; ระหว่างทดสอบออฟไลน์ไม่มีการขอข้อมูล Binance
- ผลทดสอบใช้แท่งจริงทั้งหมดในช่วงที่เลือก คงสถานะอินดิเคเตอร์และพอร์ตต่อเนื่องตลอดช่วง ไม่แบ่งคำนวณใหม่ทุกหน้ากราฟ
- ส่งกราฟและค่ารายแท่งครั้งละไม่เกิน 2,000 แท่ง; ใช้ **ชุดก่อนหน้า/ชุดถัดไป/ไปยังแท่งที่** เพื่อเปิดช่วงอื่น
- แสดงรายการเทรดครั้งละ 25 รายการ; กราฟ Equity ย่อเพื่อแสดงภาพรวม ส่วนสถิติใช้ทุกแท่ง
- ยกเลิกงานระหว่างคำนวณได้; เริ่มรอบใหม่จะแทนที่ worker รอบเก่าเพื่อจำกัดหน่วยความจำ ผลที่ไม่ได้ใช้งานหมดอายุหลัง 30 นาที
- โหมดไฟล์แสดงเส้นของกลยุทธ์ที่เลือก; โหมดออนไลน์เดิมยังแสดงอินดิเคเตอร์ทั้งหมด
- Export ZIP เดิมยังใช้กับโหมดออนไลน์ ส่วนโหมดไฟล์ชุดใหญ่ปิดปุ่มนี้เพื่อไม่สร้าง ZIP ขนาดใหญ่ในหน่วยความจำ ไฟล์ต้นฉบับอ่านได้จาก `data-test` โดยตรง

## ความหมายของผล

ใช้ `lib/indicators.ts` และกฎสัญญาณชุดเดียวกับระบบเดิม โดยเปลี่ยนวิธีค้นหาโซนเป็นดัชนีเพื่อรักษาผลลัพธ์เดิมและลดเวลาสแกน ไม่เปลี่ยนสูตรซื้อขาย การค้นหาเวลาที่โซนถูกเติมในอนาคตยังเป็นข้อมูลอธิบายโซนเช่นเดิม ไม่ได้ทำให้ทุกฟิลด์เป็นข้อมูลที่รู้ได้ ณ เวลาเกิดโซน

Warmup ที่ใช้จริงขึ้นกับพารามิเตอร์ (300–1,000 แท่ง) ก่อนเริ่มจำลองพอร์ตว่าง ผลอาจต่างจากบอทที่คำนวณหน้าต่างสั้นใหม่ทุกครั้ง โดยเฉพาะอินดิเคเตอร์สะสม OBV/VWAP ทั้งนี้ `vwap()` ปัจจุบันสะสมตั้งแต่ต้นข้อมูลที่ส่งเข้า และไม่รีเซ็ตรายวัน
