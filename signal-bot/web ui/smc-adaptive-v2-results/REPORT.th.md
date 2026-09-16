# SMC Adaptive V2 — ผลวิเคราะห์ BTCUSDT 1h

V2 ให้กำไรสุทธิ **9.08%**, drawdown **4.36%**, 13 เทรด ใน export นี้ หลัง fee 0.10% + slippage 0.05% ต่อขา. V1 −8.84%, Trendlines −14.38%, Buy & hold −34.93%. ผลที่ดีขึ้นยังไม่ใช่การรับรองกำไรสูงสุดในอนาคต

## ข้อมูลและวิธีเปรียบเทียบ

- แหล่งข้อมูล: signal-export-BTCUSDT-1h-2026-09-16T10-36-11-055Z; 2025-10-01T11:00:00.000Z ถึง 2026-09-16T09:59:59.999Z (UTC); 8,399 แท่งทดสอบ + 1,000 warmup
- ตรวจ checksum ทุกไฟล์ตาม manifest; คำนวณ V1/Trendlines ซ้ำตรง export ทั้ง 2 โหมดทุกเทรด; ตรวจความเป็นเหตุเป็นผลของ V2 ด้วย prefix 143 จุด รวมก่อน/หลังทุกสัญญาณ
- เปรียบเทียบหลักแบบ next_open: Long เต็มพอร์ตครั้งละหนึ่งสถานะ เริ่ม 100 ทบต้น ไม่มี short/leverage. ทุกสัญญาณใช้ข้อมูลถึงราคาปิดและ fill เปิดแท่งถัดไปพร้อมต้นทุน. Stop เป็น close trigger ไม่ใช่คำสั่ง stop ระหว่างแท่ง; gap อาจทำให้แพ้เกิน stop
- ทุกช่วงเริ่มสถานะว่าง แต่ใช้ข้อมูลก่อนหน้าเป็น warmup; สิ้นช่วงบังคับปิดสถานะค้าง. Drawdown วัด ณ ปิดแท่ง ไม่ใช่ drawdown สูงสุดระหว่างแท่ง

| กลยุทธ์ | สุทธิ % | DD % | เทรด | ชนะ % | PF | แย่สุด % | เวลาถือ % |
|---|---:|---:|---:|---:|---:|---:|---:|
| SMC Adaptive | -8.84 | 13.64 | 24 | 41.67 | 0.75 | -4.11 | 10.95 |
| Trendlines with Breaks [LuxAlgo] | -14.38 | 25.27 | 68 | 32.35 | 0.83 | -5.38 | 47.04 |
| SMC Adaptive V2 | 9.08 | 4.36 | 13 | 69.23 | 3.08 | -2.14 | 4.37 |

## วิเคราะห์เทรดเดิม

- V1 ออกด้วย ATR close stop 19 จาก 24 เทรด ออกตาม target 4 และ timeout 1. การเลื่อน stop ของ V1 เริ่มเมื่อกำไรถึง initial risk และใช้ระยะ 4 ATR จึงอาจคืนกำไรระหว่างรอ
- Trendlines เข้าได้เร็วกว่าแต่ไม่มีตัวกรอง SMC/ADX และไม่มี risk exit ของตนเอง จึงเสี่ยงเข้าออกในตลาดแกว่ง. เปรียบเทียบกับ V2 ที่รอโครงสร้าง bullish และเส้นที่ยืนยันแล้วพร้อมกัน
- smc_adaptive: 3 เทรดเคยมี high สูงกว่าราคาเข้า >1% แต่ปิดขาดทุน. MFE/MAE ใช้เพื่ออธิบายหลังจบเทรดเท่านั้น ไม่ถูกนำไปสร้างสัญญาณ; ไม่นับ high/low ของแท่งออกหลัง fill ที่ open
- trendlines: 26 เทรดเคยมี high สูงกว่าราคาเข้า >1% แต่ปิดขาดทุน. MFE/MAE ใช้เพื่ออธิบายหลังจบเทรดเท่านั้น ไม่ถูกนำไปสร้างสัญญาณ; ไม่นับ high/low ของแท่งออกหลัง fill ที่ open
- smc_adaptive_v2: 2 เทรดเคยมี high สูงกว่าราคาเข้า >1% แต่ปิดขาดทุน. MFE/MAE ใช้เพื่ออธิบายหลังจบเทรดเท่านั้น ไม่ถูกนำไปสร้างสัญญาณ; ไม่นับ high/low ของแท่งออกหลัง fill ที่ open

## ความรู้เพิ่มเติมและสิ่งที่นำมาใช้

