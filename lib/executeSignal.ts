export async function executeSignal(
  symbol: string,
  signal: "BUY" | "SELL" | "HOLD",
  quantity: string
) {
  if (signal === "HOLD") return null;

  const res = await fetch("/api/binance/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol,
      side: signal,
      type: "MARKET",
      quantity,
    }),
  });

  return res.json();
}
