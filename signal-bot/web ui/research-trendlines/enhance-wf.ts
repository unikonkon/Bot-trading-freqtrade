/**
 * Trendlines with Breaks + indicator เสริม: แบบไหนได้กำไรมากขึ้นจริง โดยจำนวนเทรด ≥ เดิม
 * อ่านจาก snapshot ในเครื่องเท่านั้น (ไม่เรียก Binance) · ไม่ยิงออเดอร์
 *
 *   npm run web:tl:download -- tl-20260928-holdout --symbols holdout --asof-from tl-20260928   # ครั้งแรก
 *   npm run web:tl:enhance                      # เลือกบน tl-20260928 · ตรวจบน tl-20260928-holdout
 *   npm run web:tl:enhance -- tl-20260928 --holdout tl-20260928-holdout --confirm tl-20260928-holdout2 --tf 4h,1d --force
 *
 * ค่าอ้างอิง = Pine ปัจจุบัน: Long ออกตามป้าย · Short TP 8 × ATR + SL 3 × ATR (จาก exits-wf.ts)
 * ทุกแบบเข้าที่ป้ายเดิมทุกไม้ (ดู enhance.ts) · ตรวจว่าไม้ทุกเหรียญทุก TF ≥ ค่าอ้างอิง ไม่ผ่าน = ตัดทิ้ง
 * แต่ละเหรียญจำลองต่อเนื่องตั้งแต่แท่งที่ WARM จนจบข้อมูล (ไม่มีการเลือกค่ารายช่วง จึงไม่ต้องแบ่ง fold)
 *
 * การเลือกและตรวจ:
 *   ต่อกลุ่ม TF (ต่ำ 15m/1h · สูง 4h/1d) และต่อฝั่ง: เลือกบนเหรียญชุดหลักเฉพาะแบบที่ดีขึ้น ≥ 60% ของเหรียญทุก TF ในกลุ่ม
 *   แล้วเอาแบบที่คะแนนเฉลี่ยสูงสุด → ใช้จริงก็ต่อเมื่อบนเหรียญชุดตรวจ (ไม่เคยใช้เลือก) ดีขึ้นทุก TF ในกลุ่ม
 *   ดีขึ้น ≥ ครึ่งหนึ่งของเหรียญ และไม้ไม่ลดลง · ไม่ผ่าน = คงค่าอ้างอิง
 *   leave-one-TF-out ทั้ง 4 TF แสดงไว้ประกอบ (ตอบว่ามีแบบเดียวที่ใช้ได้ทุก TF ไหม)
 * คะแนน = median ข้ามเหรียญของ log((1 + ผลทบต้นแบบใหม่) / (1 + ผลทบต้นค่าอ้างอิง))
 *
 * ผลเก็บที่ results/<snapshot>/enhance-<tf>.json + enhance-report.md
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { cached, HERE, median, openSnapshot, parseCli, pct, r4, sourceHash } from "./common";
import { sha256 } from "./download";
import { EXIT_RULES, simulateExits } from "./exits";
import { cfgLabel, indicators, simulateSide, type Exit, type IndExit, type Regime, type SideCfg, type SideOut, type Trigger } from "./enhance";
import { toSeries, trendLines, type Costs } from "./sim";

const LEN = 14;
const WARM_E = 400;            // EMA200 / ADX / Supertrend อุ่นเครื่องครบก่อนเริ่มนับ
const SIDES = ["long", "short"] as const;
type Side = typeof SIDES[number];
const SIDE_LABEL: Record<Side, string> = { long: "▲ Long", short: "▼ Short" };

// ─── ชุดที่ทดสอบ ─────────────────────────────────────────────────
interface Cand { id: string; family: string; mult: number; cfg: SideCfg }
const X = (rule: string, ind?: IndExit): Exit => ({ rule, ind });
const IND: Record<string, IndExit> = {
  st: { st: true }, ema20: { ema: 20 }, ema50: { ema: 50 }, don10: { don: 10 }, don20: { don: 20 }, rsi75: { rsi: 75 }, rsi80: { rsi: 80 },
};
const FAMILY_LABEL: Record<string, string> = {
  base: "ค่าอ้างอิง (Pine ปัจจุบัน)",
  slope: "ปรับ Slope ของเส้นเดิม",
  regime: "กฎออกตามเทรนด์ (EMA200 / Supertrend / ADX)",
  indexit: "ออกด้วย indicator",
  reentry: "เข้าซ้ำด้วย indicator",
  combo: "กฎออกตามเทรนด์ + เข้าซ้ำ",
};
const BASE: Record<Side, SideCfg> = { long: { exit: X("none") }, short: { exit: X("sl3o+tp8o") } };

function grid(side: Side): Cand[] {
  const out: Cand[] = [];
  const add = (family: string, id: string, cfg: SideCfg, mult = 1) => out.push({ id, family, mult, cfg });
  const base = BASE[side];
  add("base", "base", base);
  for (const mult of [0.5, 0.75, 1.5, 2]) add("slope", `slope${mult}`, base, mult);

  const regimes: Regime[] = ["ema200", "st", "adx"];
  const counters = side === "long"
    ? [X("tp3o"), X("tp5o"), X("tp8o"), X("sl2o"), X("sl3o"), X("sl3o+tp8o"), X("ts2c"), X("ts3c"), X("none", IND.st), X("none", IND.ema20), X("none", IND.don10)]
    : [X("tp2o"), X("tp3o"), X("tp5o"), X("sl2o+tp3o"), X("sl2o+tp5o"), X("sl3o+tp5o"), X("sl3o+tp8o"), X("none", IND.st), X("none", IND.ema20)];
  const withs = side === "long" ? [X("none"), X("ts6c")] : [X("sl3o+tp8o"), X("sl3o"), X("tp12o"), X("ts4c"), X("none")];
  const key = (x: Exit) => `${x.rule}${x.ind ? `+${Object.entries(x.ind).map(([k, v]) => `${k}${v === true ? "" : v}`).join("")}` : ""}`;
  for (const regime of regimes) for (const counter of counters) for (const exit of withs)
    add("regime", `reg:${regime}:w=${key(exit)}:c=${key(counter)}`, { exit, regime, counter });

  for (const [name, ind] of Object.entries(IND)) {
    add("indexit", `ind:${name}`, { exit: X(side === "long" ? "none" : "sl3o+tp8o", ind) });
    if (side === "short") add("indexit", `ind:${name}:only`, { exit: X("none", ind) });
  }

  const trigs: Trigger[] = ["st", "don20", "ema20x50", "emaX50"];
  const reExits = side === "long"
    ? [X("none", IND.st), X("none", IND.ema50), X("none", IND.don10), X("ts3c")]
    : [X("none", IND.st), X("none", IND.ema50), X("none", IND.don10), X("ts3c"), X("sl3o+tp8o")];
  for (const trig of trigs) for (const gate of [false, true]) for (const exit of reExits)
    add("reentry", `re:${trig}:${gate ? "g" : "-"}:${key(exit)}`, { ...base, re: { trig, gate, exit } });

  // ผสม: กฎออกตามเทรนด์ชุดเล็ก × เข้าซ้ำชุดเล็ก (กำหนดไว้ล่วงหน้า ไม่ได้เลือกจากผล)
  const comboCounters = side === "long" ? [X("tp5o"), X("sl3o+tp8o"), X("none", IND.st)] : [X("tp3o"), X("sl2o+tp5o")];
  const comboRe = side === "long"
    ? [{ trig: "st" as Trigger, gate: true, exit: X("none", IND.st) }, { trig: "don20" as Trigger, gate: true, exit: X("none", IND.don10) }, { trig: "emaX50" as Trigger, gate: true, exit: X("none", IND.ema50) }]
    : [{ trig: "st" as Trigger, gate: true, exit: X("sl3o+tp8o") }, { trig: "don20" as Trigger, gate: true, exit: X("sl3o+tp8o") }];
  for (const regime of ["ema200", "st"] as Regime[]) for (const counter of comboCounters) for (const re of comboRe)
    add("combo", `combo:${regime}:c=${key(counter)}:re=${re.trig}/${key(re.exit)}`, { exit: base.exit, regime, counter, re });
  return out;
}
const CANDS: Record<Side, Cand[]> = { long: grid("long"), short: grid("short") };
const byId = (side: Side, id: string) => CANDS[side].find((c) => c.id === id)!;

/**
 * ค่าที่ลงทะเบียนไว้ก่อนโหลดชุดตรวจ 2 (28 ก.ย. 2026) — ใช้เป็นค่าตั้งต้นของ Pine ฉบับ enhanced
 * ที่มา: การเลือก "ตัวที่ดีที่สุด" จากชุดเดียว overfit ทุกครั้ง (ดูสองทิศใน cross-validation ของรายงาน)
 * จึงเลือกจากแบบที่ดีขึ้นสม่ำเสมอบนทั้งชุดหลักและชุดตรวจ 1 และอธิบายได้ด้วยหลักเดียว:
 *   EMA200 ตัวเดียวแยกไม้ ณ แท่งเข้า — ไม้สวนเทรนด์ปิดเร็วขึ้น · ไม้ตามเทรนด์ปล่อยวิ่ง
 *   Short 1h/4h/1d: สวนเทรนด์ (เหนือ EMA200) SL 2 + TP 5 × ATR · ตามเทรนด์ SL 3 + TP 8 × ATR (เดิม)
 *   Long 4h/1d   : ตามเทรนด์ (เหนือ EMA200) trailing 6 × ATR ที่ราคาปิด · สวนเทรนด์ SL 3 × ATR
 *   15m ทั้งสองฝั่ง และ Long 1h: คงค่าเดิม (ไม่มีแบบไหนดีขึ้นสม่ำเสมอ)
 * ชุดตรวจ 2 ใช้ยืนยันครั้งเดียว ห้ามแก้ PRESET ตามผลของชุดนั้น
 */