- [Fidelity DMI/ADX](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/DMI): ADX วัดแรงเทรนด์ ส่วน DI ช่วยแยกทิศ; V2 ใช้ Wilder smoothing และ +DI > −DI. Fidelity ยก 25 เป็นเกณฑ์เทรนด์แข็งแรงทั่วไป ส่วนค่า 15 ของ V2 มาจากการทดลองชุดข้อมูลนี้และต้องใช้ร่วมกับ SMC/EMA/Trendlines ไม่ใช่การอ้างว่า 15 เป็นเกณฑ์มาตรฐาน
- [CME Trend vs. Anti-Trend](https://www.cmegroup.com/education/courses/trading-and-analysis/trend-vs-anti-trend): สัญญาณตามเทรนด์มีความล่าช้าและเจอสัญญาณหลอกในตลาดแกว่งได้. V2 จึงจำกัดอายุ breakout 6 แท่ง รอ EMA200 เพิ่มจาก 24 แท่งก่อน และไม่ซื้อไกล EMA50 เกิน 2 ATR; ตัวเลขเหล่านี้เป็นสมมติฐานของ implementation ไม่ใช่สูตรที่ CME รับรอง
- [CME Utilizing Stop Orders](https://www.cmegroup.com/education/courses/master-the-trade-futures/take-your-trade-plan-to-the-next-level/master-the-trade-utilizing-stop-orders.hideSubnav.educationIframe.html?hideAddThisExt=y&hideFooter=y&hideHeader=y&hideRightRail=y): สภาพราคา/ความผันผวนมีผลต่อระยะ stop และความเสี่ยง. V2 ใช้ ATR และงดเข้าเมื่อเกิด shock; อย่างไรก็ตามเครื่องมือนี้จำลอง close-stop และยังลงเต็มพอร์ต ไม่ได้ทำ volatility-target position sizing
- [AQR Time Series Momentum](https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum): เป็นบริบทของการตามแนวโน้มในหลายตลาด; ไม่ได้เป็นหลักฐานว่า SMC+Trendlines หรือ BTC 1h สูตรนี้จะได้ผล จึงตรวจต้นทุนและช่วงเวลาต่าง ๆ แยกในรายงาน

## สูตร V2 ที่ใช้งานจริง

1. confirmed internal pivot 20 → SMC structure trend; Trendlines confirmed pivot 14 และ slope ATR×1. ไม่ใช้ upper=0 ช่วง bootstrap และไม่อ่านสถานะ OB/FVG ในอนาคต
2. BUY เมื่อ Trendlines breakUp อายุไม่เกิน 6 แท่ง, SMC bullish, close เหนือเส้น upper และ EMA200, EMA50 > EMA200 และไม่ลดลงจาก 5 แท่งก่อน, EMA200 เพิ่มจาก 24 แท่งก่อน, ADX14 >=15, +DI>−DI, แท่งเขียว, ระยะเหนือ EMA50 <=2 ATR
3. งดเข้าเมื่อ ATR14/ATR50 >2.5 หรือ range แท่ง >4 ATR หรืออยู่ใน cooldown 6 แท่ง. ราคา gap ยังมีผลต่อ fill และตัวกรองไม่ได้รับประกันหลบทุก shock
4. Stop เริ่ม 3×ATR×clamp(ATR14/ATR50,1,1.5), อ้างราคาปิดแท่ง BUY. ทุกแท่งเลื่อนขึ้นตาม peak CLOSE−2 ATR; เมื่อ peak close เพิ่ม >=1.5×ATR ณ เข้า จะยก stop อย่างน้อยราคาเข้าอ้างอิง +0.35%. Stop ห้ามเลื่อนลงและไม่มี fixed profit target
5. SELL เมื่อ close <= stop รวมกรณีเพิ่งเลื่อน stop ในแท่งปิดนั้น, bearish SMC/Trendlines breakdown พร้อม close < EMA50 หรือครบ 200 แท่ง. การคำนวณ stop จาก close ปัจจุบันเพื่อ fill open ถัดไปไม่ใช่การ fill ย้อนหลัง. Buffer 0.35% ไม่รับประกัน break-even หลัง gap/fee/slippage

## การเลือกค่าและข้อจำกัดของข้อมูล

ทดลองต้นแบบแรก 64 ชุดแล้ว validation ยังขาดทุน จากนั้นเพิ่มเงื่อนไข EMA200 ต้องเพิ่มจาก 24 แท่งก่อนและทดลอง grid อีก 64 ชุด. จัดอันดับ train ด้วย return−0.5×DD−max(0,12−จำนวนเทรด), นำ 8 อันดับแรกไปเรียง validation ด้วย return−0.5×DD; เสมอใช้ลำดับ train. รวม 128 ชุด บางชุดให้สัญญาณเหมือนกัน ไม่ใช่กลยุทธ์อิสระทั้งหมด

ค่า default ถูกเลือกก่อนเปิดผล test ของ V2 และไม่ปรับตาม test หลังจากนั้น. แต่ข้อมูลช่วงท้ายซ้ำกับช่วงที่ใช้พัฒนา V1 และเราได้เห็นผลสรุป export นี้ก่อนออกแบบ จึงไม่ใช่ blind out-of-sample และยังไม่มี forward test. Validation ไม่มีเทรด จึงไม่มีหลักฐานยืนยันความสามารถทำกำไรในช่วงนั้น การไม่เข้าเทรดช่วยหลีกเลี่ยงการขาดทุนในชุดนี้เท่านั้น

| ช่วง | UTC เริ่ม–สิ้นสุด | V2 สุทธิ % | DD % | เทรด | Buy & hold % |
|---|---|---:|---:|---:|---:|
| train | 2025-10-01T11:00:00.000Z – 2026-04-29T09:59:59.999Z | 8.83 | 4.36 | 9 | -33.52 |
| validation | 2026-04-29T10:00:00.000Z – 2026-07-08T09:59:59.999Z | 0.00 | 0.00 | 0 | -20.05 |
| test | 2026-07-08T10:00:00.000Z – 2026-09-16T09:59:59.999Z | 0.22 | 3.08 | 4 | 22.21 |

กำไรทั้งชุดกระจุกในช่วง train; test มีเพียง 4 เทรดและผลตอบแทนต่ำกว่า Buy & hold มาก. สูตรนี้จึงยังเป็นต้นแบบเพื่อทดลอง ไม่ใช่ผลพิสูจน์ว่าดีที่สุดทุกช่วงเวลา

## ผลเมื่อเพิ่มต้นทุน

| Fee ต่อขา % | Slippage ต่อขา % | ทั้งช่วงสุทธิ % | DD % |
|---:|---:|---:|---:|
| 0.1 | 0 | 10.50 | 4.08 |
| 0.1 | 0.05 | 9.08 | 4.36 |
| 0.1 | 0.1 | 7.67 | 4.65 |
| 0.2 | 0.1 | 4.90 | 5.66 |

| Fee ต่อขา % | Slippage ต่อขา % | test สุทธิ % |
|---:|---:|---:|
| 0.1 | 0.05 | 0.22 |
| 0.1 | 0.1 | -0.18 |
| 0.2 | 0.1 | -0.97 |

ล่าสุด 500 แท่งของ export: 0.00%, 0 เทรด (ข้อมูลซ้ำ ไม่ใช่ชุดอิสระ).

## Fixtures เพิ่มเติมด้วยค่าเดิม

| Fixture | UTC เริ่ม–สิ้นสุด | สุทธิ % | DD % | เทรด |
|---|---|---:|---:|---:|
| BTCUSDT-1h | 2026-08-15T14:00:00.000Z – 2026-09-13T17:59:59.999Z | 0.05 | 1.10 | 1 |
| ETHUSDT-4h | 2026-05-20T04:00:00.000Z – 2026-09-13T19:59:59.999Z | -2.90 | 4.50 | 2 |

BTC fixture ซ้ำช่วง export; ETH เป็นอีกคู่/กรอบเวลา แต่จำนวนเทรดน้อย ไม่ใช่การรับรองการใช้ข้ามตลาด. ค่า default ไม่ถูกปรับจากผล fixtures

## ไฟล์และวิธีรัน

- โค้ดหลัก `lib/indicators.ts`: `directionalMovement()`, `smcAdaptiveV2()` และ `SMC_ADAPTIVE_V2_DEFAULTS`. เว็บและ Export เชื่อมด้วย ID `smc_adaptive_v2`; V1 และ Trendlines เดิมคงสูตรเดิม
- จาก repository root รัน `npm run web:ui` และเลือก **SMC Adaptive V2**; server เดิมต้อง restart เพื่อโหลดโค้ดและ export snapshot ใหม่. เลือกช่วงวันที่และ next_open สำหรับเทียบรายงานนี้ ไม่ใช้ข้อมูล 500 แท่งล่าสุดแทนทั้งช่วง
- `npm run web:smc:v2:analyze` สร้าง analysis.json, signals.json, trades.json, รายงานและ `SMC-Adaptive-V2.zip` ใหม่จาก export เดิมแบบ offline. `npm run web:smc:v2:select` ทำ grid รุ่นสุดท้ายซ้ำและเขียน selection.json โดยไม่แก้ default อัตโนมัติ
- ZIP มีโค้ด, input เดิมรวม warmup, calculations, signals และ trades. แตกไฟล์แล้ว `npm ci && npm run replay` เพื่อตรวจคำนวณซ้ำโดยไม่เรียก Binance; ZIP เป็นแพ็กเกจ replay ไม่ใช่เว็บ server ทั้งแอป
- `npm run web:check` / `npm run web:test` ตรวจ TypeScript, browser script, ADX, prefix, warmup, confluence, stop และ next-open gaps. ยังไม่มี Python/Freqtrade port และไม่ได้รันเงินจริง
- ไม่ได้ใช้ rolling-window replay ของบอท. Indicator ที่มีสถานะควรใช้ประวัติสะสมและ startIndex คงเดิม; การเลื่อนหน้าต่าง 500 แท่งอาจเปลี่ยนจุดเริ่ม EMA/structure/state. กำไรอดีตและ prefix tests ไม่รับรองกำไรในอนาคต
