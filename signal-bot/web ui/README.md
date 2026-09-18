# Signal Lab — Web UI ทดสอบ indicator และสัญญาณ

## SMC Adaptive Short trade — Spot ระยะสั้น

เพิ่ม `smc_adaptive_short` สำหรับ 1m/3m/5m/15m แล้ว: confirmed SMC liquidity
sweep/reversal หรือ bullish break/retest, EMA21/55, กรองขาลงแรง/volume/shock,
ตรวจเป้าหมายเทียบต้นทุนก่อนเข้า และจำกัดถือ 48 แท่ง. เป็น Spot ซื้อแล้วขาย
ตามคำยืนยันของผู้ใช้. สูตร V1/V2 เดิมยังอยู่.

ผล BTCUSDT 1,000 แท่งต่อช่วง, next-open, fee0.10% + slippage0.05% ต่อขา:
1m ไม่มีเทรด, 3m −0.09% (3 เทรด), 5m +0.50% (2 เทรด), 15m +1.85% (7 เทรด).
ยังไม่ใช่กำไรทุกช่วงและจำนวนเทรดน้อย ดู [รายงานละเอียดและแหล่งอ้างอิง](smc-adaptive-short-results/REPORT.th.md)
และ [ผลทั้งหมด/ต้นทุน/ข้อมูลที่ใช้](smc-adaptive-short-results/analysis.json).

```bash
npm run web:smc:short          # ทดสอบ 4 timeframe จากข้อมูลที่ตรึงไว้
npm run web:smc:short:select   # เลือกค่าบน development ซ้ำ
npm run web:check
npm run web:test
npm run web:ui
```

เลือก **SMC Adaptive Short trade → แท่งล่าสุด 1000 → ราคาเปิดแท่งถัดไป**.
`costPct=0.31%` เป็นต้นทุนเผื่อไป–กลับสำหรับกรองสัญญาณ ตั้งแยกจากต้นทุน
engine; หากเปลี่ยน fee/slippage ให้ปรับ `costPct` ให้ครอบคลุมด้วย.
เว็บแจ้งเมื่อค่าที่เผื่อไว้น้อยกว่าต้นทุนที่ตั้ง. Stop/target เป็นระดับตรวจราคาปิด
แล้ว fill เปิดแท่งถัดไป จึงไม่รับประกัน fill ที่ stop หรือคุ้มทุนเมื่อเกิด gap.

## SMC Adaptive V2 — เพิ่มจำนวนเทรด / ทดสอบ 8 timeframe

แก้ V2 ตัวเดิมใน `lib/indicators.ts` และ registry ใน `lib/backtest.ts` แล้ว:
confirmed SMC + Trendlines, เพิ่ม fresh SMC breakout และ EMA pullback reclaim,
EMA21/100, internal 7 / trendline 10, ADX25, cooldown 2, trailing 6 ATR
พร้อมระยะขั้นต่ำ 0.6%. แก้ profit protection ไม่ให้ตั้ง buffer เหนือกำไรที่ยังไม่เกิด.

ทดสอบ BTCUSDT 1,000 แท่งปิดต่อ timeframe, next-open, fee 0.10% และ slippage
0.05% ต่อขา: จำนวนเทรดรวม 5 → 33 และเพิ่มครบทั้ง 8 timeframe.
**ยังไม่ผ่านเป้าหมายกำไรทุก timeframe**: 1h +14.50%, 2h +4.86%; อีก 6 ช่วงขาดทุน.
กำไรสองช่วงพึ่งตลาดขึ้นรอบเดียวกัน จึงยังไม่ใช่หลักฐานความสม่ำเสมอ.

- [รายงานละเอียด 8 timeframe](smc-adaptive-v2-mtf-results/REPORT.th.md)
- [ผล / ต้นทุน / stress / warmup / checksum](smc-adaptive-v2-mtf-results/analysis.json)
- [ข้อมูลแท่งปิดที่ตรึงไว้](research-mtf/data/manifest.json)
- [ผลเลือกค่าครบ 68 ชุด](research-mtf/selection.json)

```bash
npm run web:ui                    # restart server เพื่อโหลดสูตรและ export source ใหม่
npm run web:smc:v2:mtf            # ทดสอบข้อมูล 1,000 แท่งทั้ง 8 ช่วงซ้ำแบบ offline
npm run web:smc:v2:mtf:select     # ทำขั้นตอนเลือกค่าบนข้อมูลก่อนหน้าซ้ำ
npm run web:check
npm run web:test
```