const PRESET: Record<string, Record<Side, string>> = {
  "15m": { long: "base", short: "base" },
  "1h": { long: "base", short: "reg:ema200:w=sl3o+tp8o:c=sl2o+tp5o" },
  "4h": { long: "reg:ema200:w=ts6c:c=sl3o", short: "reg:ema200:w=sl3o+tp8o:c=sl2o+tp5o" },
  "1d": { long: "reg:ema200:w=ts6c:c=sl3o", short: "reg:ema200:w=sl3o+tp8o:c=sl2o+tp5o" },
};

// ─── คำนวณต่อ snapshot × TF ─────────────────────────────────────
type Res = Pick<SideOut, "comp" | "sum" | "mdd" | "trades" | "early" | "re">;
interface TfData {
  key: string; snapshot: string; tf: string; cost: Costs; asOf: number;
  coins: Record<string, { from: number; bars: number; bh: number; long: Record<string, Res>; short: Record<string, Res> }>;
  check: { symbol: string; long: number[]; short: number[] };
}

const cli = parseCli();
const argv = process.argv.slice(2);
const holdoutName = argv.includes("--holdout") ? argv[argv.indexOf("--holdout") + 1] : `${cli.snapshot}-holdout`;

function runTf(snapshot: string, tf: string): TfData {
  const snap = openSnapshot(snapshot), names = snap.names(tf);
  const key = sha256(JSON.stringify({
    data: names.map((n) => snap.manifest.files[n].sha256), cost: cli.cost, LEN, WARM_E,
    cands: SIDES.map((s) => CANDS[s].map((c) => c.id)),
    code: sourceHash("sim.ts", "exits.ts", "enhance.ts", "common.ts", "enhance-wf.ts"),
  }));
  const out = path.join(HERE, "results", snapshot, `enhance-${tf}${cli.suffix}.json`);
  return cached(out, key, cli.force, `${snapshot} ${tf}`, () => {
    const t1 = Date.now();
    const coins: TfData["coins"] = {};
    let check: TfData["check"] | undefined;
    for (const name of names) {
      const symbol = snap.manifest.files[name].symbol, k = snap.load(name);
      if (k.length < WARM_E + 200) continue;
      const S = toSeries(k), I = indicators(k, S), s = WARM_E, e = k.length;
      const lines = new Map<number, ReturnType<typeof trendLines>>();
      const linesOf = (mult: number) => { if (!lines.has(mult)) lines.set(mult, trendLines(k, LEN, mult)); return lines.get(mult)!; };
      const row = { from: k[s].openTime, bars: e - s, bh: r4((S.c[e - 1] / S.c[s] - 1) * 100), long: {} as Record<string, Res>, short: {} as Record<string, Res> };
      for (const side of SIDES) for (const cand of CANDS[side]) {
        const x = simulateSide(S, linesOf(cand.mult), I, side === "long" ? 1 : -1, cand.cfg, s, e, cli.cost);
        row[side][cand.id] = { comp: r4(x.comp), sum: r4(x.sum), mdd: r4(x.mdd), trades: x.trades, early: x.early, re: x.re };
      }
      // ค่าอ้างอิงต้องเท่ากับตัวจำลองของ exits.ts (Long none = บอทเดิม = runBacktest)
      if (!check) {
        const L = linesOf(1);
        const eL = simulateExits(S, L, { long: EXIT_RULES.none }, s, e, cli.cost), eS = simulateExits(S, L, { short: EXIT_RULES["sl3o+tp8o"] }, s, e, cli.cost);
        assert.ok(Math.abs(eL.comp - row.long.base.comp) < 1e-3 && Math.abs(eS.comp - row.short.base.comp) < 1e-3, `ค่าอ้างอิงไม่ตรง exits.ts ${symbol}`);
        check = { symbol, long: [r4(eL.comp), row.long.base.comp], short: [r4(eS.comp), row.short.base.comp] };
      }
      coins[symbol] = row;
    }
    console.log(`${snapshot} ${tf}: ${Object.keys(coins).length} เหรียญ · Long ${CANDS.long.length} + Short ${CANDS.short.length} แบบ · ${((Date.now() - t1) / 1000).toFixed(1)} วินาที`);
    return { key, snapshot, tf, cost: cli.cost, asOf: snap.manifest.asOf, coins, check: check! };
  });
}

