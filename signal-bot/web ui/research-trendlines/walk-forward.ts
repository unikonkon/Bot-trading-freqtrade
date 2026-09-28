/**
 * Walk-forward ของ Trendlines with Breaks: "ซื้อขายเร็วขึ้น" ได้กำไรมากกว่าบอทเดิมจริงไหม
 * อ่านจาก snapshot ในเครื่องเท่านั้น (ไม่เรียก Binance) · ไม่ยิงออเดอร์
 *
 *   npm run web:tl:download                     # ครั้งแรก: สร้าง snapshot
 *   npm run web:tl:wf                           # snapshot ล่าสุด ทุก timeframe
 *   npm run web:tl:wf -- tl-20260928 --tf 4h,1d --fee 0.1 --slip 0.05 --force
 *
 * ทุก timeframe แบ่งเวลาเป็นช่วงต่อกัน: เลือกค่าบนช่วง train → วัดผลบนช่วง test ถัดไป → เลื่อนไปทีละช่วง test
 * ผลช่วง test ทุกช่วงต่อกันเป็นผล out-of-sample ของ "วิธีเลือกค่า" นั้น
 *
 * ผลเก็บที่ results/<snapshot>/wf-<tf>.json + report.md
 * รันซ้ำด้วยข้อมูล ตัวจำลอง และตัวเลือกเดิม จะอ่านผลจาก cache ทันที (--force = คำนวณใหม่)
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../../../lib/backtest";
import type { KlineData } from "../../../lib/types/kline";
import { DATA_DIR, RANGES, sha256, type Manifest } from "./download";
import { simulate, toSeries, trendLines, VARIANT_LABEL, VARIANTS, type Chain, type Costs, type Result, type Variant } from "./sim";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DAY = 86_400_000;
/** ความยาวช่วง train / test (วัน) ต่อ timeframe */
const WF: Record<string, { train: number; test: number }> = {
  "15m": { train: 60, test: 30 },
  "1h": { train: 270, test: 90 },
  "4h": { train: 540, test: 180 },
  "1d": { train: 1095, test: 365 },
};
const WARM = 200;              // แท่งอุ่นเครื่องก่อน train ช่วงแรกของแต่ละเหรียญ
const LENS = [5, 7, 10, 14, 20, 28, 40, 56];
const BASE = "A@14";           // ค่าตั้งต้นของบอทบนเว็บ
const MIN_COINS = 3;           // ช่วงที่มีเหรียญพร้อมน้อยกว่านี้ไม่นับ

// ─── CLI ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const snapshot: string = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"))
  ?? (existsSync(DATA_DIR) ? readdirSync(DATA_DIR) : []).filter((d) => existsSync(path.join(DATA_DIR, d, "manifest.json"))).sort().at(-1)
  ?? (() => { throw Error("ไม่พบ snapshot — รัน npm run web:tl:download ก่อน"); })();
const TFS = (flag("tf") ?? Object.keys(WF).join(",")).split(",");
const COST: Costs = { feePct: +(flag("fee") ?? 0.1), slipPct: +(flag("slip") ?? 0.05) };
const FORCE = argv.includes("--force");
/** ต้นทุนไม่ใช่ค่าตั้งต้น → แยกไฟล์ผล เพื่อไม่ทับ cache ของชุดหลัก */
const SUFFIX = COST.feePct === 0.1 && COST.slipPct === 0.05 ? "" : `-fee${COST.feePct}-slip${COST.slipPct}`;
for (const tf of TFS) if (!WF[tf]) throw Error(`ไม่รองรับ timeframe ${tf}`);

