/**
 * Walk-forward: ออกก่อนป้ายแบบไหนได้กำไรมากที่สุด โดยจำนวนเทรดเท่าบอทเดิม (Trendlines with Breaks · length 14)
 * อ่านจาก snapshot ในเครื่องเท่านั้น (ไม่เรียก Binance) · ไม่ยิงออเดอร์
 *
 *   npm run web:tl:exits                        # snapshot ล่าสุด ทุก timeframe (อ่าน cache ถ้าไม่มีอะไรเปลี่ยน)
 *   npm run web:tl:exits -- --tf 4h,1d --fee 0.1 --slip 0.05 --force
 *
 * จุดเข้าเหมือนบอทเดิมทุกไม้ ต่างกันแค่การออก (ดู exits.ts) · ตรวจจำนวนไม้ทุกช่วง ทุกเหรียญ ทุกกฎว่าเท่าบอทเดิม
 * แยก 3 แบบการเทรดเหมือนตารางใน Pine: Long · Short · สองฝั่ง
 * ทุกช่วง: เลือกกฎที่ median ผลทบต้นบน train ข้ามเหรียญสูงสุด → วัดบน test ถัดไป
 *   Long และ Short เลือกแยกกัน · สองฝั่งใช้คู่ที่เลือก (ไม้สองฝั่งไม่ซ้อนเวลากัน ผลจึงเท่ากับ Long × Short)
 * "กฎที่เลือกตอนนี้" = เลือกบนช่วง train ล่าสุดที่จบที่ข้อมูลล่าสุด → ค่าที่ใช้ใน Pine
 *
 * ผลเก็บที่ results/<snapshot>/exits-<tf>.json + exits-report.md
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  cached, chainOut, date, HERE, lowerBound, median, MIN_COINS, newChain, openSnapshot, parseCli, pct, r4, sourceHash, WARM, WF,
  type ChainOut, type Fold,
} from "./common";
import { RANGES, sha256 } from "./download";
import { EXIT_RULES, isCloseOnly, ruleLabel, simulateExits, type Sides } from "./exits";
import { simulate, toSeries, trendLines, type Chain, type Costs } from "./sim";

const LEN = 14;                // length ของบอท — เปลี่ยนแล้วป้ายเปลี่ยน จำนวนเทรดจะไม่เท่าเดิม
const BASE = "none";
const SIDES = ["long", "short"] as const;
type Side = typeof SIDES[number];
type Mode = Side | "both";
const MODES: Mode[] = ["long", "short", "both"];
const MODE_LABEL: Record<Mode, string> = { long: "▲ Long", short: "▼ Short", both: "⇅ สองฝั่ง" };
const RULES = Object.keys(EXIT_RULES);
const POOLS: Record<string, { label: string; rules: string[] }> = {
  all: { label: "WF ทุกกฎ", rules: RULES },
  close: { label: "WF เฉพาะกฎปิดแท่ง", rules: RULES.filter((r) => isCloseOnly(EXIT_RULES[r])) },
};
const sidesOf = (mode: Mode, long: string, short: string): Sides =>
  mode === "long" ? { long: EXIT_RULES[long] } : mode === "short" ? { short: EXIT_RULES[short] } : { long: EXIT_RULES[long], short: EXIT_RULES[short] };

const { snapshot, tfs: TFS, cost: COST, force: FORCE, suffix: SUFFIX } = parseCli();
const snap = openSnapshot(snapshot);
const manifest = snap.manifest;

// ─── Walk-forward ต่อ timeframe ──────────────────────────────────
interface Out extends ChainOut { sum: number; early: number }
interface Cell { train: Record<Side, Record<string, number>>; test: Record<Mode, Record<string, number>>; bh: number }
interface TfResult {
  key: string; snapshot: string; asOf: number; tf: string; cost: Costs; train: number; test: number;
  folds: Fold[];
  cells: Record<string, (Cell | null)[]>;
  fixed: Record<Mode, Record<string, Record<string, Out>>>;          // โหมด → เหรียญ → กฎ (สองฝั่งใช้กฎเดียวกันทั้งสองขา)
  bh: Record<string, ChainOut>;
  procedures: Record<string, { selected: Record<Side, string[]>; perCoin: Record<Mode, Record<string, Out>> }>;
  latest: Record<string, Record<Side, { rule: string; train: number; base: number; coins: number }>>;
  check: { symbol: string; exits: number; sim: number };
}

function runTf(tf: string): TfResult {
  const names = snap.names(tf);
  const key = sha256(JSON.stringify({
    data: names.map((n) => manifest.files[n].sha256), cost: COST, WF: WF[tf], WARM, MIN_COINS, LEN, RULES,
    code: sourceHash("sim.ts", "exits.ts", "common.ts", "exits-wf.ts"),
  }));
  const out = path.join(HERE, "results", snapshot, `exits-${tf}${SUFFIX}.json`);
  return cached(out, key, FORCE, tf, () => computeTf(tf, key, names));
}

function computeTf(tf: string, key: string, names: string[]): TfResult {
  const { train, test } = WF[tf];
  const folds = snap.folds(tf), latestWin = snap.latestTrain(tf), ms = RANGES[tf].ms;
  const cells: TfResult["cells"] = {}, bh: TfResult["bh"] = {};
  const fixed = Object.fromEntries(MODES.map((m) => [m, {}])) as TfResult["fixed"];
  const latestTrain: Record<Side, Record<string, Record<string, number>>> = { long: {}, short: {} };
  const data: Record<string, { S: ReturnType<typeof toSeries>; L: ReturnType<typeof trendLines>; t: Float64Array }> = {};
  let check: TfResult["check"] | undefined;
  const t1 = Date.now();

  for (const name of names) {
    const symbol = manifest.files[name].symbol;
    const k = snap.load(name), S = toSeries(k), L = trendLines(k, LEN), t = Float64Array.from(k, (x) => x.openTime);
    data[symbol] = { S, L, t };
    const idx = (x: number) => lowerBound(t, x);
    const chains = Object.fromEntries(MODES.map((m) => [m, Object.fromEntries(RULES.map((r) => [r, newChain()]))])) as Record<Mode, Record<string, Chain>>;
    const acc = Object.fromEntries(MODES.map((m) => [m, Object.fromEntries(RULES.map((r) => [r, { trades: 0, sum: 0, early: 0 }]))])) as
      Record<Mode, Record<string, { trades: number; sum: number; early: number }>>;
    const bhChain = newChain();
    let nFolds = 0;
    cells[symbol] = folds.map(() => null);

    folds.forEach((f, fi) => {
      if (!f.coins.includes(symbol)) return;
      nFolds++;
      const a = idx(f.trainStart), b = idx(f.testStart), e = idx(f.testEnd);
      const cell: Cell = { train: { long: {}, short: {} }, test: { long: {}, short: {}, both: {} }, bh: r4((S.c[e - 1] / S.c[b] - 1) * 100) };
      const baseTrades: Partial<Record<string, number>> = {};
      for (const mode of MODES) for (const r of RULES) {
        const sides = sidesOf(mode, r, r);
        if (mode !== "both") {
          const tr = simulateExits(S, L, sides, a, b, COST);
          cell.train[mode][r] = r4(tr.comp);
          const want = (baseTrades[`${mode}-train`] ??= tr.trades);
          assert.equal(tr.trades, want, `${symbol} ${tf} ${mode} ${r}: จำนวนไม้ train ไม่เท่าบอทเดิม`);
        }
        const res = simulateExits(S, L, sides, b, e, COST, chains[mode][r]);
        cell.test[mode][r] = r4(res.comp);
        const want = (baseTrades[`${mode}-test`] ??= res.trades);
        assert.equal(res.trades, want, `${symbol} ${tf} ${mode} ${r}: จำนวนไม้ test ไม่เท่าบอทเดิม`);
        acc[mode][r].trades += res.trades; acc[mode][r].sum += res.sum; acc[mode][r].early += res.early;
      }
      for (let i = b; i < e; i++) {
        const ce = bhChain.eq * (S.c[i] / S.c[b]);
        bhChain.peak = Math.max(bhChain.peak, ce); bhChain.mdd = Math.max(bhChain.mdd, 1 - ce / bhChain.peak);
      }
      bhChain.eq *= S.c[e - 1] / S.c[b];
      cells[symbol][fi] = cell;
    });
    for (const mode of MODES) fixed[mode][symbol] = Object.fromEntries(RULES.map((r) => [r, {
      ...chainOut(chains[mode][r], acc[mode][r].trades, nFolds), sum: r4(acc[mode][r].sum), early: acc[mode][r].early,
    }]));
    bh[symbol] = chainOut(bhChain, 0, nFolds);

    // ช่วง train ล่าสุด (จบที่ข้อมูลล่าสุด) สำหรับเลือกกฎที่ใช้ต่อจากนี้
    if (manifest.files[name].from + WARM * ms <= latestWin.trainStart) {
      const a = idx(latestWin.trainStart), e = k.length;
      for (const side of SIDES)
        latestTrain[side][symbol] = Object.fromEntries(RULES.map((r) => [r, simulateExits(S, L, sidesOf(side, r, r), a, e, COST).comp]));
    }
    // ตรวจว่า "none" ฝั่ง Long = แบบ A ของ sim.ts (= runBacktest ของเว็บ ตรวจไว้ใน walk-forward.ts)
    if (!check) {
      const s0 = idx(folds.find((f) => f.coins.includes(symbol))!.testStart);
      const ex = simulateExits(S, L, { long: EXIT_RULES.none }, s0, k.length, COST).sum, sim = simulate(S, L, "A", s0, k.length, COST).sum;
      assert.ok(Math.abs(ex - sim) < 1e-9, `none ≠ แบบ A: ${ex} vs ${sim}`);
      check = { symbol, exits: r4(ex), sim: r4(sim) };
    }
  }

  // เลือกกฎต่อช่วง: median ผลทบต้นบน train ข้ามเหรียญสูงสุด · เสมอกันเลือกบอทเดิมก่อน
  const pick = (pool: string[], val: (r: string) => number) => {
    let best = BASE, bestVal = val(BASE);
    for (const r of pool) { const v = val(r); if (v > bestVal + 1e-9) { best = r; bestVal = v; } }
    return { rule: best, value: bestVal };
  };
  const procedures: TfResult["procedures"] = {};
  const latest: TfResult["latest"] = {};
  for (const [pid, { rules }] of Object.entries(POOLS)) {
    const selected = Object.fromEntries(SIDES.map((side) => [side, folds.map((f, fi) =>
      pick(rules, (r) => median(f.coins.map((s) => cells[s][fi]!.train[side][r]))).rule)])) as Record<Side, string[]>;
    const perCoin = Object.fromEntries(MODES.map((m) => [m, {}])) as TfResult["procedures"][string]["perCoin"];
    for (const [symbol, { S, L, t }] of Object.entries(data)) for (const mode of MODES) {
      const chain = newChain();
      let trades = 0, sum = 0, early = 0, nf = 0;
      folds.forEach((f, fi) => {
        if (!f.coins.includes(symbol)) return;
        const r = simulateExits(S, L, sidesOf(mode, selected.long[fi], selected.short[fi]), lowerBound(t, f.testStart), lowerBound(t, f.testEnd), COST, chain);
        trades += r.trades; sum += r.sum; early += r.early; nf++;
      });
      perCoin[mode][symbol] = { ...chainOut(chain, trades, nf), sum: r4(sum), early };
    }
    procedures[pid] = { selected, perCoin };
    latest[pid] = Object.fromEntries(SIDES.map((side) => {
      const coins = Object.keys(latestTrain[side]);
      const { rule, value } = pick(rules, (r) => median(coins.map((s) => latestTrain[side][s][r])));
      return [side, { rule, train: r4(value), base: r4(median(coins.map((s) => latestTrain[side][s][BASE]))), coins: coins.length }];
    })) as Record<Side, { rule: string; train: number; base: number; coins: number }>;
  }
  console.log(`${tf}: ${names.length} เหรียญ · ${folds.length} ช่วง · ${RULES.length} กฎ × 3 แบบ · จำนวนไม้เท่าบอทเดิมทุกกรณี · ${((Date.now() - t1) / 1000).toFixed(1)} วินาที`);
  return { key, snapshot, asOf: manifest.asOf, tf, cost: COST, train, test, folds, cells, fixed, bh, procedures, latest, check: check! };
}

// ─── Report ─────────────────────────────────────────────────────
interface Row { label: string; med: number; beat: number; mdd: number; sum: number; earlyPct: number; trades: number }
function summarize(r: TfResult, mode: Mode, label: string, per: Record<string, Out>): Row {
  const coins = Object.keys(per), base = r.fixed[mode];
  return {
    label,
    med: median(coins.map((s) => per[s].comp)),
    beat: coins.filter((s) => per[s].comp > base[s][BASE].comp + 1e-9).length,
    mdd: median(coins.map((s) => per[s].mdd)),
    sum: median(coins.map((s) => per[s].sum)),
    earlyPct: median(coins.map((s) => (per[s].trades ? (100 * per[s].early) / per[s].trades : 0))),
    trades: median(coins.map((s) => per[s].trades)),
  };
}
const fixedPer = (r: TfResult, mode: Mode, rule: string) => Object.fromEntries(Object.keys(r.fixed[mode]).map((s) => [s, r.fixed[mode][s][rule]]));
const pairLabel = (l: string, s: string, mode: Mode) => (mode === "long" ? l : mode === "short" ? s : `${l} / ${s}`);

/** median ข้ามเหรียญของ log((1 + กฎ) / (1 + บอทเดิม)) บนผล OOS ต่อกัน · > 0 = ดีกว่าบอทเดิม */
function lrOf(r: TfResult, side: Side, rule: string) {
  const f = r.fixed[side], coins = Object.keys(f);
  const v = coins.map((s) => Math.log(Math.max(1e-9, 1 + f[s][rule].comp / 100)) - Math.log(Math.max(1e-9, 1 + f[s][BASE].comp / 100)));
  return { lr: median(v), up: v.filter((x) => x > 1e-9).length, n: coins.length };
}
/**
 * กฎคงที่ตัวเดียวสำหรับทุก TF · ตรวจด้วย leave-one-TF-out: เลือกจาก TF อื่นแล้ววัดบน TF ที่ปิดไว้
 * ใช้กฎนั้นก็ต่อเมื่อ TF ที่ปิดไว้ดีขึ้นอย่างน้อย 3 ใน 4 ส่วน · ไม่ผ่าน = ไม่มีกฎออก (บอทเดิม)
 */
