/**
 * บอทสัญญาณ TypeScript — process เดียวรันค้างบน VPS (pm2 / systemd)
 *
 *   Binance klines (public) → lib/indicators.ts → STRATEGY_FNS (lib/backtest.ts) → Telegram
 *
 * - ตื่นมาสแกน "หลังแท่งปิด" ของแต่ละ interval (ไม่ polling ถี่)
 * - กันยิงซ้ำด้วย closeTime ต่อบอท เก็บใน state file รอด restart
 * - แจ้งเตือนอย่างเดียว ไม่ยิงออเดอร์ (ตัวยิงออเดอร์คือ freqtrade — ดู signal-bot/live-execution-plan-th.md)
 *
 * ใช้:
 *   npx tsx signal-bot/index.ts            รันค้าง
 *   npx tsx signal-bot/index.ts --once     สแกนรอบเดียว พิมพ์ผลแล้วออก (ไม่ส่ง Telegram)
 *   npx tsx signal-bot/index.ts --once --send   สแกนรอบเดียวแล้วส่งสรุปสถานะเข้า Telegram
 */
import { loadConfig, type BotConfig, type BotSpec } from "./env";
import { StateStore } from "./state";
import { Telegram, escapeHtml } from "./telegram";
import { evaluateBots, type BotAnalysis } from "./scanner";
import { intervalMs, lastClosedCloseTime, nextCloseTime, sleep } from "./schedule";
import { botsMessage, fmtTime, helpMessage, signalMessage, startedMessage, statusMessage } from "./format";

const args = new Set(process.argv.slice(2));
const ONCE = args.has("--once");
const SEND = args.has("--send");

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

class SignalBot {
  private readonly store: StateStore;
  private readonly tg: Telegram;
  private readonly lastResults = new Map<string, BotAnalysis>();
  private readonly shutdown = new AbortController();
  private readonly errorSentAt = new Map<string, number>();
  private scanning: Promise<void> | null = null;

  constructor(private readonly cfg: BotConfig) {
    this.store = new StateStore(cfg.stateFile);
    this.tg = new Telegram(cfg.telegramToken, {
      allowedChatIds: cfg.allowedChatIds,
      defaultChatId: cfg.telegramChatId,
      getOffset: () => this.store.get().telegramOffset,
      setOffset: (o) => this.store.update((s) => { s.telegramOffset = o; }),
      log,
    });
    this.registerCommands();
  }

  // ─── คำสั่ง Telegram ───────────────────────────────────────────
  private registerCommands(): void {
    this.tg.onCommand("help", () => helpMessage());
    this.tg.onCommand("start", () => helpMessage());
    this.tg.onCommand("bots", () => botsMessage(this.cfg));
    this.tg.onCommand("status", () =>
      statusMessage([...this.lastResults.values()], this.cfg, this.store.get()));
    this.tg.onCommand("pause", () => {
      this.store.update((s) => { s.paused = true; });
      log("[cmd] pause");
      return "⏸ หยุดส่งแจ้งเตือนสัญญาณแล้ว (ยังสแกนและตอบ /status ได้) — /resume เพื่อกลับมา";
    });
    this.tg.onCommand("resume", () => {
      this.store.update((s) => { s.paused = false; });
      log("[cmd] resume");
      return "▶️ กลับมาส่งแจ้งเตือนสัญญาณแล้ว";
    });
    this.tg.onCommand("scan", async () => {
      await this.scan(this.cfg.bots, "manual");
      return statusMessage([...this.lastResults.values()], this.cfg, this.store.get(), "🔎 ผลสแกน (manual)");
    });
  }

  // ─── สแกน ─────────────────────────────────────────────────────
  /** สแกนบอทชุดที่กำหนด แล้วส่งแจ้งเตือนสัญญาณที่ใหม่และยังไม่เคยส่ง */
  async scan(bots: BotSpec[], reason: string): Promise<void> {
    // กันสแกนซ้อน (เช่น /scan ระหว่างรอบตามเวลา)
    if (this.scanning) await this.scanning;
    this.scanning = this.scanInner(bots, reason).finally(() => { this.scanning = null; });
    return this.scanning;
  }