const cfgKey = (v: Variant, len: number) => `${v}@${len}`;
const CONFIGS = VARIANTS.flatMap((v) => LENS.map((len) => ({ v, len, key: cfgKey(v, len) })));
/** 3 วิธีเลือกค่าบน train: ทุกแบบ×ทุก length · เฉพาะ length ของบอทเดิม · เฉพาะแบบที่ length 14 */
const PROCEDURES: Record<string, { label: string; pool: string[] }> = {
  all: { label: "WF เลือกทั้งแบบและ length", pool: CONFIGS.map((c) => c.key) },
  len: { label: "WF เลือกแค่ length ของบอทเดิม", pool: LENS.map((len) => cfgKey("A", len)) },
  variant: { label: "WF เลือกแค่แบบ (length 14)", pool: VARIANTS.map((v) => cfgKey(v, 14)) },
};

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const median = (a: number[]) => {
  if (!a.length) return NaN;
  const b = [...a].sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
const lowerBound = (t: Float64Array, x: number) => {
  let lo = 0, hi = t.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
};

// ─── Data ───────────────────────────────────────────────────────
const snapDir = path.join(DATA_DIR, snapshot);
const manifest: Manifest = JSON.parse(readFileSync(path.join(snapDir, "manifest.json"), "utf8"));
function loadFile(name: string): KlineData[] {
  const text = readFileSync(path.join(snapDir, name), "utf8");
  assert.equal(sha256(text), manifest.files[name].sha256, `checksum ไม่ตรง: ${name}`);
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

// ─── Walk-forward ต่อ timeframe ──────────────────────────────────
interface Fold { trainStart: number; testStart: number; testEnd: number; coins: string[] }
type Cell = { train: Record<string, number>; test: Record<string, Result>; bh: number };
interface ChainOut { comp: number; mdd: number; trades: number; folds: number }
interface TfResult {
  key: string; snapshot: string; asOf: number; tf: string; cost: Costs; train: number; test: number;
  folds: Fold[];
  cells: Record<string, (Cell | null)[]>;
  fixed: Record<string, Record<string, ChainOut>>;        // coin → config → ผล OOS ต่อกัน
  bh: Record<string, ChainOut>;
  procedures: Record<string, { selected: string[]; perCoin: Record<string, ChainOut> }>;
  check: { symbol: string; sim: number; runBacktest: number };
}

function runTf(tf: string): TfResult {
  const { train, test } = WF[tf];
  const ms = RANGES[tf].ms;
  const names = Object.keys(manifest.files).filter((n) => manifest.files[n].interval === tf).sort();
  if (!names.length) throw Error(`snapshot ${snapshot} ไม่มี ${tf}`);
  const key = sha256(JSON.stringify({
    data: names.map((n) => manifest.files[n].sha256), cost: COST, WF: WF[tf], WARM, LENS, MIN_COINS,
    code: [readFileSync(path.join(HERE, "sim.ts"), "utf8"), readFileSync(fileURLToPath(import.meta.url), "utf8")].map(sha256),
  }));
  const out = path.join(HERE, "results", snapshot, `wf-${tf}${SUFFIX}.json`);
  if (!FORCE && existsSync(out)) {
    const cached: TfResult = JSON.parse(readFileSync(out, "utf8"));
    if (cached.key === key) { console.log(`${tf}: ใช้ผลจาก cache`); return cached; }
  }

  // ช่วงเวลา: เริ่มเมื่อเหรียญแรกอุ่นเครื่องครบ · ช่วง test สุดท้ายต้องยาวอย่างน้อยครึ่งหนึ่ง
  const starts = Object.fromEntries(names.map((n) => [manifest.files[n].symbol, manifest.files[n].from + WARM * ms]));
  const end = Math.max(...names.map((n) => manifest.files[n].to)) + 1;
  const t0 = Math.min(...Object.values(starts));
  const folds: Fold[] = [];
  for (let ts = t0 + train * DAY; end - ts >= (test * DAY) / 2; ts += test * DAY) {
    const coins = Object.keys(starts).filter((s) => starts[s] <= ts - train * DAY).sort();
    if (coins.length >= MIN_COINS) folds.push({ trainStart: ts - train * DAY, testStart: ts, testEnd: Math.min(end, ts + test * DAY), coins });
  }

  const cells: TfResult["cells"] = {}, fixed: TfResult["fixed"] = {}, bh: TfResult["bh"] = {};
  const series: Record<string, { k: KlineData[]; t: Float64Array }> = {};
  let check: TfResult["check"] | undefined;
  const t1 = Date.now();
  for (const name of names) {
    const symbol = manifest.files[name].symbol;
    const k = loadFile(name), S = toSeries(k), t = Float64Array.from(k, (x) => x.openTime);
    series[symbol] = { k, t };
    const idx = (x: number) => lowerBound(t, x);
    cells[symbol] = folds.map(() => null);
    const chains: Record<string, Chain> = Object.fromEntries(CONFIGS.map((c) => [c.key, { eq: 1, peak: 1, mdd: 0 }]));
    const trades: Record<string, number> = Object.fromEntries(CONFIGS.map((c) => [c.key, 0]));
    const bhChain: Chain = { eq: 1, peak: 1, mdd: 0 };
    let nFolds = 0;
    for (const len of LENS) {
      const L = trendLines(k, len);
      folds.forEach((f, fi) => {
        if (!f.coins.includes(symbol)) return;
        const a = idx(f.trainStart), b = idx(f.testStart), e = idx(f.testEnd);
        const cell = (cells[symbol][fi] ??= { train: {}, test: {}, bh: 0 });
        for (const v of VARIANTS) {
          const key = cfgKey(v, len);
          cell.train[key] = r4(simulate(S, L, v, a, b, COST).comp);
          const r = simulate(S, L, v, b, e, COST, chains[key]);
          cell.test[key] = { comp: r4(r.comp), sum: r4(r.sum), mdd: r4(r.mdd), trades: r.trades, wins: r.wins };
          trades[key] += r.trades;
        }
        if (len === LENS[0]) {
          nFolds++;
          for (let i = b; i < e; i++) {
            const ce = bhChain.eq * (S.c[i] / S.c[b]);
            bhChain.peak = Math.max(bhChain.peak, ce); bhChain.mdd = Math.max(bhChain.mdd, 1 - ce / bhChain.peak);
          }
          cell.bh = r4((S.c[e - 1] / S.c[b] - 1) * 100);
          bhChain.eq *= S.c[e - 1] / S.c[b];
        }
      });
      // ตรวจว่าแบบ A = runBacktest ของเว็บ (ผลรวม % ต่อไม้) บนช่วง OOS ทั้งหมดของเหรียญแรก
      if (!check && len === 14) {
        const s = idx(folds.find((f) => f.coins.includes(symbol))!.testStart);
        const sim = simulate(S, L, "A", s, k.length, COST).sum;
        const web = runBacktest(k, "trendlines", { trendLength: 14, trendMult: 1 }, COST.feePct, { startIndex: s, lazyIndicators: true }).totalPnlPct;
        assert.ok(Math.abs(sim - web) < 1e-6, `แบบ A ไม่ตรงกับ runBacktest: ${sim} vs ${web}`);
        check = { symbol, sim: r4(sim), runBacktest: r4(web) };
      }
    }
    fixed[symbol] = Object.fromEntries(CONFIGS.map((c) => [c.key, {
      comp: r4((chains[c.key].eq - 1) * 100), mdd: r4(chains[c.key].mdd * 100), trades: trades[c.key], folds: nFolds,
    }]));
    bh[symbol] = { comp: r4((bhChain.eq - 1) * 100), mdd: r4(bhChain.mdd * 100), trades: 0, folds: nFolds };
  }

  // เลือกค่าต่อช่วง: median ผลทบต้นบน train ข้ามเหรียญสูงสุด · เสมอกันเลือกค่าบอทเดิมก่อน
  const procedures: TfResult["procedures"] = {};
  for (const [pid, { pool }] of Object.entries(PROCEDURES)) {
    const selected = folds.map((f, fi) => {
      let best = pool.includes(BASE) ? BASE : pool[0], bestVal = -Infinity;
      for (const key of [best, ...pool.filter((p) => p !== best)]) {
        const m = median(f.coins.map((s) => cells[s][fi]!.train[key]));
        if (m > bestVal + 1e-9) { best = key; bestVal = m; }
      }
      return best;
    });
    // ต่อ equity ของค่าที่เลือกในแต่ละช่วง (ต้องจำลองใหม่เพื่อให้ drawdown ข้ามรอยต่อถูกต้อง)
    const perCoin: Record<string, ChainOut> = {};
    for (const symbol of Object.keys(series)) {
      const { k, t } = series[symbol], S = toSeries(k), lines = new Map<number, ReturnType<typeof trendLines>>();
      const chain: Chain = { eq: 1, peak: 1, mdd: 0 };
      let n = 0, nf = 0;
      folds.forEach((f, fi) => {
        if (!f.coins.includes(symbol)) return;
        const [v, lenStr] = selected[fi].split("@"), len = +lenStr;
        if (!lines.has(len)) lines.set(len, trendLines(k, len));
        n += simulate(S, lines.get(len)!, v as Variant, lowerBound(t, f.testStart), lowerBound(t, f.testEnd), COST, chain).trades;
        nf++;
      });
      perCoin[symbol] = { comp: r4((chain.eq - 1) * 100), mdd: r4(chain.mdd * 100), trades: n, folds: nf };
    }
    procedures[pid] = { selected, perCoin };
  }
  console.log(`${tf}: ${names.length} เหรียญ · ${folds.length} ช่วง · ${((Date.now() - t1) / 1000).toFixed(1)} วินาที`);

  const res: TfResult = { key, snapshot, asOf: manifest.asOf, tf, cost: COST, train, test, folds, cells, fixed, bh, procedures, check: check! };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(res));
  return res;
}

// ─── Report ─────────────────────────────────────────────────────
const pct = (x: number) => (Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
const date = (t: number) => new Date(t).toISOString().slice(0, 10);
const cfgLabel = (key: string) => { const [v, len] = key.split("@"); return `${v} · L${len}`; };

function summarize(r: TfResult, rows: { label: string; per: Record<string, ChainOut> }[]) {
  const coins = Object.keys(r.fixed), base = Object.fromEntries(coins.map((s) => [s, r.fixed[s][BASE].comp]));
  return rows.map(({ label, per }) => ({
    label,
    med: median(coins.map((s) => per[s].comp)),
    mean: coins.reduce((a, s) => a + per[s].comp, 0) / coins.length,
    beat: coins.filter((s) => per[s].comp > base[s] + 1e-9).length,
    mdd: median(coins.map((s) => per[s].mdd)),
    trades: median(coins.map((s) => per[s].trades)),
  }));
}

function report(results: TfResult[]) {
  const L: string[] = [];
  const r0 = results[0];
  L.push(`# Walk-forward: Trendlines with Breaks ซื้อขายเร็วขึ้นได้กำไรมากกว่าไหม`, "");
  L.push(`snapshot \`${r0.snapshot}\` · ข้อมูลถึง ${new Date(r0.asOf).toISOString().slice(0, 16).replace("T", " ")} UTC · Long อย่างเดียว · fee ${r0.cost.feePct}%/ขา · slippage ของ stop order ${r0.cost.slipPct}%/ขา`, "");
  L.push("รันซ้ำ: `npm run web:tl:wf` (อ่าน cache ถ้าไม่มีอะไรเปลี่ยน) · คำนวณใหม่: `npm run web:tl:wf -- --force` · ข้อมูลชุดใหม่: `npm run web:tl:download`", "");
  L.push("**วิธีอ่าน** แต่ละช่วงเลือกค่าจากช่วง train แล้ววัดผลบนช่วง test ถัดไปที่ไม่เคยเห็น ผลช่วง test ทุกช่วงต่อกันแบบทบต้นเป็น \"ผล OOS\" ของแต่ละเหรียญ ตารางใช้ median ข้ามเหรียญ · \"ชนะบอทเดิม\" = จำนวนเหรียญที่ผล OOS สูงกว่า A · L14", "");
  L.push("| แบบ | ความหมาย |", "|---|---|");
  for (const v of VARIANTS) L.push(`| ${v} | ${VARIANT_LABEL[v]} |`);
  L.push("");

  L.push("## สรุปทุก timeframe (median ผล OOS)", "");
  L.push("| TF | ช่วง OOS | Buy&Hold | บอทเดิม A·L14 | WF ทั้งหมด | WF length | WF แบบ | fixed ดีสุด (ชนะ/เหรียญ) |", "|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const coins = Object.keys(r.fixed);
    const fixedRows = summarize(r, Object.keys(r.fixed[coins[0]]).map((key) => ({ label: key, per: Object.fromEntries(coins.map((s) => [s, r.fixed[s][key]])) })));
    const bestFixed = [...fixedRows].sort((a, b) => b.med - a.med)[0];
    const proc = summarize(r, Object.entries(r.procedures).map(([id, p]) => ({ label: id, per: p.perCoin })));
    const base = fixedRows.find((x) => x.label === BASE)!;
    L.push(`| ${r.tf} | ${date(r.folds[0].testStart)} → ${date(r.folds.at(-1)!.testEnd)} | ${pct(median(coins.map((s) => r.bh[s].comp)))} | ${pct(base.med)} | ${proc.map((p) => `${pct(p.med)} (${p.beat}/${coins.length})`).join(" | ")} | ${cfgLabel(bestFixed.label)} ${pct(bestFixed.med)} (${bestFixed.beat}/${coins.length}) |`);
  }
  L.push("", "\"fixed ดีสุด\" เลือกจากผล OOS เอง จึงมองเห็นอนาคต ใช้ดูเพดานเท่านั้น ไม่ใช่ผลที่ทำได้จริง", "");

  for (const r of results) {
    const coins = Object.keys(r.fixed);
    L.push(`## ${r.tf} · train ${r.train} วัน → test ${r.test} วัน · ${r.folds.length} ช่วง · ${coins.length} เหรียญ`, "");
    L.push(`ตรวจแล้ว: แบบ A บน ${r.check.symbol} ได้ผลรวม ${r.check.sim.toFixed(4)}% เท่ากับ runBacktest ของเว็บ (${r.check.runBacktest.toFixed(4)}%)`, "");
    const rows = summarize(r, [
      { label: "Buy & Hold", per: r.bh },
      { label: "บอทเดิม A · L14", per: Object.fromEntries(coins.map((s) => [s, r.fixed[s][BASE]])) },
      ...Object.entries(r.procedures).map(([id, p]) => ({ label: PROCEDURES[id].label, per: p.perCoin })),
      ...VARIANTS.filter((v) => v !== "A").map((v) => ({ label: `${v} · L14 คงที่`, per: Object.fromEntries(coins.map((s) => [s, r.fixed[s][cfgKey(v, 14)]])) })),
    ]);
    L.push("| วิธี | median OOS | ค่าเฉลี่ย | ชนะบอทเดิม | median DD | median ไม้ |", "|---|---|---|---|---|---|");
    for (const x of rows) L.push(`| ${x.label} | ${pct(x.med)} | ${pct(x.mean)} | ${x.label === "บอทเดิม A · L14" ? "—" : `${x.beat}/${coins.length}`} | ${x.mdd.toFixed(1)}% | ${Math.round(x.trades)} |`);
    L.push("");

    // ช่วงต่อช่วง: ค่าที่ WF เลือก เทียบบอทเดิมบนช่วง test เดียวกัน
    L.push("| ช่วง test | เหรียญ | WF ทั้งหมดเลือก | ผล test ค่าที่เลือก | บอทเดิม | Buy&Hold |", "|---|---|---|---|---|---|");
    r.folds.forEach((f, fi) => {
      const sel = r.procedures.all.selected[fi];
      const m = (key: string) => median(f.coins.map((s) => r.cells[s][fi]!.test[key].comp));
      L.push(`| ${date(f.testStart)} → ${date(f.testEnd)} | ${f.coins.length} | ${cfgLabel(sel)} | ${pct(m(sel))} | ${pct(m(BASE))} | ${pct(median(f.coins.map((s) => r.cells[s][fi]!.bh)))} |`);
    });
    L.push("");

    // เหรียญต่อเหรียญ
    L.push("<details><summary>ผล OOS รายเหรียญ</summary>", "", "| เหรียญ | ช่วง | Buy&Hold | บอทเดิม | WF ทั้งหมด | D1 · L14 | G3 · L14 |", "|---|---|---|---|---|---|---|");
    for (const s of coins)
      L.push(`| ${s} | ${r.fixed[s][BASE].folds} | ${pct(r.bh[s].comp)} | ${pct(r.fixed[s][BASE].comp)} | ${pct(r.procedures.all.perCoin[s].comp)} | ${pct(r.fixed[s]["D1@14"].comp)} | ${pct(r.fixed[s]["G3@14"].comp)} |`);
    L.push("", "</details>", "");
  }
  L.push("## ข้อจำกัด", "");
  L.push("- เลือกเหรียญจากเหรียญใหญ่ที่ยังอยู่ในปัจจุบัน (survivorship bias) ผลจึงอาจดีกว่าการเลือกเหรียญล่วงหน้าจริง");
  L.push("- stop order กลางแท่ง (D, D1, D2) รู้แค่ราคาสูง/ต่ำของแท่ง ไม่รู้ลำดับภายในแท่ง · fill ที่ราคาเส้นบวก slippage คงที่");
  L.push("- ไม่รวม Short, funding และขนาดออเดอร์ขั้นต่ำ · แต่ละช่วง test เริ่มสถานะว่างและปิดไม้ค้างตอนจบช่วง");
  const file = path.join(HERE, "results", r0.snapshot, `report${SUFFIX}.md`);
  writeFileSync(file, L.join("\n") + "\n");
  return file;
}

const results = TFS.map(runTf);
console.log(`\nรายงาน: ${path.relative(process.cwd(), report(results))}`);
