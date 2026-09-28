/**
 * ซื้อขายด้วย RSI แทนเส้นเทรนด์: แบบไหนได้กำไรมากกว่า Pine enhanced โดยจำนวนเทรด ≥ เดิม
 * อ่านจาก snapshot ในเครื่องเท่านั้น (ไม่เรียก Binance) · ไม่ยิงออเดอร์
 *
 *   npm run web:tl:rsi                     # เลือกช่วงแรก 60% · ทดสอบช่วงหลัง 40% + เหรียญชุดใหม่
 *   npm run web:tl:rsi -- --force
 *
 * ค่าอ้างอิง = Pine enhanced (ป้ายเส้นเทรนด์ + กฎออก Auto ตาม TF) · ตัวสร้างป้าย RSI อยู่ใน rsi.ts
 * กฎออกของแบบ RSI: sig = ออกที่ป้ายตรงข้ามอย่างเดียว · leg = Short TP 8 · SL 3 · enh = กฎออก Auto ของ enhanced ทั้งชุด
 *
 * แบ่งเวลา (บทเรียนจาก Profit Hold: ผ่านหลายชุดเหรียญแต่ช่วงเวลาเดียวกัน แล้วพังในช่วงอื่น):
 *   ต่อ TF ตัดที่ 60% ของช่วงข้อมูลชุดหลัก · ช่วงแรก = เลือก · ช่วงหลัง = ทดสอบ (เริ่มสถานะว่างที่จุดตัด)
 *   ขั้น 1 เลือกบนช่วงแรกของ 4 ชุดเหรียญ (63 เหรียญ) ต่อ TF: ไม้สองฝั่งต้อง ≥ ค่าอ้างอิงทุกเหรียญ และทุกชุด
 *          ผลทบต้น median ดีขึ้น · ดีขึ้น ≥ ครึ่งของเหรียญ · ผลรวม %/ไม้ median ดีขึ้น → เอาแบบที่ชุดแย่ที่สุดดีที่สุด
 *   ขั้น 2 ล็อกค่า (PRESET + SHA-256) → ทดสอบครั้งเดียวบนช่วงหลังของ 4 ชุด และเหรียญชุดใหม่ (holdout4 โหลดหลังล็อก)
 *
 * ผลเก็บที่ results/<snapshot>/rsi-<tf>.json + results/tl-20260928/rsi-report.md
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { cached, date, HERE, median, openSnapshot, parseCli, pct, r4, sourceHash } from "./common";
import { sha256 } from "./download";
import { indicators, simulateSide, type Exit, type SideCfg } from "./enhance";
import { genId, genLabel, rsiLines, type RsiGen } from "./rsi";
import { toSeries, trendLines, type Lines } from "./sim";

const LEN = 14;
const WARM_E = 400;
const SPLIT = 0.6;
const X = (rule: string): Exit => ({ rule });
const REG = (w: string, c: string): SideCfg => ({ exit: X(w), regime: "ema200", counter: X(c) });
const TF_GROUP: Record<string, number> = { "15m": 0, "30m": 0, "1h": 1, "4h": 2, "1d": 3 };
/** กฎออก Auto ของ Pine enhanced ต่อกลุ่ม TF (autoGrp ใน Pine: 0 < 1h · 1 = 1h · 2 = 4h · 3 = 1D) */
const ENH: { long: SideCfg; short: SideCfg }[] = [
  { long: { exit: X("none") }, short: { exit: X("sl3o+tp8o") } },
  { long: { exit: X("none") }, short: REG("sl3o+tp8o", "sl2o+tp5o") },
  { long: REG("ts6c", "sl3o"), short: REG("sl3o+tp8o", "sl2o+tp5o") },
  { long: REG("ts6c", "sl3o"), short: { exit: X("sl3o+tp8o") } },
];
const EXITS: Record<string, (tf: string) => { long: SideCfg; short: SideCfg }> = {
  sig: () => ({ long: { exit: X("none") }, short: { exit: X("none") } }),
  leg: () => ({ long: { exit: X("none") }, short: { exit: X("sl3o+tp8o") } }),
  enh: (tf) => ENH[TF_GROUP[tf]],
};
const EXIT_LABEL: Record<string, string> = { sig: "ออกที่ป้ายตรงข้าม", leg: "Short TP 8 · SL 3", enh: "กฎออก Auto ของ enhanced" };

