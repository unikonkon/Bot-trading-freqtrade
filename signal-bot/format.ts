/**
 * ข้อความที่ส่งเข้า Telegram (HTML) — แยกไว้ให้แก้รูปแบบได้โดยไม่แตะตรรกะ
 */
import { STRATEGIES } from "@/lib/backtest";
import type { BotState } from "./state";
import type { BotAnalysis } from "./scanner";
import type { BotConfig, BotSpec } from "./env";
import { escapeHtml } from "./telegram";

export function strategyName(id: string): string {
  return STRATEGIES.find((s) => s.id === id)?.name ?? id;
}

export function fmtTime(ms: number | null | undefined, tz: string): string {
  if (!ms) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms));
}

export function fmtPrice(p: number): string {
  const digits = p >= 1000 ? 2 : p >= 1 ? 4 : 6;
  return p.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

const STATE_ICON: Record<BotAnalysis["state"], string> = { LONG: "🟢", SHORT: "🟠", FLAT: "🔴", NONE: "⚪" };
const SIGNAL_LABEL: Record<string, string> = {
  BUY: "🟢 BUY", SELL: "🔴 SELL", SHORT: "🟠 SHORT", COVER: "🔵 COVER",
};

/** ค่าสัดส่วนเป็น % พร้อมเครื่องหมาย เช่น 0.0123 → "+1.23%" */
function fmtFlow(x: number): string {
  return `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}%`;
}

/**
 * บทวิเคราะห์ของกลยุทธ์ v3: ค่าสัญญาณเทียบเกณฑ์ และ **ระดับที่จะออก** เป็นตัวเลข
 * กลยุทธ์ตระกูลนี้ไม่มี stop ตามราคา การออกมาจากค่าสัญญาณล้วน ผู้ถือจึงต้องเห็นเส้นนั้นเอง
 */
export function insightLines(a: BotAnalysis): string[] {
  const x = a.insight;
  if (!x) return [];
  if (!x.ready) {
    return [`⏳ ข้อมูลยังไม่พอ: มี ${x.barsHave.toLocaleString("en-US")} แท่ง ต้องมี ${x.barsNeeded.toLocaleString("en-US")} แท่ง`];
  }
  const lines = [`<b>วิเคราะห์</b>`];
  const flow = x.flow!;
  const band = x.entryBand;
  lines.push(`แรงซื้อขายสุทธิ: <code>${fmtFlow(flow)}</code> (เกณฑ์เข้า ±${(band * 100).toFixed(2)}%)`);
  if (x.direction !== 0 && x.exitLevel !== null) {
    const side = x.direction === 1 ? "ต่ำกว่า" : "สูงกว่า";
    const room = Math.abs(flow - x.exitLevel);
    lines.push(`จะออกเมื่อ: แรงซื้อขายสุทธิ${side} <code>${fmtFlow(x.exitLevel)}</code> (ห่างอีก ${(room * 100).toFixed(2)}%)`);
  } else {
    lines.push(`จะเข้าซื้อเมื่อ &gt; ${fmtFlow(band)} · เข้าขายเมื่อ &lt; ${fmtFlow(-band)}`);
  }
  if (x.confidence !== null) lines.push(`ความแรงของสัญญาณ: ${Math.round(x.confidence * 100)}%`);
  if (x.atrPct !== null) lines.push(`ความผันผวนต่อแท่ง (ATR): ${x.atrPct.toFixed(2)}% ของราคา`);
  if (x.reason) lines.push(`เหตุผล: ${escapeHtml(x.reason)}`);
  return lines;
}

export function signalMessage(a: BotAnalysis, cfg: BotConfig): string {
  const icon = SIGNAL_LABEL[a.lastSignal] ?? `⚪ ${a.lastSignal}`;
  const analysis = insightLines(a);
  return [
    `<b>${icon}</b>  <b>${escapeHtml(a.bot.symbol)}</b> ${escapeHtml(a.bot.interval)}`,
    `กลยุทธ์: ${escapeHtml(strategyName(a.bot.strategyId))}`,
    `ราคาปิด: <code>${fmtPrice(a.price)}</code>`,
    `แท่งปิด: ${fmtTime(a.closeTime, cfg.timezone)}`,
    ...(analysis.length ? ["", ...analysis, ""] : []),
    `<i>แจ้งเตือนเท่านั้น บอทนี้ไม่ส่งออเดอร์</i>`,
  ].join("\n");
}

export function statusMessage(
  results: BotAnalysis[],
  cfg: BotConfig,
  state: Readonly<BotState>,
  header = "📊 สถานะบอทสัญญาณ",
): string {
  const lines: string[] = [`<b>${escapeHtml(header)}</b>`];
  lines.push(state.paused ? "⏸ <b>PAUSED</b> — ไม่ส่งแจ้งเตือนสัญญาณ" : "▶️ ทำงานอยู่");
  if (state.startedAt) lines.push(`uptime: ${fmtDuration(Date.now() - state.startedAt)}`);
  lines.push("");
  const byId = new Map(results.map((r) => [r.bot.id, r]));
  for (const bot of cfg.bots) {
    const r = byId.get(bot.id);
    if (!r) {
      lines.push(`❔ <b>${escapeHtml(bot.symbol)}</b> ${bot.interval} · ${escapeHtml(strategyName(bot.strategyId))} — ยังไม่มีข้อมูล`);
      continue;
    }
    const flip = r.lastFlipSignal
      ? `${r.lastFlipSignal} @ ${fmtTime(r.lastFlipTime, cfg.timezone)}`
      : "ยังไม่มีสัญญาณในช่วงข้อมูล";
    lines.push(
      `${STATE_ICON[r.state]} <b>${escapeHtml(bot.symbol)}</b> ${bot.interval} · ${escapeHtml(strategyName(bot.strategyId))}`,
      `   สถานะ ${r.state} · ราคา <code>${fmtPrice(r.price)}</code> · แท่งล่าสุด ${r.lastSignal}`,
      `   พลิกล่าสุด: ${escapeHtml(flip)}`,
    );
    // v3: บรรทัดเดียวพอให้เห็นว่าสัญญาณอยู่ห่างจากเส้นเข้า/ออกแค่ไหน โดยไม่ต้องรอ alert
    const x = r.insight;
    if (x && !x.ready) lines.push(`   ⏳ ข้อมูลยังไม่พอ (${x.barsHave}/${x.barsNeeded} แท่ง)`);
    else if (x && x.flow !== null) {
      const next = x.exitLevel !== null
        ? `ออกที่ ${fmtFlow(x.exitLevel)}`
        : `เข้าที่ ±${(x.entryBand * 100).toFixed(2)}%`;
      lines.push(`   แรงซื้อขายสุทธิ ${fmtFlow(x.flow)} · ${next}`);
    }
  }
  if (state.lastScanAt) lines.push("", `สแกนล่าสุด: ${fmtTime(state.lastScanAt, cfg.timezone)}`);
  if (state.lastError) lines.push(`⚠️ error ล่าสุด: ${escapeHtml(state.lastError.slice(0, 200))}`);
  return lines.join("\n");
}

export function botsMessage(cfg: BotConfig): string {
  const lines = [`<b>🤖 บอทที่ตั้งค่าไว้ (${cfg.bots.length})</b>`];
  for (const b of cfg.bots) {
    const params = Object.entries(b.params).map(([k, v]) => `${k}=${v}`).join(", ");
    lines.push(`• <b>${escapeHtml(b.symbol)}</b> ${b.interval} · ${escapeHtml(strategyName(b.strategyId))}`, `   <code>${escapeHtml(params)}</code>`);
  }
  lines.push("", `แท่งที่ใช้คำนวณ: ${cfg.klineLimit} · หน่วงหลังแท่งปิด: ${cfg.closeDelaySec}s · heartbeat: ${cfg.heartbeatMin || "ปิด"} นาที`);
  return lines.join("\n");
}

export function helpMessage(): string {
  return [
    "<b>คำสั่ง</b>",
    "/status — สถานะทุกบอท (จากผลสแกนล่าสุด)",
    "/scan — สแกนใหม่เดี๋ยวนี้แล้วรายงาน",
    "/pause — หยุดส่งแจ้งเตือนสัญญาณ (ยังสแกนอยู่)",
    "/resume — กลับมาส่งแจ้งเตือน",
    "/bots — รายการบอทและพารามิเตอร์",
    "/help — ข้อความนี้",
  ].join("\n");
}

export function startedMessage(cfg: BotConfig, bots: BotSpec[]): string {
  return [
    "🚀 <b>บอทสัญญาณเริ่มทำงาน</b>",
    `บอท ${bots.length} ตัว · Telegram ${cfg.telegramToken ? "เปิด" : "ปิด"}`,
    ...bots.map((b) => `• ${escapeHtml(b.symbol)} ${b.interval} · ${escapeHtml(strategyName(b.strategyId))}`),
    "",
    "พิมพ์ /help ดูคำสั่ง",
  ].join("\n");
}