  private async scanInner(bots: BotSpec[], reason: string): Promise<void> {
    const t0 = Date.now();
    const { results, errors, groupsFetched } = await evaluateBots(bots, this.cfg.klineLimit);
    const now = Date.now();
    for (const r of results) this.lastResults.set(r.bot.id, r);

    const alerts: BotAnalysis[] = [];
    const state = this.store.get();
    for (const r of results) {
      if (r.lastSignal === "HOLD") continue;
      const prev = state.lastAlert[r.bot.id];
      if (prev && prev.closeTime >= r.closeTime) continue;           // ส่งไปแล้ว
      const ms = intervalMs(r.bot.interval) ?? 31 * 86_400_000;
      if (now - r.closeTime > ms + this.cfg.closeDelaySec * 1000 + 60_000) continue; // แท่งเก่าเกิน 1 ช่วง (เช่น หลัง restart)
      alerts.push(r);
    }

    this.store.update((s) => {
      s.lastScanAt = now;
      s.lastError = errors.length ? errors[0] : null;
    });

    log(`[scan:${reason}] bots=${bots.length} groups=${groupsFetched} results=${results.length} alerts=${alerts.length} errors=${errors.length} ${now - t0}ms`);
    for (const e of errors) {
      log(`[scan:error] ${e}`);
      await this.notifyErrorThrottled(e);
    }

    for (const a of alerts) {
      if (this.store.get().paused) {
        log(`[alert:paused] ${a.bot.id} ${a.lastSignal} @ ${a.closeTime}`);
        // บันทึกว่าเห็นแล้ว เพื่อไม่ให้ส่งย้อนหลังตอน /resume
        this.store.update((s) => { s.lastAlert[a.bot.id] = { closeTime: a.closeTime, signal: a.lastSignal, price: a.price, at: now }; });
        continue;
      }
      log(`[alert] ${a.bot.id} ${a.lastSignal} price=${a.price} close=${new Date(a.closeTime).toISOString()}`);
      await this.tg.send(signalMessage(a, this.cfg));
      this.store.update((s) => { s.lastAlert[a.bot.id] = { closeTime: a.closeTime, signal: a.lastSignal, price: a.price, at: now }; });
    }
  }

  private async notifyErrorThrottled(err: string): Promise<void> {
    const key = err.slice(0, 80);
    const last = this.errorSentAt.get(key) ?? 0;
    if (Date.now() - last < 15 * 60_000) return;
    this.errorSentAt.set(key, Date.now());
    await this.tg.send(`⚠️ <b>scan error</b>\n<code>${escapeHtml(err.slice(0, 500))}</code>`);
  }

  // ─── ตารางเวลา ────────────────────────────────────────────────
  /** loop ต่อ interval: รอจนแท่งปิด + delay → สแกนเฉพาะบอทของ interval นั้น */
  private async runIntervalLoop(interval: string, bots: BotSpec[]): Promise<void> {
    const sig = this.shutdown.signal;
    const ms = intervalMs(interval);
    while (!sig.aborted) {
      if (ms === null) {
        // interval ที่คำนวณเวลาปิดไม่ได้ (1M) → polling ตามรอบ กันซ้ำด้วย closeTime อยู่แล้ว
        await sleep(this.cfg.fallbackPollSec * 1000, sig);
        if (sig.aborted) break;
        await this.scan(bots, `poll:${interval}`).catch((e) => log(`[loop:${interval}] ${String(e)}`));
        continue;
      }
      const next = nextCloseTime(interval)!;
      const wakeAt = next + this.cfg.closeDelaySec * 1000;
      log(`[loop:${interval}] แท่งถัดไปปิด ${fmtTime(next, this.cfg.timezone)} → ตื่น ${fmtTime(wakeAt, this.cfg.timezone)}`);
      await sleep(wakeAt - Date.now(), sig);
      if (sig.aborted) break;

      // Binance อาจส่งแท่งปิดช้ากว่าเวลาจริงเล็กน้อย → ถ้ายังไม่เห็นแท่งที่คาด ลองใหม่สูงสุด 4 ครั้ง
      const expected = lastClosedCloseTime(interval)!;
      for (let attempt = 1; attempt <= 4; attempt++) {
        await this.scan(bots, `close:${interval}#${attempt}`).catch((e) => log(`[loop:${interval}] ${String(e)}`));
        const got = bots.map((b) => this.lastResults.get(b.id)?.closeTime ?? 0);
        if (got.every((c) => c >= expected)) break;
        log(`[loop:${interval}] ยังไม่เห็นแท่ง ${fmtTime(expected, this.cfg.timezone)} ครบทุกคู่ รอ 15s`);
        await sleep(15_000, sig);
        if (sig.aborted) break;
      }
    }
  }