// ─── ตัวสร้างป้าย RSI ที่ทดสอบ ───────────────────────────────────
const GENS: RsiGen[] = [];
for (const [lo, hi] of [[30, 70], [25, 75]]) GENS.push({ kind: "level", n: 14, lo, hi });
for (const n of [7, 14, 21]) for (const [lo, hi] of [[30, 70], [35, 65], [40, 60], [45, 55]]) GENS.push({ kind: "revert", n, lo, hi });
for (const n of [7, 14, 21, 28, 42]) for (const h of [0, 5, 10, 15]) GENS.push({ kind: "cross", n, h });
for (const m of [9, 21]) GENS.push({ kind: "signal", n: 14, m });
for (const [n, len] of [[14, 5], [14, 7], [14, 10], [14, 14], [7, 7], [7, 14]]) GENS.push({ kind: "tl", n, len });
for (const h of [5, 10]) GENS.push({ kind: "hybrid", n: 14, h });
interface Cand { id: string; gen: RsiGen; exit: string }
const CANDS: Cand[] = GENS.flatMap((gen) => Object.keys(EXITS).map((exit) => ({ id: `${genId(gen)}|${exit}`, gen, exit })));
const byId = (id: string) => CANDS.find((c) => c.id === id)!;
const candLabel = (id: string) => { const c = byId(id); return `${genLabel(c.gen)} · ${EXIT_LABEL[c.exit]}`; };

/**
 * ค่าที่ลงทะเบียนหลังขั้นที่ 1 (28 ก.ย. 2026 ก่อนเปิดดูช่วงทดสอบ และก่อนโหลด holdout4) — ห้ามแก้ตามผลทดสอบ
 * = ผลเลือกของขั้นที่ 1 ตรงตัว
 * null = ยังไม่ลงทะเบียน · "base" = ไม่มีแบบ RSI ที่ผ่าน (ใช้ป้ายเส้นเทรนด์ของ enhanced ต่อ)
 */
const PRESET: Record<string, string> | null = {
  "15m": "base", "30m": "base", "1h": "base", "4h": "base", "1d": "cross14:±0|leg",
};

// ─── คำนวณ ───────────────────────────────────────────────────────
interface Res { comp: number; sum: number; trades: number; wins: number; mdd: number }
interface Pair { long: Res; short: Res }
interface Part { from: number; to: number; base: Pair; legacy: Pair; cand: Record<string, Pair> }
interface TfData { key: string; snapshot: string; tf: string; cut: number; coins: Record<string, { sel?: Part; test?: Part }> }
const cli = parseCli();
const SETS = [cli.snapshot, `${cli.snapshot}-holdout`, `${cli.snapshot}-holdout2`, `${cli.snapshot}-holdout3`];
const CONFIRM_SET = `${cli.snapshot}-holdout4`;
const TFS = ["15m", "30m", "1h", "4h", "1d"];

/** จุดตัดของแต่ละ TF = 60% ของช่วงข้อมูลชุดหลัก (ใช้เวลาเดียวกันทุกชุด) */
function cutOf(tf: string) {
  const fs = Object.values(openSnapshot(cli.snapshot).manifest.files).filter((f) => f.interval === tf);
  const t0 = Math.min(...fs.map((f) => f.from)), t1 = Math.max(...fs.map((f) => f.to));
  return Math.round(t0 + SPLIT * (t1 - t0));
}

