import { NextRequest, NextResponse } from "next/server";

const BINANCE_BASE = "https://api.binance.com";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const symbol = searchParams.get("symbol");
  const interval = searchParams.get("interval");
  const limit = searchParams.get("limit") || "200";
  const startTime = searchParams.get("startTime");
  const endTime = searchParams.get("endTime");

  if (!symbol || !interval) {
    return NextResponse.json(
      { error: "symbol and interval are required" },
      { status: 400 }
    );
  }

  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval,
    limit,
  });

  if (startTime) params.set("startTime", startTime);
  if (endTime) params.set("endTime", endTime);

  try {
    const res = await fetch(
      `${BINANCE_BASE}/api/v3/klines?${params.toString()}`,
      { next: { revalidate: 0 } }
    );

    if (!res.ok) {
      const errorBody = await res.text();
      return NextResponse.json(
        { error: `Binance API error: ${res.status}`, details: errorBody },
        { status: res.status }
      );
    }

    const data = await res.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch from Binance", details: String(err) },
      { status: 500 }
    );
  }
}