  private async runHeartbeat(): Promise<void> {
    if (!this.cfg.heartbeatMin) return;
    const sig = this.shutdown.signal;
    while (!sig.aborted) {
      await sleep(this.cfg.heartbeatMin * 60_000, sig);
      if (sig.aborted) break;
      await this.tg.send(statusMessage([...this.lastResults.values()], this.cfg, this.store.get(), "💓 heartbeat"));
      this.store.update((s) => { s.lastHeartbeatAt = Date.now(); });
    }
  }

  // ─── lifecycle ────────────────────────────────────────────────
  async start(): Promise<void> {
    this.store.update((s) => { s.startedAt = Date.now(); });
    if (this.tg.enabled) {
      const me = await this.tg.getMe();
      log(`[telegram] bot @${me?.username ?? "?"}`);
      await this.tg.setCommands([
        { command: "status", description: "สถานะทุกบอท" },
        { command: "scan", description: "สแกนใหม่เดี๋ยวนี้" },
        { command: "pause", description: "หยุดส่งแจ้งเตือน" },
        { command: "resume", description: "กลับมาส่งแจ้งเตือน" },
        { command: "bots", description: "รายการบอท" },
        { command: "help", description: "วิธีใช้" },
      ]).catch((e) => log(`[telegram] setMyCommands: ${String(e)}`));
      this.tg.startPolling();
    }

    // สแกนครั้งแรกให้ /status ตอบได้ทันที (สัญญาณเก่ากว่า 1 ช่วงจะไม่ถูกส่ง)
    await this.scan(this.cfg.bots, "startup");
    await this.tg.send(startedMessage(this.cfg, this.cfg.bots));
    await this.tg.send(statusMessage([...this.lastResults.values()], this.cfg, this.store.get()));

    const byInterval = new Map<string, BotSpec[]>();
    for (const b of this.cfg.bots) byInterval.set(b.interval, [...(byInterval.get(b.interval) ?? []), b]);

    const loops = [...byInterval.entries()].map(([iv, bots]) => this.runIntervalLoop(iv, bots));
    loops.push(this.runHeartbeat());
    await Promise.all(loops);
  }

  async stop(reason: string): Promise<void> {
    log(`[shutdown] ${reason}`);
    this.shutdown.abort();
    this.tg.stopPolling();
    this.store.save();
    await Promise.race([
      this.tg.send(`⏹ บอทสัญญาณหยุดทำงาน (${escapeHtml(reason)})`),
      sleep(3000),
    ]).catch(() => undefined);
  }

  /** โหมด --once: สแกนแล้วพิมพ์ผล ไม่ส่ง alert */
  async once(send: boolean): Promise<void> {
    const { results, errors } = await evaluateBots(this.cfg.bots, this.cfg.klineLimit);
    for (const r of results) this.lastResults.set(r.bot.id, r);
    for (const r of results) {
      console.log(
        `${r.bot.id.padEnd(34)} state=${r.state.padEnd(4)} last=${r.lastSignal.padEnd(4)} price=${r.price} ` +
        `close=${new Date(r.closeTime).toISOString()} flip=${r.lastFlipSignal ?? "-"}@${r.lastFlipTime ? new Date(r.lastFlipTime).toISOString() : "-"} bars=${r.bars}`,
      );
    }
    for (const e of errors) console.error(`ERROR ${e}`);
    if (send) await this.tg.send(statusMessage(results, this.cfg, this.store.get(), "🔎 ผลสแกน (--once)"));
    if (errors.length) process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  log(`[boot] bots=${cfg.bots.map((b) => b.id).join(", ")} telegram=${cfg.telegramToken ? "on" : "off"} state=${cfg.stateFile}`);
  const bot = new SignalBot(cfg);

  if (ONCE) {
    await bot.once(SEND);
    return;
  }

  let stopping = false;
  const onSignal = (sig: string) => {
    if (stopping) return;
    stopping = true;
    bot.stop(sig).finally(() => process.exit(0));
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("unhandledRejection", (e) => log(`[unhandledRejection] ${String(e)}`));

  await bot.start();
}

main().catch((err) => {
  console.error(`[fatal] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