function runTf(snapshot: string, tf: string): TfData {
  const snap = openSnapshot(snapshot), names = snap.names(tf), cut = cutOf(tf);
  const key = sha256(JSON.stringify({
    data: names.map((n) => snap.manifest.files[n].sha256), cost: cli.cost, LEN, WARM_E, SPLIT, cut, cands: CANDS.map((c) => c.id),
    code: sourceHash("sim.ts", "exits.ts", "enhance.ts", "common.ts", "rsi.ts", "rsi-wf.ts"),
  }));
  const out = path.join(HERE, "results", snapshot, `rsi-${tf}${cli.suffix}.json`);
  return cached(out, key, cli.force, `${snapshot} ${tf}`, () => {
    const t1 = Date.now(), coins: TfData["coins"] = {};
    for (const name of names) {
      const symbol = snap.manifest.files[name].symbol, k = snap.load(name);
      if (k.length < WARM_E + 200) continue;
      const S = toSeries(k), L = trendLines(k, LEN), I = indicators(k, S);
      const ci = k.findIndex((x) => x.openTime >= cut), cIdx = ci < 0 ? k.length : ci;
      const lines = new Map<string, Lines>();
      const linesOf = (g: RsiGen) => { const id = genId(g); if (!lines.has(id)) lines.set(id, rsiLines(k, S, L, g)); return lines.get(id)!; };
      const part = (s: number, e: number): Part | undefined => {
        if (e - s < 300) return undefined;
        const pair = (LL: Lines, cfg: { long: SideCfg; short: SideCfg }): Pair => {
          const f = (sd: 1 | -1, c: SideCfg): Res => { const x = simulateSide(S, LL, I, sd, c, s, e, cli.cost); return { comp: r4(x.comp), sum: r4(x.sum), trades: x.trades, wins: x.wins, mdd: r4(x.mdd) }; };
          return { long: f(1, cfg.long), short: f(-1, cfg.short) };
        };
        const p: Part = { from: k[s].openTime, to: k[e - 1].openTime, base: pair(L, ENH[TF_GROUP[tf]]), legacy: pair(L, EXITS.leg(tf)), cand: {} };
        for (const c of CANDS) p.cand[c.id] = pair(linesOf(c.gen), EXITS[c.exit](tf));
        return p;
      };
      coins[symbol] = { sel: part(WARM_E, cIdx), test: part(Math.max(WARM_E, cIdx), k.length) };
    }
    console.log(`${snapshot} ${tf}: ${Object.keys(coins).length} เหรียญ · ${CANDS.length} แบบ · ตัดที่ ${date(cut)} · ${((Date.now() - t1) / 1000).toFixed(1)} วินาที`);
    return { key, snapshot, tf, cut, coins };
  });
}

// ─── วัดผล ────────────────────────────────────────────────────────
type Which = "sel" | "test";
const lg = (x: number) => Math.log(Math.max(1e-9, 1 + x / 100));
const both = (p: Pair) => ({ lr: lg(p.long.comp) + lg(p.short.comp), sum: p.long.sum + p.short.sum, trades: p.long.trades + p.short.trades, wins: p.long.wins + p.short.wins });
function score(d: TfData, w: Which, id: string, vs: "base" | "legacy" = "base") {
  const parts = Object.values(d.coins).map((c) => c[w]).filter((p): p is Part => !!p);
  const ref = (p: Part) => both(vs === "base" ? p.base : p.legacy);
  const v = parts.map((p) => both(p.cand[id]).lr - ref(p).lr), ds = parts.map((p) => both(p.cand[id]).sum - ref(p).sum);
  const tr = parts.map((p) => both(p.cand[id]).trades / Math.max(1, ref(p).trades));
  return {
    lr: median(v), up: v.filter((x) => x > 1e-9).length, n: v.length, dSum: median(ds), sumUp: ds.filter((x) => x > 1e-9).length,
    tradesOk: parts.every((p) => both(p.cand[id]).trades >= ref(p).trades), trMed: median(tr), trMin: Math.min(...tr),
    sum: [median(parts.map((p) => ref(p).sum)), median(parts.map((p) => both(p.cand[id]).sum))],
    sumL: median(parts.map((p) => p.cand[id].long.sum)), sumS: median(parts.map((p) => p.cand[id].short.sum)),
    win: parts.reduce((a, p) => a + both(p.cand[id]).wins, 0) / Math.max(1, parts.reduce((a, p) => a + both(p.cand[id]).trades, 0)),
    winRef: parts.reduce((a, p) => a + ref(p).wins, 0) / Math.max(1, parts.reduce((a, p) => a + ref(p).trades, 0)),
  };
}
type Score = ReturnType<typeof score>;
const passes = (s: Score) => s.n > 0 && s.lr > 0 && s.up * 2 >= s.n && s.dSum > 0 && s.tradesOk;
const gain = (x: number) => pct((Math.exp(x) - 1) * 100);
const cell = (s: Score) => s.n ? `${passes(s) ? "✓" : "✗"} ${gain(s.lr)} (${s.up}/${s.n}) · Σ ${s.dSum >= 0 ? "+" : ""}${s.dSum.toFixed(1)} · ไม้ ×${s.trMed.toFixed(2)}${s.tradesOk ? "" : " ⚠น้อยกว่า"}` : "—";
const setName = (s: string) => s.replace(cli.snapshot, "หลัก").replace("หลัก-holdout", "ตรวจ");