// ─── วิเคราะห์ ───────────────────────────────────────────────────
const lr = (d: TfData, side: Side, id: string) => {
  const v = Object.values(d.coins).map((c) => Math.log(Math.max(1e-9, 1 + c[side][id].comp / 100)) - Math.log(Math.max(1e-9, 1 + c[side].base.comp / 100)));
  return { lr: median(v), up: v.filter((x) => x > 1e-9).length, n: v.length };
};
/** จำนวนเทรดไม่น้อยกว่าค่าอ้างอิงทุกเหรียญ */
const tradesOk = (d: TfData, side: Side, id: string) => Object.values(d.coins).every((c) => c[side][id].trades >= c[side].base.trades);
const avgLr = (ds: TfData[], side: Side, id: string) => ds.reduce((a, d) => a + lr(d, side, id).lr, 0) / ds.length;
function best(ds: TfData[], side: Side, pool: Cand[]) {
  let id = "base", v = 0;
  for (const c of pool) { const x = avgLr(ds, side, c.id); if (x > v + 1e-12) { id = c.id; v = x; } }
  return { id, v };
}
function select(design: TfData[], side: Side) {
  const pool = CANDS[side].filter((c) => design.every((d) => tradesOk(d, side, c.id)));
  const rejected = CANDS[side].length - pool.length;
  const held = design.length > 1 ? design.map((d) => { const pick = best(design.filter((x) => x !== d), side, pool).id; return { tf: d.tf, pick, ...lr(d, side, pick) }; }) : [];
  const final = best(design, side, pool).id, passes = held.filter((h) => h.lr > 0).length;
  const chosen = held.length && passes * 4 >= held.length * 3 ? final : "base";
  return { pool, rejected, held, final, passes, chosen };
}