ในเว็บเลือก SMC Adaptive V2 → แท่งล่าสุด → 1000 → ราคาเปิดแท่งถัดไป.
ผลล่าสุดในเว็บจะเลื่อนไปตามเวลา; รายงานใช้ข้อมูลที่ตรึงวันที่ 16 กันยายน 2026.
สูตรยังเป็น Long-only Spot หนึ่งสถานะ ไม่ใช้ leverage. SELL คือปิด Long.

## SMC Adaptive V2 — ผลรุ่นก่อนเพิ่มจำนวนเทรด (เก็บเป็นประวัติ)

**ตัวเลขและ ZIP ด้านล่างเป็นสูตร V2 รุ่นก่อนการแก้รอบ 8 timeframe**.
หากต้องการ replay ตัวเลขเก่า ให้ใช้ source ใน ZIP เก่า;
คำสั่ง `web:smc:v2:analyze` / `web:smc:v2:select` เดิมอ้างอิง workflow รุ่นเก่า
และไม่ใช่คำสั่งทดสอบสูตรปัจจุบัน ใช้ `web:smc:v2:mtf` ด้านบนแทน.

เลือก **SMC Adaptive V2** (`smc_adaptive_v2`) ได้แล้ว สูตรใน
[`../../lib/indicators.ts`](../../lib/indicators.ts) ใช้ SMC bullish + confirmed
Trendlines, Wilder ADX/DI, EMA50/200, จำกัดการไล่ราคา และเลื่อน stop ตามราคาปิด.
SMC Adaptive V1 และ Trendlines เดิมยังแยกให้เปรียบเทียบได้.

ผลบน export `signal-bot/signal-export-BTCUSDT-1h-2026-09-16T10-36-11-055Z`
จำนวน 8,399 แท่ง + warmup 1,000: V2 **+9.08%**, DD **4.36%**, 13 เทรด;
V1 −8.84%, Trendlines −14.38%. ใช้ next_open, fee 0.10% + slippage 0.05% ต่อขา.
ผลส่วนใหญ่มาจาก train; validation ไม่เข้าเทรด และ test +0.22% จาก 4 เทรด
ซึ่งพลิกขาดทุนเมื่อ slippage เพิ่ม. ETH 4h fixture ขาดทุน −2.90%.
ยังไม่ใช่หลักฐานว่าทำกำไรสูงสุดหรือรองรับทุกตลาด.

- [รายงาน V2 พร้อมแหล่งความรู้และข้อจำกัด](smc-adaptive-v2-results/REPORT.th.md)
- [ผลทุกช่วงและต้นทุน](smc-adaptive-v2-results/analysis.json)
- [เทรด V2 พร้อมเหตุผล](smc-adaptive-v2-results/trades.json)
- [แพ็กเกจ replay V2](smc-adaptive-v2-results/SMC-Adaptive-V2.zip)

รันจาก repository root:

```bash
npm run web:ui                 # restart server เดิมเพื่อโหลด V2 และ Export snapshot
npm run web:smc:v2:analyze     # วิเคราะห์ export เดิม offline พร้อมสร้าง ZIP
npm run web:check
npm run web:test
```

เลือกช่วงวันที่ตรง export, **SMC Adaptive V2**, โหมด **เปิดแท่งถัดไป**.
ดู `smcAdaptiveV2.stop`, `adx`, `plusDI`, `minusDI`, `reason`, `regime` รายแท่ง.
Stop เป็นสัญญาณเมื่อปิดแท่ง แล้ว fill เปิดแท่งถัดไป ไม่ใช่ stop order ระหว่างแท่ง.
Buffer เหนือราคาเข้าไม่รับประกัน break-even เมื่อรวม gap และต้นทุน.
ZIP สำหรับคำนวณซ้ำมีโค้ดและ input เดิม: แตกไฟล์แล้ว `npm ci && npm run replay`;
ไม่รวมเว็บ server ทั้งแอป. `npm run web:smc:v2:select` รัน grid รุ่นสุดท้ายซ้ำ
และเขียน selection.json แต่ไม่แก้ default อัตโนมัติ.

## SMC Adaptive (เพิ่ม 16 กันยายน 2026)