function choose(ds: TfData[]) {
  const table = CANDS.map((c) => {
    const cs = ds.map((d) => score(d, "sel", c.id));
    return { id: c.id, cs, ok: cs.every(passes), worst: Math.min(...cs.map((s) => s.lr)), tradesOk: cs.every((s) => s.tradesOk) };
  });
  const ok = table.filter((t) => t.ok).sort((a, b) => b.worst - a.worst);
  return { best: ok[0]?.id ?? "base", table, nOk: ok.length, nTrades: table.filter((t) => t.tradesOk).length };
}

function main() {
  const load = (snap: string) => TFS.flatMap((tf) => {
    try { return [runTf(snap, tf)]; } catch (e) { console.log(`ข้าม ${snap} ${tf}: ${String(e).slice(0, 100)}`); return []; }
  });
  const data = SETS.map(load);
  const out: string[] = [];
  out.push("# ซื้อขายด้วย RSI: แบบไหนดีกว่า Pine enhanced โดยจำนวนเทรด ≥ เดิม", "");
  out.push(`ชุดเหรียญ ${SETS.map((s) => `\`${s}\``).join(" · ")} · ${CANDS.length} แบบ (${GENS.length} ตัวสร้างป้าย × ${Object.keys(EXITS).length} กฎออก) · fee ${cli.cost.feePct}%/ขา · slippage ${cli.cost.slipPct}%`, "");
  out.push("**ค่าอ้างอิง** = Pine enhanced (ป้ายเส้นเทรนด์ · กฎออก Auto) · วัดแบบสองฝั่ง (Long + Short แยกบัญชี) · คะแนน = median ต่อเหรียญของ log ผลทบต้น (Long × Short) เทียบค่าอ้างอิง · Σ = median ผลต่างผลรวม %/ไม้ · ไม้ × = จำนวนไม้เทียบค่าอ้างอิง", "");
  out.push(`แบ่งเวลาต่อ TF ที่ ${SPLIT * 100}% ของช่วงข้อมูล: ${TFS.map((tf) => `${tf} ${date(data[0].find((d) => d.tf === tf)!.cut)}`).join(" · ")}`, "");
  out.push("รันซ้ำ: `npm run web:tl:rsi` (อ่าน cache) · คำนวณใหม่: `-- --force`", "");

  out.push("## ขั้นที่ 1: เลือกบนช่วงแรก", "");
  const chosen: Record<string, string> = {};
  for (const tf of TFS) {
    const ds = data.map((s) => s.find((d) => d.tf === tf)!).filter(Boolean);
    const r = choose(ds);
    chosen[tf] = r.best;
    out.push(`### ${tf} → ${r.best === "base" ? "**ไม่มีแบบ RSI ที่ผ่าน** (ใช้ป้ายเส้นเทรนด์ของ enhanced)" : `**${candLabel(r.best)}** \`${r.best}\``}`, "");
    out.push(`ไม้ ≥ เดิมทุกเหรียญ ${r.nTrades}/${CANDS.length} แบบ · ผ่านทุกชุด ${r.nOk} แบบ · ตารางด้านล่าง = 8 แบบที่ชุดแย่ที่สุดดีที่สุด (เฉพาะแบบที่ไม้ ≥ เดิม) + แบบที่ดีที่สุดถ้าไม่สนจำนวนไม้`, "");
    out.push(`| แบบ | ${ds.map((d) => setName(d.snapshot)).join(" | ")} | ผลรวม %/ไม้ median ค่าอ้างอิง → RSI (ชุดหลัก) |`, `|---|${ds.map(() => "---").join("|")}|---|`);
    const top = r.table.filter((t) => t.tradesOk).sort((a, b) => b.worst - a.worst).slice(0, 8);
    const free = r.table.slice().sort((a, b) => b.worst - a.worst)[0];
    for (const t of [...top, ...(top.some((x) => x.id === free.id) ? [] : [free])])
      out.push(`| \`${t.id}\`${t.tradesOk ? "" : " (ไม้น้อยกว่า)"} | ${t.cs.map(cell).join(" | ")} | ${pct(t.cs[0].sum[0])} → ${pct(t.cs[0].sum[1])} |`);
    out.push("");
  }
  out.push("ผลเลือก (ขั้นที่ 1):", "", "```json", JSON.stringify(chosen), "```", "");

  if (!PRESET) out.push("_ยังไม่ลงทะเบียน PRESET — ขั้นที่ 2 ยังไม่รัน_", "");
  else {
    const hash = createHash("sha256").update(JSON.stringify(PRESET)).digest("hex");
    out.push("## ขั้นที่ 2: ทดสอบค่าที่ล็อกไว้ (ครั้งเดียว)", "");
    out.push(`PRESET SHA-256 \`${hash}\` · ช่วงหลังของทุกชุด (เริ่มว่างที่จุดตัด) · \`${CONFIRM_SET}\` = เหรียญใหม่ที่โหลดหลังล็อก (ช่วงหลัง = ข้อมูลที่ไม่เคยเห็นทั้งเหรียญและเวลา)`, "");
    const conf = load(CONFIRM_SET);
    const all = [...data, ...(conf.length ? [conf] : [])];
    out.push("| TF | แบบ | ชุด | ช่วงหลัง เทียบ enhanced | ช่วงหลัง เทียบ legacy | ผลรวม %/ไม้ สองฝั่ง median: enhanced → RSI | Long / Short ของ RSI | Win rate enhanced → RSI | ช่วงแรก เทียบ enhanced |",
      "|---|---|---|---|---|---|---|---|---|");
    const verdict: string[] = [];
    for (const tf of TFS) {
      const id = PRESET[tf] ?? "base";
      if (id === "base") { out.push(`| ${tf} | ป้ายเส้นเทรนด์ของ enhanced (ไม่มี RSI ที่ผ่าน) | — | — | — | — | — | — | — |`); continue; }
      for (const ds of all) {
        const d = ds.find((x) => x.tf === tf); if (!d) continue;
        const t = score(d, "test", id), tl = score(d, "test", id, "legacy"), s = score(d, "sel", id);
        verdict.push(`${passes(t) ? "✓" : "✗"} ${tf} ${setName(d.snapshot)}`);
        out.push(`| ${tf} | \`${id}\` | ${setName(d.snapshot)}${d.snapshot === CONFIRM_SET ? " **(ใหม่)**" : ""} | ${cell(t)} | ${cell(tl)} | ${pct(t.sum[0])} → ${pct(t.sum[1])} | ${pct(t.sumL)} / ${pct(t.sumS)} | ${(t.winRef * 100).toFixed(1)}% → ${(t.win * 100).toFixed(1)}% | ${cell(s)} |`);
      }
    }
    out.push("", `**ผลทดสอบ:** ผ่าน ${verdict.filter((v) => v.startsWith("✓")).length}/${verdict.length} ช่อง — ${verdict.join(" · ")}`, "");
  }
  out.push("## ข้อจำกัด", "");
  out.push("- ชุดตรวจ 3 มีเหรียญที่ถูกถอดแล้ว (LRC, STORJ) · ชุดอื่นเป็นเหรียญที่ยังเทรดอยู่ (survivorship bias) · Short ไม่รวม funding");
  out.push("- ช่วงหลังของ 1h/4h/1d คือปี 2023–2026 ของแต่ละ TF · ผลย้อนหลังไม่รับประกันอนาคต");
  const file = path.join(HERE, "results", cli.snapshot, `rsi-report${cli.suffix}.md`);
  writeFileSync(file, out.join("\n") + "\n");
  console.log(JSON.stringify(chosen));
  console.log(`รายงาน: ${path.relative(process.cwd(), file)}`);
}
main();
