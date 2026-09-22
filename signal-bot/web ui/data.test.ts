import { createKlineHandler } from "../../api/klines/route";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadData, validate, fetchPage } from "./data";
import { parseKline } from "../../lib/types/kline";
const base = {
  symbol: "BTCUSDT",
  interval: "1h",
  source: "latest",
  limit: 500,
  strategy: "all",
  selected: "supertrend",
  params: {},
  fee: 0.1,
  slippage: 0.05,
  mode: "both",
};
const epoch = Date.UTC(2026, 0, 1);
function bars(count: number, start = epoch) {
  return Array.from({ length: count }, (_, i) =>
    parseKline([
      start + i * 3600000,
      "100",
      "105",
      "95",
      "101",
      "100",
      start + (i + 1) * 3600000 - 1,
      "10000",
      10,
      "50",
      "5000",
    ]),
  );
}
test("validation rejects unknown strategies/params, invalid ranges and unusable periods", () => {
  for (const patch of [
    { interval: "bogus" },
    { fee: -1 },
    { limit: 10001 },
    { params: { rsi: { period: 0 } } },
    { params: { rsi: { period: 2.5 } } },
    { params: { supertrend: { atrPeriod: Infinity } } },
    { params: { rsi: { unknown: 14 } } },
    { params: { cdc_actionzone: { fastPeriod: 30, slowPeriod: 10 } } },
    { params: { rsi: { buyThreshold: 80, sellThreshold: 20 } } },
    { strategy: "rsi" },
    { symbol: "../../etc/passwd" },
    { source: "range", from: epoch, to: epoch - 1 },
  ])
    assert.throws(() => validate({ ...base, ...patch }));
});
test("latest 10,000 candles paginate within the API cap and exclude the open candle", async () => {
  const rows = bars(10001), calls: Record<string, string>[] = [];
  const data = await loadData(
    // กลยุทธ์ v1 ตัวเดียว ดูหมายเหตุในเทสต์ถัดไปว่าทำไม v3 ต้องดึงมากกว่านี้
    validate({ ...base, strategy: "supertrend", limit: 10000 }),
    async (p) => {
      calls.push(p);
      assert.ok(+p.limit <= 1000);
      return rows.filter(b => !p.endTime || b.openTime <= +p.endTime).slice(-Number(p.limit));
    },
    rows.at(-1)!.openTime + 100,
  );
  assert.deepEqual(data.klines, rows.slice(0,10000));
  assert.equal(data.start, 0);
  assert.equal(calls.length, 11);
  assert.ok(!data.warnings.some(w => w.includes("ประวัติอาจมีไม่เพียงพอ")));
});
test("latest pagination reports limited history and rejects a non-progressing page", async () => {
  const rows = bars(600);
  const data = await loadData(validate({ ...base, limit: 1500 }), async p => p.endTime ? [] : rows);
  assert.equal(data.klines.length, 600);
  assert.ok(data.warnings.some(w => w.includes("600") && w.includes("1,500")));
  await assert.rejects(loadData(validate({ ...base, limit: 1500 }), async () => rows), /ไม่ถอยหลัง/);
});
test("latest 1000 candles backfill the missing closed candle without duplicates", async () => {
  const rows = bars(1001),
    calls: Record<string, string>[] = [];
  const data = await loadData(
    // กลยุทธ์ v1 ตัวเดียว: สัญญาของการไล่หน้าเดิมต้องไม่เปลี่ยนเมื่อ v3 ขอแท่งอุ่นเครื่องเพิ่ม
    validate({ ...base, strategy: "supertrend", limit: 1000 }),
    async (p) => {
      calls.push(p);
      return p.endTime ? [rows[0]] : rows.slice(1);
    },
    rows.at(-1)!.openTime + 100,
  );
  assert.equal(data.klines.length, 1000);
  assert.equal(data.klines.at(-1)!.openTime, rows[999].openTime);
  assert.equal(calls.length, 2);
  assert.equal(data.start, 0);
});
test("v3 ดึงแท่งอุ่นเครื่องเพิ่มจากช่วงที่ขอดู มิฉะนั้นชั้นทิศทางสะสมไม่ครบและไม่มีสัญญาณเลย", async () => {
  // ชั้นทิศทางของ v3 ต้องการ flowLookbackDays + flowDebiasDays = 125 วัน
  // ที่ 1h = 3,002 แท่ง ซึ่งมากกว่าที่ผู้ใช้ขอดู ระบบจึงต้องดึงเพิ่มแล้วตั้ง start ให้ถูก
  const want = 300, warm = 3002;
  const rows = bars(want + warm + 1);
  const data = await loadData(
    validate({ ...base, strategy: "orderflow_v3", selected: "orderflow_v3", limit: want, params: {} }),
    async (p) => rows.filter((b) => !p.endTime || b.openTime <= +p.endTime).slice(-Number(p.limit)),
    rows.at(-1)!.openTime + 100,
  );
  assert.equal(data.start, warm, "แท่งก่อนหน้าต้องถูกนับเป็นช่วงอุ่นเครื่อง ไม่ใช่ช่วงประเมินผล");
  assert.equal(data.klines.length - data.start, want, "ช่วงที่ประเมินผลต้องเท่าที่ผู้ใช้ขอพอดี");
  assert.ok(!data.warnings.some((w) => w.includes("เกินเพดาน")));

  // กลยุทธ์ v1 ต้องไม่ถูกกระทบ — ขอ 200 แท่งต้องได้ 200 แท่งและเริ่มประเมินที่ 0
  const v1 = await loadData(
    validate({ ...base, strategy: "supertrend", limit: want }),
    async (p) => rows.filter((b) => !p.endTime || b.openTime <= +p.endTime).slice(-Number(p.limit)),
    rows.at(-1)!.openTime + 100,
  );
  assert.equal(v1.start, 0);
  assert.equal(v1.klines.length, want);
});

