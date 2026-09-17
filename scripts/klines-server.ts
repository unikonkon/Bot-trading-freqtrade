// Dedicated local adapter permits downloads to continue while the UI is restarted.
import http from "node:http";
import { GET } from "../api/klines/route";
const port = Number(process.env.KLINES_PORT ?? 4311);
http.createServer(async (req, res) => {
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host ?? "") || req.method !== "GET") {
    res.writeHead(403); res.end(); return;
  }
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname !== "/api/klines") { res.writeHead(404); res.end(); return; }
  try {
    const result = await GET(new Request(url));
    res.writeHead(result.status, Object.fromEntries(result.headers));
    res.end(await result.text());
  } catch { res.writeHead(500); res.end(); }
}).listen(port, "127.0.0.1", () => console.log(`Klines adapter: http://127.0.0.1:${port}/api/klines`));
