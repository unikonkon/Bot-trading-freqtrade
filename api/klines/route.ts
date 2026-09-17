import { INTERVALS } from "../../lib/types/kline";

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** One shared queue per server: history downloads and interactive requests share it. */
export function createKlineHandler(options: { fetch?: typeof fetch; gapMs?: number } = {}) {
  let queue: Promise<unknown> = Promise.resolve();
  let nextRequest = 0;
  let blockedUntil = 0;
  return async function GET(request: Request): Promise<Response> {
    const query = new URL(request.url).searchParams;
    const symbol = (query.get("symbol") ?? "").toUpperCase();
    const interval = query.get("interval") ?? "";
    const limit = Number(query.get("limit") ?? 200);
    const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
    if (!/^[A-Z0-9]{5,24}$/.test(symbol) || !INTERVALS.includes(interval as never) ||
        !Number.isInteger(limit) || limit < 1 || limit > 1000)
      return Response.json({ error: "Invalid symbol, interval or limit (1–1000)" }, { status: 400 });
    for (const key of ["startTime", "endTime"]) {
      const value = query.get(key);
      if (value !== null) {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
          return Response.json({ error: `Invalid ${key}` }, { status: 400 });
        params.set(key, value);
      }
    }
    if (params.has("startTime") && params.has("endTime") && +params.get("startTime")! > +params.get("endTime")!)
      return Response.json({ error: "startTime exceeds endTime" }, { status: 400 });
    const execute = async () => {
      if (blockedUntil > Date.now()) return Response.json({ error: "Binance cooldown" }, {
        status: 429, headers: { "Retry-After": String(Math.ceil((blockedUntil - Date.now()) / 1000)), "Cache-Control": "no-store" },
      });
      await pause(Math.max(0, nextRequest - Date.now()));
      nextRequest = Date.now() + (options.gapMs ?? 2000);
      try {
        const response = await (options.fetch ?? fetch)(`https://api.binance.com/api/v3/klines?${params}`, {
          cache: "no-store", signal: AbortSignal.timeout(20000),
        });
        const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
        for (const [key, value] of response.headers) {
          if (key.startsWith("x-mbx-used-weight") || key === "retry-after") headers.set(key, value);
          if (key === "date") headers.set("X-Upstream-Date", value);
        }
        if (response.status === 429 || response.status === 418) {
          const seconds = Number(response.headers.get("retry-after"));
          blockedUntil = Date.now() + ((Number.isFinite(seconds) && seconds > 0 ? seconds : 60) + 1) * 1000;
          if (!headers.has("Retry-After")) headers.set("Retry-After", "61");
        } else if (Number(response.headers.get("x-mbx-used-weight-1m")) >= 500) {
          // A deliberately low local budget also leaves room for other processes on this IP.
          blockedUntil = Date.now() + 61000;
        }
        const body = await response.text();
        if (!response.ok) return Response.json({ error: `Binance API error: ${response.status}`, details: body.slice(0, 1000) }, { status: response.status, headers });
        return new Response(body, { status: 200, headers });
      } catch (error) {
        return Response.json({ error: "Failed to fetch from Binance", details: String(error) }, { status: 502 });
      }
    };
    const result = queue.then(execute, execute);
    queue = result.catch(() => undefined);
    return result;
  };
}

export const GET = createKlineHandler();