เลือก **SMC Adaptive** (`smc_adaptive`) ในรายการกลยุทธ์ได้แล้ว สูตรอยู่ใน
[`../../lib/indicators.ts`](../../lib/indicators.ts) ฟังก์ชัน `smcAdaptive()`:
confirmed BOS/CHoCH + EMA 200, liquidity reclaim, ATR volatility filter,
stop/trailing/target ณ **ปิดแท่ง** และ cooldown. โหมด next_open ส่งผลไป fill
ที่ราคาเปิดแท่งถัดไป จึงมี gap/slippage และไม่ได้รับประกัน fill ที่ระดับ stop.

ค่าเริ่มต้นมาจากการเลือกบนช่วง train/validation ของ export `10-00-08-170Z`.
ผลสุทธิทั้งช่วง +2.35%, drawdown 12.32%, 18 เทรด; SMC เดิม −17.54%.
Validation −2.37%, test +1.52% จาก 4 เทรด และชุดล่าสุด 500 แท่ง −1.47%.
ผลนี้ไม่รับรองกำไรสูงสุดหรือใช้ได้ทุกตลาด ดูผลทั้ง 11 กลยุทธ์และต้นทุนใน
[รายงานภาษาไทย](smc-adaptive-results/REPORT.th.md).

`npm run web:smc:analyze` สร้างรายงาน/รายละเอียดเทรดจากไฟล์ export ทั้งสองชุดแบบ offline.
`npm run web:smc:select` คำนวณ grid รุ่นสุดท้ายใหม่ ไม่แก้ default อัตโนมัติ.
`npm run web:check` และ `npm run web:test` ตรวจทั้งหมด รวม prefix, warmup state และ gap exit.

Restart server เดิมด้วย `npm run web:ui` เพื่อโหลด strategy และ export source ใหม่.
การเลือกช่วงวันที่สำหรับ SMC Adaptive หรือเปรียบเทียบทั้งหมดจะโหลด warmup 1,000 แท่ง
ตาม EMA 200; การวิเคราะห์ไฟล์ export นี้ใช้ warmup เดิม 300 แท่งเพื่อให้ตรงกับข้อมูลที่ส่งมา.
การรันเว็บใหม่จึงอาจต่างจากรายงานเพราะข้อมูล/จุดเริ่ม warmup ต่างกัน.
การทดสอบกลยุทธ์อื่นตัวเดียวจะคิด warmup เฉพาะตัวที่เลือก.
ตัวใหม่ใช้สถานะสะสมเริ่มว่างที่ `startIndex`; rolling window ของบอทอาจให้ผลต่างกัน.
สูตรเดิมทั้ง 10 ตัวคงเดิม; ยังไม่มี Python/Freqtrade port ของ SMC Adaptive.

Dashboard ภาษาไทยสำหรับ Binance Spot public klines → `lib/indicators.ts` → `STRATEGY_FNS` → Backtest / Telegram preview

## เริ่มใช้งาน

รันจาก root ของ repository (Node.js 20+):

```bash
npm ci             # ถ้ายังไม่ได้ติดตั้ง dependency ของ repository
npm run web:ui
```

เปิด **http://127.0.0.1:4310** แล้วกด **รัน Backtest** เปลี่ยนพอร์ตด้วย `WEB_UI_PORT=4311 npm run web:ui`

ไม่ต้องติดตั้ง frontend framework เพิ่ม ไม่อ่าน `.env` ของบอท ไม่ต้องใช้ Binance key หรือ Telegram token ตัวเว็บไม่มีโค้ดส่งข้อความหรือ polling Telegram จึงไม่รบกวนบอทที่กำลังทำงาน

## วิธีใช้

