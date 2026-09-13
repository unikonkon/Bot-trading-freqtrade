/**
 * Proxy อ่านข้อมูลจาก freqtrade REST API สำหรับหน้า LiveTrading (แผนเฟส 5)
 *
 * - เก็บ credential ฝั่ง server เท่านั้น (FREQTRADE_URL, FREQTRADE_USER, FREQTRADE_PASS)
 * - อนุญาตเฉพาะ endpoint อ่านอย่างเดียว ห้ามส่งคำสั่งเทรดผ่านทางนี้
 * - เรียก: GET /api/freqtrade?path=status | profit | trades | balance | show_config | performance
 *
 * ถ้ามีหลาย instance (1h, 4h) ตั้ง FREQTRADE_URL เป็น URL ของ reverse proxy ที่ route ตาม prefix
 * หรือเพิ่ม env FREQTRADE_URL_4H แล้วส่ง ?instance=4h
 */
import { NextRequest, NextResponse } from "next/server";

const READ_ONLY = new Set([
  "ping",
  "version",
  "status",
  "profit",
  "trades",
  "balance",
  "show_config",
  "performance",
  "daily",
  "stats",
  "whitelist",
  "locks",
  "health",
]);

function baseUrlFor(instance: string | null): string | undefined {
  if (instance && instance !== "default") {
    return process.env[`FREQTRADE_URL_${instance.toUpperCase()}`];
  }
  return process.env.FREQTRADE_URL;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const path = searchParams.get("path") ?? "status";
  const instance = searchParams.get("instance");

  if (!READ_ONLY.has(path)) {
    return NextResponse.json({ error: `path '${path}' is not allowed (read-only proxy)` }, { status: 400 });
  }

  const base = baseUrlFor(instance);
  const user = process.env.FREQTRADE_USER;
  const pass = process.env.FREQTRADE_PASS;
  if (!base || !user || !pass) {
    return NextResponse.json(
      { error: "FREQTRADE_URL / FREQTRADE_USER / FREQTRADE_PASS ยังไม่ได้ตั้งค่า" },
      { status: 500 },
    );
  }

  // ส่งต่อ query ที่ freqtrade รองรับ (เช่น trades?limit=50, daily?timescale=7)
  const forward = new URLSearchParams();
  for (const [k, v] of searchParams.entries()) {
    if (k !== "path" && k !== "instance") forward.set(k, v);
  }
  const qs = forward.toString();
  const url = `${base.replace(/\/$/, "")}/api/v1/${path}${qs ? `?${qs}` : ""}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: "เชื่อมต่อ freqtrade ไม่ได้", details: String(err) },
      { status: 502 },
    );
  }
}