/** กลุ่ม TF ที่ Pine เลือกค่าให้อัตโนมัติตาม timeframe ของกราฟ */
const GROUPS: Record<string, { label: string; tfs: string[] }> = {
  low: { label: "TF ต่ำ (15m, 1h)", tfs: ["15m", "1h"] },
  high: { label: "TF สูง (4h, 1d)", tfs: ["4h", "1d"] },
};
const BROAD = 0.6;             // บนชุดหลักต้องดีขึ้นอย่างน้อยสัดส่วนนี้ของเหรียญ ทุก TF ในกลุ่ม
function chooseGroup(dg: TfData[], hg: TfData[], side: Side) {
  const pool = CANDS[side].filter((c) => dg.every((d) => tradesOk(d, side, c.id) && lr(d, side, c.id).up >= Math.ceil(BROAD * lr(d, side, c.id).n)));
  const pick = best(dg, side, pool).id;
  const hold = hg.map((d) => ({ tf: d.tf, ...lr(d, side, pick), trades: tradesOk(d, side, pick) }));
  const pass = pick !== "base" && hg.length === dg.length && hold.every((h) => h.lr > 0 && h.up * 2 >= h.n && h.trades);
  return { pick, pool: pool.length, design: dg.map((d) => ({ tf: d.tf, ...lr(d, side, pick) })), hold, chosen: pass ? pick : "base" };
}