1. เลือกคู่เหรียญ แล้วติ๊กชิป **ช่วงแท่งเทียน** จะเลือกกี่ช่วงก็ได้ หรือกด **เลือกทั้งหมด** / **ล้าง** ปุ่ม ★ บนชิปกำหนด **ช่วงหลัก** คือช่วงที่ใช้วาดกราฟและดูค่ารายแท่ง (ช่วงหลักจะถูกรันเสมอ) เมื่อเลือกแหล่งข้อมูลเป็นไฟล์ในเครื่อง ชิปจะเปิดเฉพาะ timeframe ที่ชุดข้อมูลนั้นมีครบ
2. เลือกแท่งล่าสุด 500–10,000 แท่ง เพิ่ม–ลดครั้งละ 500 หรือช่วงวัน/เวลาไทย (Asia/Bangkok) ขีดจำกัด 10,000 แท่งนับแยกต่อ timeframe; ช่วงที่เกินจะถูกข้ามพร้อมคำเตือน แล้วรันช่วงที่เหลือต่อ
3. ติ๊กกลยุทธ์ที่ต้องการในกล่อง **กลยุทธ์ที่ทดสอบ** จะเลือกกี่ตัวก็ได้ หรือกด **เลือกทั้งหมด** / **ล้างการเลือก** ระบบคำนวณและแสดงผลเฉพาะกลยุทธ์ที่ติ๊กไว้เท่านั้น ปุ่ม ★ บนการ์ดกำหนด **กลยุทธ์หลัก** คือกลยุทธ์ที่ใช้วาดกราฟ ค่ารายแท่ง และตัวอย่างข้อความ Telegram (กลยุทธ์หลักจะถูกรันเสมอ) ปรับพารามิเตอร์รายกลยุทธ์ได้ในส่วน **ปรับพารามิเตอร์** ค่าที่ปรับจะคงอยู่ระหว่างใช้งานหน้านี้
4. เลือกโหมดเปิดแท่งถัดไป / โหมดเดิม / ทั้งสองโหมด พร้อมค่าธรรมเนียมและ slippage
5. กดรัน ผลลัพธ์แบ่งเป็น 4 แท็บ: **กราฟและสัญญาณ**, **ผลการทดสอบ**, **รายการเทรด**, **ค่ารายแท่ง**
6. แท็บ **ผลการทดสอบ** มีหนึ่งแถวต่อ กลยุทธ์ × ช่วงแท่งเทียน × โหมด เรียงลำดับได้ทุกคอลัมน์ (กดหัวตาราง หรือใช้ช่อง เรียงตาม / ลำดับ) ค่าเริ่มต้นเรียงผลตอบแทนมากไปน้อย กรองเฉพาะช่วงแท่งเทียนหรือโหมดที่สนใจ และค้นหาด้วยชื่อกลยุทธ์ได้ กดชื่อกลยุทธ์ในตารางเพื่อตั้งเป็นกลยุทธ์หลักพร้อมสลับช่วงหลักไปที่แถวนั้นและเปิดกราฟ
7. เลื่อนช่วงกราฟด้วยปุ่มลูกศร เลือกเส้น indicator (ค่าที่ไม่ได้อยู่ในหน่วยราคาจะแสดงในช่องล่าง)
8. คลิกแท่งเทียนบนกราฟ หรือเลือกเวลาจากช่องในแท็บ **ค่ารายแท่ง** เพื่อดูค่า indicator และตัวอย่างข้อความ Telegram แท่ง HOLD แสดงว่าไม่มีการแจ้งเตือน

## แหล่งข้อมูลและขอบเขตเวลา

