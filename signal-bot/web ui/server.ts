import { listDatasets } from "./local-data";
import { startJob, jobStatus, jobView, cancelJob } from "./history-jobs";
import http from "node:http";
import { GET as klinesRoute } from "../../api/klines/route";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { STRATEGIES, type StrategyId } from "../../lib/backtest";
import { INTERVALS } from "../../lib/types/kline";
import { validate, loadData, type RequestConfig } from "./data";
import { analyze } from "./engine";
import {
  captureExportSources,
  createExport,
  validateExport,
  type ExportRun,
} from "./export";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const port = Number(process.env.WEB_UI_PORT ?? 4310);
const runs = new Map<string, ExportRun>();
let exportSources: Record<string, string>;
let busy = false;
const files: Record<string, [string, string]> = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/theme.js": ["theme.js", "text/javascript"],
  "/fonts/Sarabun-Regular.ttf": ["fonts/Sarabun-Regular.ttf", "font/ttf"],
  "/fonts/Sarabun-Medium.ttf": ["fonts/Sarabun-Medium.ttf", "font/ttf"],
  "/fonts/Sarabun-SemiBold.ttf": ["fonts/Sarabun-SemiBold.ttf", "font/ttf"],
  "/style.css": ["style.css", "text/css"],
};
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  const json = (status: number, data: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  if (
    ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? "")
  ) {
    json(403, { error: "Host ไม่ได้รับอนุญาต" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/klines") {
      const upstream = await klinesRoute(new Request(url));
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      res.end(await upstream.text());
      return;
    }
    if (req.method === "GET" && files[url.pathname]) {
      const [file, mime] = files[url.pathname];
      res.writeHead(200, {
        "Content-Type": mime.startsWith("font/")
          ? mime
          : `${mime}; charset=utf-8`,
      });
      res.end(await readFile(path.join(root, file)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/datasets") {
      json(200, { snapshots: await listDatasets() }); return;
    }
    if (req.method === "GET" && url.pathname === "/api/local/status") {
      json(200, jobStatus(url.searchParams.get("id") ?? "")); return;
    }
    if (req.method === "GET" && url.pathname === "/api/meta") {
      json(200, {
        strategies: STRATEGIES,
        intervals: INTERVALS,
        maxBars: 10000,
      });
      return;
    }
    if (
      req.method !== "POST" ||
      !["/api/backtest", "/api/detail", "/api/export", "/api/local/start", "/api/local/view", "/api/local/cancel"].includes(url.pathname)
    ) {
      json(404, { error: "ไม่พบหน้าที่ขอ" });
      return;
    }
    const origin = req.headers.origin;
    if (
      (origin &&
        ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
          origin,
        )) ||
      !req.headers["content-type"]?.startsWith("application/json")
    ) {
      json(403, { error: "คำขอต้องมาจาก Web UI นี้" });
      return;
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16000) {
        json(413, { error: "คำขอใหญ่เกินไป" });
        return;
      }
    }
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      json(400, { error: "JSON ไม่ถูกต้อง" });
      return;
    }
    if (url.pathname.startsWith("/api/local/")) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid request");
      const value = input as Record<string, unknown>;
      if (url.pathname === "/api/local/start") {
        const cfg = validate(input);
        if (cfg.source !== "local") throw Error("ต้องเลือกข้อมูลในเครื่อง");
        json(202, { runId: startJob(cfg) });
      } else if (url.pathname === "/api/local/cancel") {
        cancelJob(String(value.runId)); json(200, { cancelled: true });
      } else json(200, await jobView(String(value.runId), value));
      return;
    }
    if (busy) {
      json(429, { error: "กำลังทดสอบอยู่ กรุณารอให้รอบปัจจุบันเสร็จ" });
      return;
    }
    busy = true;
    try {
      for (const [id, run] of runs)
        if (Date.now() - run.at > 30 * 60000) runs.delete(id);
      if (url.pathname === "/api/export") {
        const request = validateExport(input);
        const run = runs.get(request.runId);
        if (!run) {
          json(410, { error: "ผลทดสอบหมดอายุ กรุณารันทดสอบใหม่ก่อน Export" });
          return;
        }
        const archive = createExport(
          request.runId,
          run,
          request.strategies,
          exportSources,
        );
        const stamp = new Date(run.at).toISOString().replace(/[:.]/g, "-");
        const filename = `signal-export-${run.cfg.symbol}-${run.cfg.interval}-${stamp}.zip`;
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": archive.length,
        });
        res.end(archive);
        return;
      }
      if (url.pathname === "/api/detail") {
        const { runId, strategy } = input as {
          runId: string;
          strategy: StrategyId;
        };
        const run = runs.get(runId);
        if (!run) {
          json(410, { error: "ผลทดสอบหมดอายุ กรุณารันทดสอบอีกครั้ง" });
          return;
        }
        if (!STRATEGIES.some((s) => s.id === strategy)) {
          json(400, { error: "ไม่พบกลยุทธ์" });
          return;
        }
        json(
          200,
          analyze(
            run.data.klines,
            run.data.start,
            strategy,
            run.cfg.params[strategy],
            run.cfg.fee,
            run.cfg.slippage,
            run.cfg.mode,
            true,
          ),
        );
        return;
      }
      const cfg = validate(input);
      if (cfg.source === "local") throw Error("ใช้ /api/local/start สำหรับข้อมูลในเครื่อง");
      const data = await loadData(cfg);
      const strategies =
        cfg.strategy === "all"
          ? STRATEGIES.filter((s) => s.id !== cfg.selected).map((s) => s.id)
          : [];
      const detail = analyze(
        data.klines,
        data.start,
        cfg.selected,
        cfg.params[cfg.selected],
        cfg.fee,
        cfg.slippage,
        cfg.mode,
        true,
      );
      const results = [
        detail,
        ...strategies.map((id) =>
          analyze(
            data.klines,
            data.start,
            id,
            cfg.params[id],
            cfg.fee,
            cfg.slippage,
            cfg.mode,
            false,
          ),
        ),
      ];
      const runId = randomUUID();
      while (runs.size >= 3) runs.delete(runs.keys().next().value!);
      runs.set(runId, { at: Date.now(), cfg, data });
      json(200, {
        runId,
        config: cfg,
        warnings: data.warnings,
        warmup: data.start,
        klines: data.klines.slice(data.start),
        results,
      });
    } finally {
      busy = false;
    }
  } catch (e) {
    json(400, { error: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" });
  }
});
server.requestTimeout = 180000;
// Capture the same source version for every run in this server process.
// Export never reads .env, bot state, credentials or arbitrary filesystem paths.
captureExportSources()
  .then((sources) => {
    exportSources = sources;
    server.listen(port, "127.0.0.1", () =>
      console.log(`Signal Lab: http://127.0.0.1:${port}`),
    );
  })
  .catch((error) => {
    console.error("Cannot initialize export sources:", error);
    process.exitCode = 1;
  });