function crossTf(results: TfResult[], side: Side) {
  const avg = (rs: TfResult[], rule: string) => rs.reduce((a, r) => a + lrOf(r, side, rule).lr, 0) / rs.length;
  const best = (rs: TfResult[]) => RULES.reduce((b, rule) => (avg(rs, rule) > avg(rs, b) + 1e-12 ? rule : b), BASE);
  const held = results.length > 1
    ? results.map((r) => { const pick = best(results.filter((x) => x !== r)); return { tf: r.tf, pick, ...lrOf(r, side, pick) }; })
    : [];
  const final = best(results), passes = held.filter((h) => h.lr > 0).length;
  const rule = held.length > 0 && passes * 4 >= held.length * 3 ? final : BASE;
  return { held, final, passes, rule };
}
const gain = (lr: number) => pct((Math.exp(lr) - 1) * 100);

function report(results: TfResult[]) {
  const out: string[] = [];
  const r0 = results[0], n = Object.keys(r0.bh).length;
  out.push("# Walk-forward: ออกก่อนป้ายแบบไหนได้กำไรสูงสุด โดยจำนวนเทรดเท่าเดิม", "");
  out.push(`snapshot \`${r0.snapshot}\` · ข้อมูลถึง ${new Date(r0.asOf).toISOString().slice(0, 16).replace("T", " ")} UTC · Trendlines with Breaks length ${LEN} · ${n} เหรียญ · fee ${r0.cost.feePct}%/ขา · slippage ของคำสั่ง stop ${r0.cost.slipPct}%/ขา`, "");
  out.push("รันซ้ำ: `npm run web:tl:exits` (อ่าน cache ถ้าไม่มีอะไรเปลี่ยน) · คำนวณใหม่: `npm run web:tl:exits -- --force`", "");
  out.push("**จำนวนเทรดเท่าเดิม:** ทุกกฎเข้าที่ป้าย BUY/SELL เดิมทุกไม้ ออกก่อนได้แต่ไม่เข้าซ้ำจนกว่าจะถึงป้ายถัดไป · ตรวจแล้วทุกเหรียญ ทุกช่วง ทุกกฎ ว่าจำนวนไม้เท่าบอทเดิม", "");
  out.push("**วิธีอ่าน** ผล OOS = ผลช่วง test ทุกช่วงต่อกันแบบทบต้น ค่าในตาราง = median ข้ามเหรียญ · (x/n) = จำนวนเหรียญที่ชนะบอทเดิม · \"กฎตอนนี้\" = กฎที่เลือกจากช่วง train ล่าสุด ใช้เป็นค่าใน Pine", "");

  // ─── ค่าที่แนะนำ: กฎคงที่ข้าม TF ที่ผ่าน leave-one-TF-out ───
  const cross = Object.fromEntries(SIDES.map((side) => [side, crossTf(results, side)])) as Record<Side, ReturnType<typeof crossTf>>;
  out.push("## ค่าที่แนะนำ (ใช้เป็นค่าตั้งต้นใน Pine)", "");
  for (const side of SIDES) {
    const c = cross[side];
    out.push(`- **${MODE_LABEL[side]}: ${ruleLabel(c.rule)}** — ${c.rule === BASE
      ? `ไม่มีกฎออกที่ผ่าน leave-one-TF-out (TF ที่ปิดไว้ดีขึ้น ${c.passes}/${c.held.length}) จึงออกตามป้ายเดิม`
      : `ผ่าน leave-one-TF-out: TF ที่ปิดไว้ดีขึ้น ${c.passes}/${c.held.length}`}`);
  }
  out.push("", "**leave-one-TF-out** เลือกกฎคงที่ที่ดีที่สุดจาก TF อื่น แล้ววัดบน TF ที่ไม่ได้ใช้เลือก · ค่า = median ข้ามเหรียญของผล OOS ที่ดีขึ้นเทียบบอทเดิม (เท่า) · วงเล็บ = เหรียญที่ดีขึ้น", "");
  out.push(`| TF ที่ปิดไว้ | ${SIDES.map((sd) => `${MODE_LABEL[sd]} เลือก | ผลบน TF ที่ปิด`).join(" | ")} |`, `|---|${SIDES.map(() => "---|---").join("|")}|`);
  results.forEach((r, i) => out.push(`| ${r.tf} | ${SIDES.map((sd) => { const h = cross[sd].held[i]; return h ? `${h.pick} | ${gain(h.lr)} (${h.up}/${h.n})` : "— | —"; }).join(" | ")} |`));
  out.push("");
  out.push("ผลของค่าที่แนะนำเทียบบอทเดิม (median OOS ข้ามเหรียญ · กฎเลือกจากทุก TF รวมกัน จึงเป็นผลในตัวอย่าง ตัวเลขที่เชื่อได้คือ leave-one-TF-out ด้านบน)", "");
  out.push("| TF | ▲ Long เดิม → ใหม่ | ▼ Short เดิม → ใหม่ | Short ดีขึ้น | Short DD เดิม → ใหม่ | Short ปิดก่อนป้าย | ⇅ สองฝั่ง เดิม → ใหม่ | ผลรวม %/ไม้ สองฝั่ง เดิม → ใหม่ |", "|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const coins = Object.keys(r.bh), rl = cross.long.rule, rs = cross.short.rule, L = r.fixed.long, Sh = r.fixed.short;
    const m = (f: (s: string) => number) => median(coins.map(f));
    const both = (lr: string, sr: string) => m((s) => ((1 + L[s][lr].comp / 100) * (1 + Sh[s][sr].comp / 100) - 1) * 100);
    const bothSum = (lr: string, sr: string) => m((s) => L[s][lr].sum + Sh[s][sr].sum);
    out.push(`| ${r.tf} | ${pct(m((s) => L[s][BASE].comp))} → ${pct(m((s) => L[s][rl].comp))} | ${pct(m((s) => Sh[s][BASE].comp))} → ${pct(m((s) => Sh[s][rs].comp))} | ${coins.filter((s) => Sh[s][rs].comp > Sh[s][BASE].comp + 1e-9).length}/${coins.length} | ${m((s) => Sh[s][BASE].mdd).toFixed(0)}% → ${m((s) => Sh[s][rs].mdd).toFixed(0)}% | ${m((s) => (100 * Sh[s][rs].early) / Math.max(1, Sh[s][rs].trades)).toFixed(0)}% | ${pct(both(BASE, BASE))} → ${pct(both(rl, rs))} | ${pct(bothSum(BASE, BASE))} → ${pct(bothSum(rl, rs))} |`);
  }
  out.push("", "สองฝั่ง = ไม้ Long ต่อด้วยไม้ Short สลับกันบนทุนก้อนเดียว (ไม่ซ้อนเวลา) ผลทบต้นจึงเท่ากับ (1 + Long) × (1 + Short) − 1 พอดี", "");

  out.push("## เลือกกฎใหม่ทุกช่วง (walk-forward รายช่วง)", "");
  out.push("| TF | แบบ | บอทเดิม | WF ทุกกฎ | WF เฉพาะปิดแท่ง | กฎตอนนี้ (ทุกกฎ) | กฎตอนนี้ (ปิดแท่ง) | fixed ดีสุด (มองย้อน) |", "|---|---|---|---|---|---|---|---|");
  for (const r of results) for (const mode of MODES) {
    const base = summarize(r, mode, "", fixedPer(r, mode, BASE));
    const procs = Object.keys(POOLS).map((pid) => summarize(r, mode, pid, r.procedures[pid].perCoin[mode]));
    const best = RULES.map((rule) => summarize(r, mode, rule, fixedPer(r, mode, rule))).sort((a, b) => b.med - a.med)[0];
    const now = (pid: string) => pairLabel(r.latest[pid].long.rule, r.latest[pid].short.rule, mode);
    out.push(`| ${r.tf} | ${MODE_LABEL[mode]} | ${pct(base.med)} | ${procs.map((p) => `${pct(p.med)} (${p.beat}/${n})`).join(" | ")} | ${now("all")} | ${now("close")} | ${best.label} ${pct(best.med)} (${best.beat}/${n}) |`);
  }
  out.push("", "\"fixed ดีสุด\" เลือกจากผล OOS เอง จึงมองเห็นอนาคต ใช้ดูเพดานเท่านั้น · สองฝั่งแบบ fixed ใช้กฎเดียวกันทั้งสองขา", "");

  // กฎคงที่ตัวไหนดีขึ้นในหลายสถานการณ์ที่สุด (มองย้อน — ใช้ประกอบการเลือกค่าตั้งต้น ไม่ใช่หลักฐานหลัก)
  out.push("## กฎคงที่ที่ชนะบอทเดิมในหลายสถานการณ์ (มองย้อน)", "");
  out.push(`นับ (TF × แบบ) ที่ median OOS สูงกว่าบอทเดิม และชนะอย่างน้อยครึ่งหนึ่งของเหรียญ จากทั้งหมด ${results.length * MODES.length} สถานการณ์`, "");
  const robust = RULES.filter((x) => x !== BASE).map((rule) => {
    let wins = 0; const cells: string[] = [];
    for (const r of results) for (const mode of MODES) {
      const row = summarize(r, mode, rule, fixedPer(r, mode, rule)), base = summarize(r, mode, "", fixedPer(r, mode, BASE));
      const ok = row.med > base.med && row.beat * 2 >= n;
      if (ok) wins++;
      cells.push(`${ok ? "✓" : "·"} ${pct(row.med - base.med)}`);
    }
    return { rule, wins, cells };
  }).sort((a, b) => b.wins - a.wins).slice(0, 12);
  out.push(`| กฎ | ชนะ | ${results.flatMap((r) => MODES.map((m) => `${r.tf} ${MODE_LABEL[m]}`)).join(" | ")} |`, `|---|---|${results.flatMap(() => MODES.map(() => "---")).join("|")}|`);
  for (const x of robust) out.push(`| ${ruleLabel(x.rule)} | ${x.wins} | ${x.cells.join(" | ")} |`);
  out.push("", "ตัวเลขในช่อง = median OOS ของกฎ − median OOS ของบอทเดิม (จุด %)", "");

  for (const r of results) {
    out.push(`## ${r.tf} · train ${r.train} วัน → test ${r.test} วัน · ${r.folds.length} ช่วง · ${date(r.folds[0].testStart)} → ${date(r.folds.at(-1)!.testEnd)}`, "");
    out.push(`Buy&Hold median ${pct(median(Object.values(r.bh).map((x) => x.comp)))} · ตรวจแล้ว: กฎ none ฝั่ง Long บน ${r.check.symbol} ได้ผลรวม ${r.check.exits.toFixed(4)}% เท่ากับบอทเดิม (${r.check.sim.toFixed(4)}%)`, "");
    for (const mode of MODES) {
      const rows = [
        summarize(r, mode, "บอทเดิม (ไม่มีกฎออก)", fixedPer(r, mode, BASE)),
        ...Object.entries(POOLS).map(([pid, p]) => summarize(r, mode, p.label, r.procedures[pid].perCoin[mode])),
        ...RULES.filter((x) => x !== BASE).map((rule) => summarize(r, mode, ruleLabel(rule), fixedPer(r, mode, rule))).sort((a, b) => b.med - a.med).slice(0, 8),
      ];
      out.push(`### ${MODE_LABEL[mode]}`, "");
      out.push("| วิธี | median OOS | ชนะบอทเดิม | median DD | ผลรวม %/ไม้ (แบบเว็บ) | ปิดก่อนป้าย | median ไม้ |", "|---|---|---|---|---|---|---|");
      for (const x of rows) out.push(`| ${x.label} | ${pct(x.med)} | ${x.label.startsWith("บอทเดิม") ? "—" : `${x.beat}/${n}`} | ${x.mdd.toFixed(1)}% | ${pct(x.sum)} | ${x.earlyPct.toFixed(0)}% | ${Math.round(x.trades)} |`);
      out.push("");
    }
    out.push("| ช่วง test | เหรียญ | Long เลือก | Long ผล / เดิม | Short เลือก | Short ผล / เดิม |", "|---|---|---|---|---|---|");
    r.folds.forEach((f, fi) => {
      const m = (side: Side, rule: string) => pct(median(f.coins.map((s) => r.cells[s][fi]!.test[side][rule])));
      const sl = r.procedures.all.selected.long[fi], ss = r.procedures.all.selected.short[fi];
      out.push(`| ${date(f.testStart)} → ${date(f.testEnd)} | ${f.coins.length} | ${sl} | ${m("long", sl)} / ${m("long", BASE)} | ${ss} | ${m("short", ss)} / ${m("short", BASE)} |`);
    });
    out.push("");
  }
  out.push("## ข้อจำกัด", "");
  out.push("- เลือกเหรียญจากเหรียญใหญ่ที่ยังอยู่ในปัจจุบัน (survivorship bias)");
  out.push("- คำสั่ง stop/limit รู้แค่ราคาสูง/ต่ำของแท่ง ไม่รู้ลำดับในแท่ง แท่งที่แตะทั้งสองฝั่งนับเป็น stop · stop หัก slippage คงที่");
  out.push("- Short ใช้ราคา Spot ไม่รวม funding/ค่ายืม · แต่ละช่วง test เริ่มสถานะว่างและปิดไม้ค้างตอนจบช่วง");
  const file = path.join(HERE, "results", r0.snapshot, `exits-report${SUFFIX}.md`);
  writeFileSync(file, out.join("\n") + "\n");
  return file;
}

const results = TFS.map(runTf);
console.log(`\nรายงาน: ${path.relative(process.cwd(), report(results))}`);