test("v3 บน timeframe ที่ต้องการแท่งเกินเพดาน ต้องเตือนให้ชัด ไม่ใช่เงียบ", async () => {
  // 1m ต้องการ 180,002 แท่ง = 180 คำขอ เกินเพดาน 50,000 แท่งที่ระบบยอมไล่ให้
  const rows = bars(600);
  const data = await loadData(
    validate({ ...base, interval: "1m", strategy: "orderflow_v3", selected: "orderflow_v3", limit: 300, params: {} }),
    async (p) => rows.filter((b) => !p.endTime || b.openTime <= +p.endTime).slice(-Number(p.limit)),
    rows.at(-1)!.openTime + 100,
  );
  assert.ok(data.warnings.some((w) => w.includes("เกินเพดาน") && w.includes("180,002")),
    "ต้องบอกจำนวนแท่งที่ต้องการจริง เพื่อให้ผู้ใช้เลือก timeframe ที่ใช้ได้");
});

test("range paginates, prepends warmup, excludes unclosed/end-overlapping candle", async () => {
  const rows = bars(1350),
    from = rows[300].openTime,
    to = rows[1349].openTime + 100;
  const calls: Record<string, string>[] = [];
  const data = await loadData(
    validate({ ...base, source: "range", from, to }),
    async (p) => {
      calls.push(p);
      const eligible = rows.filter(
        (k) =>
          (!p.startTime || k.openTime >= +p.startTime) &&
          (!p.endTime || k.openTime <= +p.endTime),
      );
      return p.startTime
        ? eligible.slice(0, +p.limit)
        : eligible.slice(-Number(p.limit));
    },
    to + 1000,
  );
  assert.equal(data.start, 300);
  assert.equal(data.klines.length, 1349);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].startTime, String(rows[1299].openTime + 1));
  assert.equal(data.klines[data.start].openTime, from);
});
test("empty requested range cannot be mistaken for warmup data", async () => {
  const rows = bars(300);
  await assert.rejects(
    loadData(
      validate({
        ...base,
        source: "range",
        from: epoch + 400 * 3600000,
        to: epoch + 410 * 3600000,
      }),
      async (p) => (p.startTime ? [] : rows),
    ),
    /ไม่พบแท่ง/,
  );
});
test("over 10,000 test candles is rejected rather than silently truncated", async () => {
  let page = 0;
  const from = Date.UTC(2024, 0, 1);
  await assert.rejects(
    loadData(
      validate({ ...base, source: "range", from, to: from + 11000 * 3600000 }),
      async () => bars(1000, from + page++ * 1000 * 3600000),
    ),
    /10,000/,
  );
});
test("public client reports rate-limit and malformed data without retry storm", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response("{}", {
        status: 429,
        headers: { "retry-after": "60" },
      });
    };
    await assert.rejects(
      fetchPage({ symbol: "BTCUSDT", interval: "1h", limit: "500" }, createKlineHandler({ gapMs: 0 })),
      /429.*60/,
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () =>
      new Response(JSON.stringify([[1, "bad"]]), { status: 200 });
    await assert.rejects(
      fetchPage({ symbol: "BTCUSDT", interval: "1h", limit: "500" }, createKlineHandler({ gapMs: 0 })),
      /ไม่ถูกต้อง/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