- เรียก [Binance GET /api/v3/klines](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data) จาก Node โดยตรง ใช้ `startTime`, `endTime` และ `limit` ไม่ใช้ Next.js proxy
- รับเฉพาะแท่งที่ปิดแล้ว ไม่ใช้แท่งระหว่างก่อตัว
- ทุกช่วงแท่งเทียนโหลดและคำนวณแยกกันคนละชุด ไม่มีการ resample ข้ามช่วง; ช่วงที่โหลดไม่ได้ (นอกชุดข้อมูล, ยังดาวน์โหลดไม่ครบ หรือเกิน 10,000 แท่ง) จะถูกข้ามพร้อมคำเตือนโดยไม่ล้มทั้งรอบ
- โหมดไฟล์ในเครื่องเก็บแท่งของช่วงหลักไว้ในหน่วยความจำครั้งละชุดเดียว ช่วงอื่นถูกปล่อยหลังสรุปผล; การสลับช่วงหลักจะอ่านไฟล์ของช่วงนั้นใหม่
- แท่งล่าสุด: UI เลือก 500–10,000 แท่ง เพิ่ม–ลดครั้งละ 500; แบ่งโหลดครั้งละไม่เกิน 1,000 แท่งและไม่นับแท่งที่ยังไม่ปิด หากประวัติไม่พอจะแจ้งจำนวนที่พบ คำนวณจากหน้าต่างนั้นโดยไม่เติม warmup แยก สอดคล้องกับวิธีสแกนของ signal-bot เมื่อใช้จำนวนแท่งและพารามิเตอร์เดียวกัน
- ช่วงเวลา: รวมแท่งที่ `openTime >= from` และ `closeTime <= to` โหลดทีละไม่เกิน 1,000 แท่ง จำกัด 10,000 แท่งทดสอบ หากเกินจะปฏิเสธโดยไม่ตัดผลเงียบ ๆ
- โหลด warmup เพิ่มก่อนแท่งทดสอบแรก 300–1,000 แท่ง โดยใช้ขั้นต่ำ 300 หรือ 5 เท่าของ period ที่ยาวที่สุดในพารามิเตอร์ คำนวณ indicator รวม warmup แต่เริ่มจำลองด้วยสถานะว่างและไม่รับคำสั่งค้างจาก warmup
- ช่วงย้อนหลังใช้ประวัติสะสม จึงอาจให้สัญญาณต่างจากบอทที่เลื่อนหน้าต่างข้อมูลใหม่ทุกครั้ง ยังไม่ได้จำลอง rolling-window replay ของบอททั้งกระบวนการ
- ใช้ confirmed pivots ตลอด ตรวจสัญญาณบนข้อมูลบางจุดตัดในชุดทดสอบ ไม่ใช่การรับรองว่า indicator ทุกชนิดไม่ repaint ทุกสถานการณ์
- แสดงคำเตือนเมื่อ warmup ไม่ครบหรือข้อมูลมีช่องว่าง; ไม่สร้างแท่งเติมเอง

## ความหมายของสองโหมด

| รายการ | เปิดแท่งถัดไป | ราคาปิดแท่งสัญญาณ (เดิม) |
|---|---|---|
| สัญญาณ | `STRATEGY_FNS` ชุดเดียวกับบอท | ชุดเดียวกัน |
| Entry / exit | ราคาเปิดแท่งถัดจากสัญญาณ | ราคาปิดแท่งเกิดสัญญาณ |
| การถือ | Long เต็มพอร์ตครั้งละหนึ่งสถานะ | Long ครั้งละหนึ่งสถานะ |
| ค่าเริ่มต้น fee | 0.1% ต่อขา ปรับได้ ไม่ใช่ค่าธรรมเนียมบัญชีจริง | 0.1% ต่อขา ปรับได้ |
| ค่าใช้จ่าย | ซื้อ: qty = cash / (fill × (1 + fee)); ขาย: cash = qty × fill × (1 − fee) | gross return − 2 × feePct ตาม engine เดิม |
| Slippage | ซื้อแพงขึ้น / ขายถูกลงตาม % ต่อขา | ไม่มี |
| ผลตอบแทน | พอร์ตเริ่ม 100 หน่วยและทบต้น | ผลรวมเปอร์เซ็นต์รายเทรด |
| Drawdown | % จากจุดสูงสุดของมูลค่าพอร์ต ณ ปิดแต่ละแท่ง รวมสถานะค้าง | จุดเปอร์เซ็นต์ (pp) จากผลรวมเทรดที่ปิดแล้ว |
| เวลาในรายการเทรด | เวลาเปิดแท่งที่ fill จริง; ปิดท้ายใช้ closeTime | openTime ของแท่งตาม engine เดิม แม้ใช้ราคาปิด |
| สิ้นสุดข้อมูล | บังคับปิดที่ราคาปิดสุดท้ายพร้อม fee/slippage; BUY แท่งสุดท้ายไม่มี fill | บังคับปิดตาม engine เดิม |

**การเปรียบเทียบสองโหมดเปลี่ยนทั้งจังหวะ fill และวิธีคิดพอร์ต** จึงไม่ใช่การทดลองที่แยกผลของจังหวะ fill เพียงตัวแปรเดียว UI ระบุวิธีคิดขณะดูผลและหน่วย drawdown ในตาราง

Profit factor ใช้ผลรวม % เทรดบวกหารค่าสัมบูรณ์ผลรวม % เทรดลบ; เมื่อมีแต่กำไรแสดง ∞ ไม่ใช่ศูนย์ Buy & hold ใช้ราคาปิดแท่งแรกถึงสุดท้าย ไม่หักค่าใช้จ่าย ไม่จำลอง leverage, short, stop-loss, ROI หรือ protections ของ freqtrade

## โครงสร้าง

