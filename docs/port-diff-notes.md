# บันทึกความต่างของ indicator ที่พอร์ตแล้ว "ต่างโดยตั้งใจ" (แผนเฟส 2 ข้อ 6.2)

> อัปเดต: 14 ก.ย. 2026 · harness: `ft/user_data/scripts/compare_with_ts.py`
> fixture: `ft/fixtures/BTCUSDT-1h.json` (1,000 แท่ง), warm-up 300 แท่ง

## สรุปผล harness

| โหมด | ผล | ความหมาย |
|---|---|---|
| `--mode ts` (confirmed=False) | **PASS 31/31 คอลัมน์** ทั้ง BTC 1h และ ETH 4h, ค่าต่างสูงสุด ~1e-11 | พอร์ต Python ตรงกับ TypeScript 1:1 ทุกตัว รวม S/R, Trendlines, SMC ในโหมดเดิม |
| `--mode live` (confirmed=True) | 22 คอลัมน์ OK, 9 คอลัมน์ `CHANGED` | 3 indicator เปลี่ยนพฤติกรรมตามที่ตั้งใจ ส่วนอีก 7 ตัวไม่ได้รับผลกระทบ |

คอลัมน์ที่ `CHANGED` ในโหมด live (BTC 1h, 700 แท่งหลัง warm-up)

| คอลัมน์ | ความต่าง | สาเหตุ |
|---|---|---|
| `sr_res`, `sr_sup` | ค่าเปลี่ยนสูงสุด ~1.4e4 (ระดับราคา) | level โผล่ช้าลง 15 แท่ง |
| `sig_support_resistance` | 3 แท่งต่างกัน | break ที่เกิดใน 15 แท่งหลัง pivot หายไป |
| `tl_upper`, `tl_lower` | ค่าเปลี่ยนสูงสุด ~1.5e4 | เส้นเริ่มช้าลง 14 แท่ง และเริ่มที่ระดับเดิมโดยไม่ลดตาม slope ล่วงหน้า |
| `sig_trendlines` | 42 แท่งต่างกัน | สัญญาณ break เกือบทั้งหมดเปลี่ยนตำแหน่ง |
| `smc_internal_trend` | 86 แท่ง | structure ยืนยันช้าลง 5 แท่ง |
| `smc_pd` | 82 แท่ง | premium/discount reset ช้าลง 50 แท่ง |
| `sig_smc` | 11 แท่ง | ตามสองข้อบน |

## รายละเอียดต่อตัว

### Support / Resistance (`support_resistance`)

- **TS เดิม:** `resistance[i] = pivotHigh(i)` ทันทีที่แท่ง i ทั้งที่ pivot ต้องดูอีก `rightBars` แท่งข้างหน้าจึงจะรู้
- **พอร์ต (confirmed=True):** ค่า pivot ถูกบันทึกที่แท่ง `i + rightBars` แล้ว carry forward
- **ผลต่อสัญญาณ:** เงื่อนไข break ต้องให้ close ทะลุ level ซึ่งเป็นไปไม่ได้ในช่วง rightBars แท่งหลัง pivot อยู่แล้ว (ถ้าทะลุแสดงว่าไม่ใช่ pivot) จึงเปลี่ยนน้อย ต่างที่พบ 3 แท่งมาจากกรณี level ถูกแทนที่ด้วย pivot ใหม่ช้ากว่าเดิม
- **ตรงกับ Pine:** `fixnan(pivothigh(left, right))` ให้ค่าที่แท่งยืนยัน จึงตรงกับโหมด confirmed

### Trendlines with Breaks (`trendlines`)

- **TS เดิม:** เส้นเริ่มที่แท่ง pivot แล้วลดตาม slope ทุกแท่ง → ณ แท่ง `i + length` เส้นอยู่ต่ำกว่า pivot ไปแล้ว `length × slope` และแท่งระหว่างนั้นทะลุเส้นได้โดยใช้ข้อมูลอนาคต → **lookahead bias จริง**
- **พอร์ต (confirmed=True):** เส้นเริ่มที่แท่งยืนยัน `i + length` ด้วยค่า pivot และ slope ณ แท่งนั้น ตรงกับ Pine `upper := ph ? ph : upper - slope_ph`
- **ผลต่อสัญญาณ:** เปลี่ยนมาก (42/700 แท่ง) ผล backtest ของ TS สำหรับกลยุทธ์นี้ **ใช้ไม่ได้** ต้องดูจาก freqtrade เท่านั้น
- **lookahead-analysis (freqtrade 2026.8, 20 สัญญาณ):** has_bias = No

### Smart Money Concepts (`smc`)

- **TS เดิม:** pivot (swing 50 / internal 5) ถูกใช้ทันทีที่แท่ง pivot ทั้งใน structure และ premium/discount; premium/discount reset `trailingLow`/`trailingHigh` ที่แท่ง pivot ซึ่งยังไม่รู้ในเวลาจริง
- **พอร์ต (confirmed=True):** ทุก pivot ยืนยันที่ `i + size`; ตัด Order Block, Fair Value Gap ออกเพราะไม่ได้ใช้ในสัญญาณ (swing point label ยังคงไว้)
- **ผลต่อสัญญาณ:** 11/700 แท่ง มาจากสองทาง (1) BOS/CHoCH ของ pivot เก่าที่ TS ข้ามไปเพราะ "รู้" pivot ใหม่ล่วงหน้า (2) โซน premium/discount ต่างกันตอนตัดสิน BOS
- **lookahead-analysis:** has_bias = No

## ข้อสรุป

- ใช้ `confirmed=True` (ค่า default) เสมอบน freqtrade ทั้ง backtest และ live
- `confirmed=False` มีไว้เฉพาะ harness เพื่อพิสูจน์ความถูกต้องของการพอร์ต ห้ามใช้เทรด
- ผล backtest ในหน้า Klines ของ Next.js สำหรับ 3 กลยุทธ์นี้ให้ถือว่า "มองโลกในแง่ดีเกินจริง"