// ─── รายงาน ─────────────────────────────────────────────────────
const gain = (x: number) => pct((Math.exp(x) - 1) * 100);
const m = (d: TfData, f: (c: TfData["coins"][string]) => number) => median(Object.values(d.coins).map(f));

function report(design: TfData[], holdout: TfData[], confirm: TfData[]) {
  const out: string[] = [];
  const nD = Object.keys(design[0].coins).length, nH = holdout.length ? Object.keys(holdout[0].coins).length : 0;
  out.push("# Trendlines with Breaks + indicator เสริม: จำนวนเทรด ≥ เดิม แบบไหนได้กำไรมากขึ้น", "");
  out.push(`ชุดหลัก \`${design[0].snapshot}\` ${nD} เหรียญ${holdout.length ? ` · ชุดตรวจ \`${holdout[0].snapshot}\` ${nH} เหรียญ (ไม่ใช้เลือกค่า)` : ""} · length ${LEN} · fee ${cli.cost.feePct}%/ขา · slippage ของ stop ${cli.cost.slipPct}% · เริ่มนับหลังแท่งที่ ${WARM_E}`, "");
  out.push("รันซ้ำ: `npm run web:tl:enhance` (อ่าน cache ถ้าไม่มีอะไรเปลี่ยน) · คำนวณใหม่: `-- --force`", "");
  out.push("**ค่าอ้างอิง** = Pine ปัจจุบัน: Long ออกตามป้าย · Short TP 8×ATR + SL 3×ATR · **คะแนน** = median ข้ามเหรียญของผลทบต้นที่ดีขึ้นเทียบค่าอ้างอิง (เท่า) · วงเล็บ = เหรียญที่ดีขึ้น", "");
  out.push(`ทดสอบ Long ${CANDS.long.length} แบบ · Short ${CANDS.short.length} แบบ ใน ${Object.keys(FAMILY_LABEL).length - 1} กลุ่ม · ทุกแบบเข้าที่ป้ายเดิมทุกไม้ แบบที่ทำให้เหรียญใดมีไม้น้อยกว่าเดิมถูกตัดทิ้ง`, "");

  const sel = Object.fromEntries(SIDES.map((s) => [s, select(design, s)])) as Record<Side, ReturnType<typeof select>>;
  const groups = Object.entries(GROUPS).map(([gid, g]) => {
    const dg = design.filter((d) => g.tfs.includes(d.tf)), hg = holdout.filter((d) => g.tfs.includes(d.tf));
    return { gid, ...g, dg, hg, side: Object.fromEntries(SIDES.map((sd) => [sd, dg.length ? chooseGroup(dg, hg, sd) : null])) as Record<Side, ReturnType<typeof chooseGroup> | null> };
  }).filter((g) => g.dg.length);
  const chosenFor = (tf: string, side: Side) => groups.find((g) => g.tfs.includes(tf))?.side[side]?.chosen ?? "base";

  out.push("## ผลการเลือก (ค่าที่ใช้ใน Pine · เลือกตาม TF ของกราฟ)", "");
  for (const g of groups) {
    out.push(`### ${g.label}`, "");
    for (const side of SIDES) {
      const x = g.side[side]!, c = byId(side, x.pick);
      const ev = (arr: { tf: string; lr: number; up: number; n: number }[]) => arr.map((h) => `${h.tf} ${gain(h.lr)} (${h.up}/${h.n})`).join(" · ");
      out.push(`- **${SIDE_LABEL[side]}: ${x.chosen === "base" ? "คงค่าอ้างอิง" : cfgLabel(c.cfg, c.mult)}**`);
      out.push(x.pick === "base"
        ? `  - ไม่มีแบบที่ดีขึ้นกว้าง ≥ ${BROAD * 100}% ของเหรียญบนชุดหลัก (${x.pool} แบบผ่านเงื่อนไขกว้าง)`
        : `  - ตัวเต็งจากชุดหลัก \`${x.pick}\`: ${ev(x.design)} → ชุดตรวจ: ${x.hold.length ? ev(x.hold) : "ไม่มีข้อมูล"} ${x.chosen === "base" ? "**ไม่ผ่าน** จึงคงค่าอ้างอิง" : "**ผ่าน**"}`);
    }
    out.push("");
  }

  out.push("### แบบเดียวใช้ได้ทุก TF ไหม (leave-one-TF-out บนชุดหลัก)", "");
  for (const side of SIDES) out.push(`- ${SIDE_LABEL[side]}: ดีขึ้นบน TF ที่ปิดไว้ ${sel[side].passes}/${sel[side].held.length} → ${sel[side].chosen === "base" ? "ไม่มี" : `\`${sel[side].chosen}\``}`);
  out.push("");
  out.push(`| TF ที่ปิดไว้ | ${SIDES.map((s) => `${SIDE_LABEL[s]} เลือก | ผลบน TF ที่ปิด`).join(" | ")} |`, `|---|${SIDES.map(() => "---|---").join("|")}|`);
  design.forEach((d, i) => out.push(`| ${d.tf} | ${SIDES.map((s) => { const h = sel[s].held[i]; return h ? `\`${h.pick}\` | ${gain(h.lr)} (${h.up}/${h.n})` : "— | —"; }).join(" | ")} |`));
  out.push("");

  const table = (ds: TfData[], title: string) => {
    out.push(`### ${title}`, "");
    out.push("| TF | ฝั่ง | ค่าอ้างอิง → ใหม่ (median ทบต้น) | คะแนน | ผลรวม %/ไม้ เดิม → ใหม่ | DD เดิม → ใหม่ | ไม้ เดิม → ใหม่ (เข้าซ้ำ) | ไม้ลดลง |", "|---|---|---|---|---|---|---|---|");
    for (const d of ds) for (const side of SIDES) {
      const id = chosenFor(d.tf, side), s = lr(d, side, id);
      const fewer = Object.values(d.coins).filter((c) => c[side][id].trades < c[side].base.trades).length;
      out.push(`| ${d.tf} | ${SIDE_LABEL[side]} | ${pct(m(d, (c) => c[side].base.comp))} → ${pct(m(d, (c) => c[side][id].comp))} | ${gain(s.lr)} (${s.up}/${s.n}) | ${pct(m(d, (c) => c[side].base.sum))} → ${pct(m(d, (c) => c[side][id].sum))} | ${m(d, (c) => c[side].base.mdd).toFixed(0)}% → ${m(d, (c) => c[side][id].mdd).toFixed(0)}% | ${Math.round(m(d, (c) => c[side].base.trades))} → ${Math.round(m(d, (c) => c[side][id].trades))} (${Math.round(m(d, (c) => c[side][id].re))}) | ${fewer} เหรียญ |`);
      if (side === "short") {
        const both = (f: (c: TfData["coins"][string]) => number) => m(d, f);
        out.push(`| ${d.tf} | ⇅ สองฝั่ง (ผลรวม %) | | | ${pct(both((c) => c.long.base.sum + c.short.base.sum))} → ${pct(both((c) => c.long[chosenFor(d.tf, "long")].sum + c.short[chosenFor(d.tf, "short")].sum))} | | | |`);
      }
    }
    out.push("");
  };
  table(design, "ผลของแบบที่เลือก บนเหรียญชุดหลัก (ในตัวอย่าง)");
  if (holdout.length) table(holdout, "ผลของแบบที่เลือก บนเหรียญชุดตรวจ (ไม่เคยใช้เลือก — ตัวเลขที่เชื่อได้ที่สุด)");

  // ทุกกลุ่ม: ตัวที่ดีที่สุดของกลุ่ม (เลือกบนชุดหลัก) แล้วดูว่ารอดบนชุดตรวจไหม
  // ─── ค่าที่ลงทะเบียนไว้ (PRESET) บนทุกชุดเหรียญ ───
  const sets: [string, TfData[]][] = [["ชุดหลัก", design], ["ชุดตรวจ 1", holdout], ["ชุดตรวจ 2 (ยืนยันครั้งเดียว)", confirm]];
  out.push("## ค่าที่ลงทะเบียนไว้ (Pine enhanced) บนทุกชุดเหรียญ", "");
  out.push("EMA200 แยกไม้ ณ แท่งเข้า: ไม้สวนเทรนด์ปิดเร็วขึ้น · ไม้ตามเทรนด์ปล่อยวิ่ง (รายละเอียดที่ PRESET ใน enhance-wf.ts) · ชุดตรวจ 2 โหลดหลังลงทะเบียนค่าแล้ว", "");
  out.push("| TF | ฝั่ง | กฎ | " + sets.filter(([, ds]) => ds.length).map(([l]) => `${l}: คะแนน (ดีขึ้น) · ทบต้น เดิม → ใหม่ · ผลรวม %/ไม้ เดิม → ใหม่ · ไม้`).join(" | ") + " |",
    "|---|---|---|" + sets.filter(([, ds]) => ds.length).map(() => "---").join("|") + "|");
  for (const tf of cli.tfs) for (const side of SIDES) {
    const id = PRESET[tf]?.[side] ?? "base";
    const cells = sets.filter(([, ds]) => ds.length).map(([, ds]) => {
      const d = ds.find((x) => x.tf === tf);
      if (!d) return "—";
      if (id === "base") return "คงค่าเดิม";
      const x = lr(d, side, id), same = Object.values(d.coins).every((c) => c[side][id].trades >= c[side].base.trades);
      const dSum = Object.values(d.coins).map((c) => c[side][id].sum - c[side].base.sum), tot = dSum.reduce((a, v) => a + v, 0);
      return `${x.lr > 0 && x.up * 2 >= x.n ? "✓" : "✗"} ${gain(x.lr)} (${x.up}/${x.n}) · ${pct(m(d, (c) => c[side].base.comp))} → ${pct(m(d, (c) => c[side][id].comp))} · ${pct(m(d, (c) => c[side].base.sum))} → ${pct(m(d, (c) => c[side][id].sum))} (ดีขึ้น ${dSum.filter((v) => v > 0).length}/${dSum.length} · รวมทุกเหรียญ ${tot >= 0 ? "+" : ""}${tot.toFixed(0)} จุด) · DD ${m(d, (c) => c[side].base.mdd).toFixed(0)}% → ${m(d, (c) => c[side][id].mdd).toFixed(0)}% · ${same ? "ไม้ ≥ เดิม" : "**ไม้ลดลง**"}`;
    });
    out.push(`| ${tf} | ${SIDE_LABEL[side]} | ${id === "base" ? "เดิม" : `\`${id}\``} | ${cells.join(" | ")} |`);
  }
  out.push("", "✓ = เกณฑ์ที่ลงทะเบียนไว้: median ผลทบต้นต่อเหรียญดีขึ้น และดีขึ้น ≥ ครึ่งหนึ่งของเหรียญ · วงเล็บหลังผลรวม %/ไม้ = เหรียญที่ผลรวมดีขึ้น และผลต่างรวมทุกเหรียญ", "");
  // ค่าตั้งต้นใน Pine: ช่องที่ไม่ผ่านบนชุดตรวจ 2 กลับไปใช้ค่าอ้างอิง (ไม่แก้ PRESET ที่ลงทะเบียนไว้)
  if (confirm.length) {
    out.push("**ค่าตั้งต้นใน Pine หลังยืนยัน:** ช่องที่ผ่านบนชุดตรวจ 2 ใช้ค่าที่ลงทะเบียนไว้ · ช่องที่ไม่ผ่านกลับไปใช้ค่าอ้างอิง", "");
    for (const tf of cli.tfs) for (const side of SIDES) {
      const id = PRESET[tf]?.[side] ?? "base", d = confirm.find((x) => x.tf === tf);
      if (id === "base" || !d) continue;
      const x = lr(d, side, id), pass = x.lr > 0 && x.up * 2 >= x.n;
      out.push(`- ${tf} ${SIDE_LABEL[side]}: ${pass ? "ผ่าน → ใช้" : "**ไม่ผ่าน** → กลับไปใช้ค่าอ้างอิง"} \`${id}\` (ชุดตรวจ 2 ${gain(x.lr)}, ${x.up}/${x.n})`);
    }
    out.push("");
  }

  out.push("## วิเคราะห์ทีละกลุ่มวิธี", "");
  out.push("ตัวที่ดีที่สุดของแต่ละกลุ่มวิธี (คะแนนเฉลี่ยบนชุดหลักใน TF กลุ่มนั้น ไม่บังคับเงื่อนไขกว้าง) แล้ววัดบนชุดตรวจ · ✓ = ดีขึ้น", "");
  for (const g of groups) for (const side of SIDES) {
    out.push(`### ${g.label} · ${SIDE_LABEL[side]}`, "");
    out.push(`| กลุ่มวิธี | แบบที่ดีที่สุด | ${g.dg.map((d) => `หลัก ${d.tf}`).join(" | ")} | ${g.hg.map((d) => `ตรวจ ${d.tf}`).join(" | ")} |`, `|---|---|${g.dg.map(() => "---").join("|")}|${g.hg.map(() => "---").join("|")}|`);
    for (const fam of Object.keys(FAMILY_LABEL).filter((f) => f !== "base")) {
      const pool = CANDS[side].filter((c) => c.family === fam && g.dg.every((d) => tradesOk(d, side, c.id)));
      if (!pool.length) { out.push(`| ${FAMILY_LABEL[fam]} | ไม่มีแบบที่ไม้ไม่ลดลง | ${g.dg.map(() => "—").join(" | ")} | ${g.hg.map(() => "—").join(" | ")} |`); continue; }
      const b = best(g.dg, side, pool), c = byId(side, b.id);
      const cell = (d: TfData) => { const x = lr(d, side, b.id); return `${x.lr > 0 ? "✓" : "·"} ${gain(x.lr)} (${x.up}/${x.n})`; };
      out.push(`| ${FAMILY_LABEL[fam]} | ${b.id === "base" ? "ไม่มีตัวที่ดีกว่าค่าอ้างอิง" : cfgLabel(c.cfg, c.mult)} | ${g.dg.map(cell).join(" | ")} | ${g.hg.map(cell).join(" | ")} |`);
    }
    out.push("");
  }

  out.push("## ตรวจความถูกต้อง", "");
  for (const d of [...design, ...holdout])
    out.push(`- ${d.snapshot} ${d.tf}: ค่าอ้างอิงเท่ากับ exits.ts บน ${d.check.symbol} (Long ${d.check.long[0]}% = ${d.check.long[1]}% · Short ${d.check.short[0]}% = ${d.check.short[1]}%)`);
  out.push("", "## ข้อจำกัด", "");
  out.push("- เหรียญทั้งสองชุดเป็นเหรียญที่ยังเทรดอยู่ถึงวันนี้ (survivorship bias)");
  out.push("- คำสั่ง stop/limit รู้แค่ราคาสูง/ต่ำของแท่ง แท่งที่แตะทั้งสองฝั่งนับ stop · Short ไม่รวม funding · Long และ Short แยกบัญชี (สองฝั่ง = ผลรวม %)");
  out.push("- ผลย้อนหลังไม่รับประกันอนาคต");
  const file = path.join(HERE, "results", design[0].snapshot, `enhance-report${cli.suffix}.md`);
  writeFileSync(file, out.join("\n") + "\n");
  return { file, groups };
}

const design = cli.tfs.map((tf) => runTf(cli.snapshot, tf));
const loadSet = (name: string) => {
  try { return cli.tfs.map((tf) => runTf(name, tf)); } catch (e) { console.log(`ไม่มีชุด ${name}: ${String(e).slice(0, 120)}`); return []; }
};
const holdout = loadSet(holdoutName);
const confirmName = argv.includes("--confirm") ? argv[argv.indexOf("--confirm") + 1] : `${cli.snapshot}-holdout2`;
const confirm = loadSet(confirmName);
const { file, groups } = report(design, holdout, confirm);
for (const g of groups) for (const side of SIDES) {
  const x = g.side[side]!;
  console.log(`${g.gid} ${side}: เต็ง ${x.pick} → ${x.chosen === "base" ? "ไม่ผ่าน (คงค่าอ้างอิง)" : "ผ่าน"} · ตรวจ ${x.hold.map((h) => `${h.tf} ${(h.lr * 100).toFixed(1)} (${h.up}/${h.n})`).join(" ")}`);
}
console.log(`\nรายงาน: ${path.relative(process.cwd(), file)}`);