- `server.ts` — HTTP server บน loopback, static assets, `/api/meta`, `/api/backtest`, `/api/detail`
- `data.ts` — ตรวจพารามิเตอร์, โหลดข้อมูลย้อนหลัง, warmup, retry และจำกัดจำนวนแท่ง
- `engine.ts` — จำลอง next-open, เรียก legacy engine, จัดข้อมูล indicator รายแท่ง
- `public/` — HTML/CSS/JavaScript และกราฟ Canvas ไม่มี CDN
- `engine.test.ts`, `data.test.ts` — กรณีจังหวะ fill, ค่าใช้จ่าย, warmup, pagination, validation และ fixtures

ผลทดสอบเก็บในหน่วยความจำสูงสุด 3 ชุด/30 นาทีเพื่อเปิดรายละเอียดบนแท่งชุดเดิม การรีสตาร์ทล้างผลเก่า ไม่มีการบันทึกลงฐานข้อมูล รับการทดสอบพร้อมกันหนึ่งคำขอ ตั้งใจให้ใช้งานในเครื่อง ไม่ใช่ server สาธารณะ

เปลี่ยน shared library เพียงสองเรื่อง:

1. แยก `computeStrategyIndicators()` เพื่อให้ค่าที่ UI แสดงใช้ mapping พารามิเตอร์เดียวกับ `computeSignals()` และต่อ `fastPeriod/slowPeriod` ของ CDC ที่เดิมถูกละเลย ค่า default 12/26 เหมือนเดิม
2. เพิ่ม `runBacktest(..., {startIndex})` เพื่อเว้นช่วง warmup โดยไม่รีเซ็ต indicator ค่า default 0 รักษาพฤติกรรมเดิม

**ผลกระทบ CDC:** ถ้าบอทตั้งค่า CDC ที่ไม่ใช่ 12/26 หลังแก้ครั้งนี้ TypeScript จะใช้ค่าที่ตั้งจริง ต้องตรวจว่าพารามิเตอร์ฝั่ง freqtrade รองรับตรงกันก่อนเทียบสัญญาณแบบ custom

## ตรวจสอบ

```bash
npm run web:check
npm run web:test
```

ทดสอบทุกกลยุทธ์กับ BTC 1h / ETH 4h fixtures และตรวจ prefix ของข้อมูลที่ 200, 500, 999 แท่ง ตรวจการเข้าออกถัดแท่ง, การหัก fee/slippage, การทบต้น, drawdown ระหว่างถือ และการแยก warmup

`npm run typecheck` ของทั้ง repository ยังมีปัญหาเดิมจาก `api/*` ที่อ้าง `next/server` และ `lib/utils.ts` ที่อ้าง `clsx` / `tailwind-merge` ซึ่งไม่มีใน package ปัจจุบัน ใช้ `web:check` ตรวจขอบเขต Web UI และ shared library โดยตรง

ผลตรวจระหว่างพัฒนา: `web:check` ผ่าน, ชุดทดสอบ 16 กรณีผ่าน, Binance จริง BTCUSDT 1h 500 แท่งและ ETHUSDT 1h 1,200 แท่ง + warmup 300 แท่งผ่านครบ 10 กลยุทธ์/2 โหมด, harness TypeScript ↔ Python ผ่าน 31/31 คอลัมน์ทั้งสอง fixtures ด้วยค่า default

ยังไม่ได้ทดสอบการคลิก/การจัดวางใน browser อัตโนมัติ ส่วน WebMCP เป็น optional feature-detected API และยังไม่ได้ตรวจใน browser ที่รองรับ WebMCP

## Export ข้อมูลและชุดโค้ด

หลังรันทดสอบ กด **Export** ข้างปุ่มรันทดสอบ เลือกกลยุทธ์ทีละตัวหรือ **เลือกทั้งหมด** แล้วกด **ดาวน์โหลด ZIP** ปุ่มจะไม่ทำงานหากยังไม่มีผลทดสอบหรือไม่ได้เลือกกลยุทธ์

Export ใช้ข้อมูลและพารามิเตอร์ที่บันทึกไว้ในรอบนั้น รวม warmup ไม่อ่านค่าที่แก้ใหม่ในฟอร์มและไม่เรียก Binance เพิ่ม กลยุทธ์ที่ยังไม่ได้รันจะแปลงสัญญาณจากแท่งชุดเดิมด้วยพารามิเตอร์ของรอบเดิม ผลเดิมหมดอายุหลัง 30 นาทีหรือถูกแทนที่เมื่อมีเกิน 3 รอบ ต้องรันใหม่ก่อน Export

