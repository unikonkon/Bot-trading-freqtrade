import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { STRATEGIES, type StrategyId } from "../../lib/backtest";
import type { RequestConfig, loadData } from "./data";
import { calculateExport, RULES } from "./export-calculations";
import { zipFiles } from "./zip";

export interface ExportRun {
  at: number;
  cfg: RequestConfig;
  data: Awaited<ReturnType<typeof loadData>>;
}
const CODE_FILES = [
  "lib/indicators.ts",
  "lib/backtest.ts",
  "lib/types/kline.ts",
  "signal-bot/web ui/engine.ts",
  "signal-bot/web ui/export-calculations.ts",
  "signal-bot/web ui/evaluate-klines.ts",
  "signal-bot/web ui/replay.ts",
  "package-lock.json",
];
export async function captureExportSources() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  return Object.fromEntries(
    await Promise.all(
      CODE_FILES.map(async (file) => [
        file,
        await readFile(path.join(root, file), "utf8"),
      ]),
    ),
  );
}
export function validateExport(input: unknown): {
  runId: string;
  strategies: StrategyId[];
} {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("คำขอ Export ไม่ถูกต้อง");
  const v = input as Record<string, unknown>;
  if (typeof v.runId !== "string" || v.runId.length > 100 || !v.runId)
    throw new Error("ต้องระบุรอบทดสอบ");
  if (
    !Array.isArray(v.strategies) ||
    !v.strategies.length ||
    v.strategies.length > STRATEGIES.length
  )
    throw new Error(`เลือกอย่างน้อย 1 กลยุทธ์ และไม่เกิน ${STRATEGIES.length} กลยุทธ์`);
  if (
    !v.strategies.every(
      (id) => typeof id === "string" && STRATEGIES.some((s) => s.id === id),
    )
  )
    throw new Error("ไม่พบกลยุทธ์ที่เลือก");
  if (new Set(v.strategies).size !== v.strategies.length)
    throw new Error("มีกลยุทธ์ซ้ำ");
  const ids = v.strategies as string[];
  return {
    runId: v.runId,
    strategies: STRATEGIES.filter((s) => ids.includes(s.id)).map((s) => s.id),
  };
}
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // Text cells from metadata cannot become spreadsheet formulas.
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function csv(rows: unknown[][]) {
  return (
    "\uFEFF" +
    rows.map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function buildExportFiles(
  runId: string,
  run: ExportRun,
  ids: StrategyId[],
  sources: Record<string, string>,
) {
  const cfg = run.cfg,
    k = run.data.klines,
    start = run.data.start;
  const files: Record<string, string> = { ...sources };
  const config = {
    schemaVersion: 1,
    runId,
    runAt: new Date(run.at).toISOString(),
    exportedAt: new Date().toISOString(),
    symbol: cfg.symbol,
    interval: cfg.interval,
    source: cfg.source,
    requested: { from: cfg.from ?? null, to: cfg.to ?? null, limit: cfg.limit },
    startIndex: start,
    confirmedPivots: true,
    strategies: ids,
    params: Object.fromEntries(ids.map((id) => [id, cfg.params[id]])),
    fee: cfg.fee,
    slippage: cfg.slippage,
    mode: cfg.mode,
    timezone: "Asia/Bangkok",
    signalTimezone: "UTC",
    inputFormat: "KlineData[] (normalized Binance klines; includes warmup)",
    actual: {
      from: k[start].openTime,
      to: k.at(-1)!.closeTime,
      bars: k.length - start,
      warmup: start,
    },
    warnings: run.data.warnings,
  };
  files["config.json"] = json(config);
  files["input-klines.json"] = json(k);
  files["input-klines.csv"] = csv([
    [
      "index",
      "isWarmup",
      "openTime",
      "closeTime",
      "open",
      "high",
      "low",
      "close",
      "volume",
    ],
    ...k.map((b, i) => [
      i,
      i < start,
      b.openTime,
      b.closeTime,
      b.open,
      b.high,
      b.low,
      b.close,
      b.volume,
    ]),
  ]);
  const summary: unknown[][] = [
    [
      "strategy",
      "mode",
      "returnPct",
      "maxDrawdown",
      "drawdownUnit",
      "winRate",
      "totalTrades",
      "profitFactor",
    ],
  ];
  for (const id of ids) {
    const calc = calculateExport(
      k,
      start,
      id,
      cfg.params[id],
      cfg.fee,
      cfg.slippage,
      cfg.mode,
    );
    files[`calculations/${id}.json`] = json(calc);
    const keys = Object.keys(calc.series);
    files[`signals/${id}.json`] = json(calc.records);
    files[`signals/${id}.csv`] = csv([
      [
        "symbol",
        "interval",
        "strategy",
        "inputIndex",
        "openTime",
        "closeTime",
        "signalTimeUtc",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "previousClose",
        "signal",
        "reason",
        ...keys,
        ...keys.map((key) => "previous." + key),
        "events",
      ],
      ...calc.records.map((r) => [
        cfg.symbol,
        cfg.interval,
        id,
        r.index,
        r.openTime,
        r.closeTime,
        r.signalTimeUtc,
        r.open,
        r.high,
        r.low,
        r.close,
        r.volume,
        r.previousClose,
        r.signal,
        r.reason,
        ...keys.map((key) => r.current[key]),
        ...keys.map((key) => r.previous[key]),
        r.events,
      ]),
    ]);
    for (const sim of calc.simulations) {
      summary.push([
        id,
        sim.mode,
        sim.returnPct,
        sim.maxDrawdownPct,
        sim.mode === "legacy" ? "percentage_points" : "percent",
        sim.winRate,
        sim.totalTrades,
        sim.profitFactor === null ? "Infinity" : sim.profitFactor,
      ]);
      files[`trades/${id}-${sim.mode}.csv`] = csv([
        [
          "entryIdx",
          "entryTime",
          "entryPrice",
          "exitIdx",
          "exitTime",
          "exitPrice",
          "pnlPct",
          "bars",
          "reason",
        ],
        ...sim.trades.map((t) => [
          t.entryIdx,
          t.entryTime,
          t.entryPrice,
          t.exitIdx,
          t.exitTime,
          t.exitPrice,
          t.pnlPct,
          t.bars,
          t.reason,
        ]),
      ]);
    }
  }
  files["summary.csv"] = csv(summary);
  files["rules.md"] =
    "# เงื่อนไขสัญญาณตามโค้ดที่แนบ\n\n" +
    ids
      .map(
        (id) =>
          `## ${STRATEGIES.find((s) => s.id === id)!.name}\n\nพารามิเตอร์: \`${JSON.stringify(cfg.params[id])}\`\n\n${RULES[id]}\n`,
      )
      .join("\n");
  const lock = JSON.parse(sources["package-lock.json"]);
  const pkg = lock.packages[""];
  files["package.json"] = json({
    ...pkg,
    private: true,
    scripts: {
      replay: 'tsx "signal-bot/web ui/replay.ts"',
      typecheck: "tsc --noEmit",
    },
    engines: { node: ">=20" },
  });
  files["tsconfig.json"] = json({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      baseUrl: ".",
      paths: { "@/*": ["./*"] },
      noEmit: true,
    },
    include: ["lib/**/*.ts", "signal-bot/**/*.ts"],
  });
  files["README.md"] =
    `# Signal bot — Export ผลคำนวณและโค้ด\n\nรอบทดสอบ ${runId}\n\n${cfg.symbol} / ${cfg.interval}; ${ids.length} กลยุทธ์; ${k.length - start} แท่งทดสอบ + ${start} warmup\n\n## คำนวณซ้ำ\n\nใช้ Node.js 20+ รันจากโฟลเดอร์ที่แตก ZIP:\n\n\`\`\`bash\nnpm ci\nnpm run replay\n\`\`\`\n\nติดตั้ง dependency ครั้งแรกต้องใช้อินเทอร์เน็ต หลังติดตั้งแล้ว replay ไม่เรียก Binance/Telegram ตรวจ SHA-256 ทุกไฟล์ใน manifest ก่อนคำนวณ และตรวจผลทั้งหมดตรงกับ calculations/*.json ก่อนเขียน recomputed/*.json\n\n## ไฟล์\n\n- config.json: พารามิเตอร์ที่ใช้ในรอบเดิม ไม่ใช่ฟอร์มที่แก้ภายหลัง\n- input-klines.json: KlineData[] ที่แปลงจาก Binance รวม warmup ไม่ใช่ raw array ต้นฉบับ\n- input-klines.csv: แท่งทั้งหมดพร้อม isWarmup\n- calculations/*.json: indicator ของกลยุทธ์ที่เลือกแบบเต็ม รวม warmup, series, records และ simulations\n- signals/*.csv / *.json: เฉพาะช่วงทดสอบ รวม HOLD พร้อมค่าปัจจุบัน/ก่อนหน้า และ events\n- trades/*.csv: เทรดจำลองแต่ละโหมด แยกจากสัญญาณ\n- summary.csv: สรุปผลการจำลอง\n- rules.md: เงื่อนไขจริงของกลยุทธ์ที่เลือก\n- lib/ และ signal-bot/web ui/: โค้ดคำนวณร่วม snapshot ตอนเริ่ม server; shared library มีครบทุกกลยุทธ์ แต่ replay รันเฉพาะกลยุทธ์ที่เลือก\n\n## ใช้กับ API อื่น\n\nนำ raw JSON จาก Binance หรือ api/klines/route.ts ไปส่งเข้า evaluateKlines ใน signal-bot/web ui/evaluate-klines.ts:\n\n\`\`\`ts\nimport { evaluateKlines } from './signal-bot/web ui/evaluate-klines';\nconst output = evaluateKlines(rawKlines, '${ids[0]}', ${JSON.stringify(cfg.params[ids[0]])});\n// [{ openTime, signalTime, price, signal: 'BUY' | 'SELL' | 'HOLD' }]\n\`\`\`\n\nadapter รับข้อมูลที่เรียงเวลาและตัดแท่งไม่ปิดเอง; หากต้องการผลตรงชุดนี้ ใช้ input-klines.json + params ใน config และ computeSignals ตาม replay ซึ่งรวม warmup เดียวกัน\n\n## ความหมายและข้อจำกัด\n\nเวลาใน CSV เป็น UTC ISO หรือ epoch milliseconds; UI แสดง Asia/Bangkok. signalTime = closeTime. index และ event indices อ้าง input-klines.json รวม warmup เสมอ ไม่ใช่เลขแถว CSV. null คือไม่มีค่า ไม่แปลงเป็น 0. CSV ใช้ UTF-8 BOM สำหรับภาษาไทย\n\nBUY/SELL เป็นสัญญาณ ไม่ใช่การส่งคำสั่งซื้อขายหรือการส่ง Telegram. RSI อาจส่งสัญญาณติดกันหลายแท่ง. HOLD อาจเกิดจากไม่ผ่านเงื่อนไขหรือข้อมูลเตรียมไม่พอ. โครงสร้าง SMC/OB บางรายการมีสถานะสุดท้ายของชุดข้อมูล ไม่ใช่ snapshot สถานะทุกแท่ง; records.events ใช้เหตุการณ์ที่ index ของแท่งนั้น\n\nเปิดแท่งถัดไป: Long เต็มพอร์ต เริ่ม 100 หน่วย ทบต้น หัก fee/slippage ต่อขา; drawdown รวมมูลค่าถือ ณ ปิดแท่ง. โหมดเดิม: ราคาปิดแท่งสัญญาณ ผลรวม % รายเทรด ไม่มี slippage และ drawdown เป็นจุดเปอร์เซ็นต์; เวลาเทรดยังคง openTime ตาม engine เดิม. ทั้งสองโหมดบังคับปิดท้ายข้อมูล\n\nที่มาราคาคือ backend เดิมที่ดึง Binance public klines โดยตรง รูปแบบเดียวกับ api/klines/route.ts ไม่ได้เรียก Next.js route นี้ ข้อมูลจากรอบเดิม ไม่มีการดึงใหม่ตอน Export. ทุกกลยุทธ์ใช้ confirmed pivots; ประวัติสะสมอาจต่างจาก rolling window ของบอทจริง\n\n${run.data.warnings.map((w) => "- " + w).join("\n")}\n`;
  files["manifest.json"] = json({
    schemaVersion: 1,
    algorithm: "sha256",
    sha256: Object.fromEntries(
      Object.entries(files).map(([name, data]) => [name, hash(data)]),
    ),
  });
  return files;
}
export function createExport(
  runId: string,
  run: ExportRun,
  ids: StrategyId[],
  sources: Record<string, string>,
) {
  return zipFiles(buildExportFiles(runId, run, ids, sources));
}