ZIP ประกอบด้วย:

- `config.json`, `manifest.json`: ข้อมูลรอบทดสอบ พารามิเตอร์ และ SHA-256 ของไฟล์ทั้งหมด
- `input-klines.json`, `input-klines.csv`: แท่งจริงที่ใช้คำนวณ รวม warmup (รูปแบบ KlineData ที่แปลงแล้ว)
- `signals/<strategy>.csv` และ `.json`: BUY/SELL/HOLD ทุกแท่งในช่วงทดสอบ พร้อมค่า indicator ปัจจุบัน/ก่อนหน้าและเหตุการณ์ประกอบ
- `calculations/<strategy>.json`: indicator แบบเต็ม รวมโครงสร้าง SMC/OB และผลจำลองทั้งโหมดที่เลือกไว้
- `trades/`, `summary.csv`: รายการเทรดจำลองและผลสรุป แยกจากสัญญาณ
- `rules.md`, `README.md`: เงื่อนไขจริงและวิธีคำนวณซ้ำ
- `lib/`, `signal-bot/web ui/`, `package.json`, `package-lock.json`, `tsconfig.json`: ชุดโค้ดที่ใช้งานได้แยกจาก repository เดิม

ไฟล์ผลลัพธ์มีเฉพาะกลยุทธ์ที่เลือก ส่วน shared library แนบทั้งไฟล์เพื่อคง dependency และตรรกะเดิม ไม่แนบ `.env`, Telegram token, state ของบอท หรือโค้ดส่งออเดอร์ Source ถูก snapshot เมื่อเริ่ม server หากแก้ shared library ให้ restart server และรันทดสอบใหม่ก่อน Export

คำนวณซ้ำจากโฟลเดอร์ที่แตก ZIP:

```bash
npm ci
npm run replay
```

`replay` ตรวจ checksum ก่อนคำนวณ ตรวจผลตรงกับ `calculations/*.json` และเขียนผลลง `recomputed/` หลังติดตั้ง dependency แล้วไม่ต้องต่อ Binance/Telegram เรียก `evaluateKlines()` จาก `signal-bot/web ui/evaluate-klines.ts` เพื่อรับ raw response รูปแบบเดียวกับ `api/klines/route.ts` ในโปรเจกต์อื่นได้ ตัวอย่างอยู่ใน README ภายใน ZIP

ข้อสังเกต: สูตรบางกลยุทธ์ต่างจากคำอธิบายย่อเดิม เช่น CM MACD ใช้ SMA ของ MACD เป็น signal line; Squeeze ตรวจจุดตัดศูนย์โดยไม่บังคับ squeeze release; MSB ไม่ได้บังคับว่าต้องพบ Order Block ก่อนส่งสัญญาณ ให้ยึด `rules.md` และโค้ดในชุด Export

ตรวจเพิ่มสำหรับ Export: `npm run web:test` ผ่าน 22 กรณี, ZIP เปิด/ตรวจ CRC ได้, endpoint แบบเลือกหนึ่ง/เลือกทั้งหมดผ่าน, ผล Export ตรงกับผล API รอบเดิม และ replay ในโฟลเดอร์แยกผ่านทั้ง 10 กลยุทธ์บนข้อมูลจริง 500 แท่ง

## ข้อมูลย้อนหลังจากไฟล์ในเครื่อง

เพิ่มแหล่งข้อมูล **ไฟล์ย้อนหลังในเครื่อง** สำหรับ snapshot ใน `data-test/BTCUSDT`.
รองรับข้อมูลมากกว่า 10,000 แท่งผ่าน worker process; กราฟแบ่งหน้าละ 2,000 แท่ง
และรายการเทรดหน้าละ 25 โดยคำนวณอินดิเคเตอร์/พอร์ตจากแท่งจริงครบช่วงต่อเนื่อง.
โหมด `latest` / `range` ออนไลน์ยังจำกัด 10,000 แท่งตามเดิมและเรียกผ่าน handler
`api/klines/route.ts` ร่วมกัน.

อ่าน [คู่มือดาวน์โหลด Resume ตรวจไฟล์ และทดสอบ](../../data-test/README.md).
