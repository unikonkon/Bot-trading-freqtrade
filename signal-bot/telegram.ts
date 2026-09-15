/**
 * Telegram Bot API แบบ long polling (getUpdates) — ไม่ต้องเปิดพอร์ต ไม่ต้องมี webhook/โดเมน
 * ใช้ fetch ของ Node 20+ ไม่มี dependency เพิ่ม
 *
 * ความปลอดภัย: รับคำสั่งเฉพาะจาก chat id ใน allowedChatIds เท่านั้น ที่เหลือเงียบ (log อย่างเดียว)
 */
export interface CommandContext {
  chatId: string;
  fromId: string;
  fromName: string;
  args: string[];
  text: string;
}

export type CommandHandler = (ctx: CommandContext) => Promise<string | void> | string | void;

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number | string; type: string };
    from?: { id: number; first_name?: string; username?: string };
  };
}

export interface TelegramOptions {
  allowedChatIds: Set<string>;
  defaultChatId: string;
  getOffset: () => number;
  setOffset: (offset: number) => void;
  log?: (msg: string) => void;
}

const MAX_LEN = 4000; // Telegram จำกัด 4096 ตัวอักษรต่อข้อความ

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class Telegram {
  readonly enabled: boolean;
  private readonly base: string;
  private readonly handlers = new Map<string, CommandHandler>();
  private polling = false;
  private abort: AbortController | null = null;
  private botUsername = "";
  private readonly log: (msg: string) => void;

  constructor(token: string, private readonly opts: TelegramOptions) {
    this.enabled = Boolean(token);
    this.base = `https://api.telegram.org/bot${token}`;
    this.log = opts.log ?? ((m) => console.log(m));
  }

  onCommand(name: string, handler: CommandHandler): void {
    this.handlers.set(name.replace(/^\//, "").toLowerCase(), handler);
  }

  private async call<T>(method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
    return json.result as T;
  }

  /** ส่งข้อความ (HTML) ไป chat ที่กำหนด; ถ้าปิด Telegram จะพิมพ์ลง log แทน */
  async send(text: string, chatId = this.opts.defaultChatId): Promise<void> {
    if (!this.enabled) {
      this.log(`[telegram:disabled] ${text.replace(/<[^>]+>/g, "")}`);
      return;
    }
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > MAX_LEN) {
      let cut = rest.lastIndexOf("\n", MAX_LEN);
      if (cut < MAX_LEN / 2) cut = MAX_LEN;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    chunks.push(rest);
    for (const chunk of chunks) {
      try {
        await this.call("sendMessage", {
          chat_id: chatId,
          text: chunk,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      } catch (err) {
        // ถ้า HTML พัง (เช่น ตัวอักษรพิเศษ) ส่งซ้ำแบบ plain text
        this.log(`[telegram] sendMessage HTML ล้มเหลว ลอง plain: ${String(err)}`);
        await this.call("sendMessage", { chat_id: chatId, text: chunk.replace(/<[^>]+>/g, "") });
      }
    }
  }

  async setCommands(commands: { command: string; description: string }[]): Promise<void> {
    if (!this.enabled) return;
    await this.call("setMyCommands", { commands });
  }

  async getMe(): Promise<{ username?: string } | null> {
    if (!this.enabled) return null;
    const me = await this.call<{ username?: string }>("getMe");
    this.botUsername = (me.username ?? "").toLowerCase();
    return me;
  }

  /** เริ่ม long polling (ไม่ block) */
  startPolling(): void {
    if (!this.enabled || this.polling) return;
    this.polling = true;
    this.abort = new AbortController();
    void this.loop();
  }

  stopPolling(): void {
    this.polling = false;
    this.abort?.abort();
  }

  private async loop(): Promise<void> {
    let backoff = 1000;
    while (this.polling) {
      try {
        const offset = this.opts.getOffset();
        const updates = await this.call<TgUpdate[]>(
          "getUpdates",
          { offset: offset > 0 ? offset + 1 : undefined, timeout: 30, allowed_updates: ["message"] },
          this.abort?.signal,
        );
        backoff = 1000;
        for (const u of updates) {
          this.opts.setOffset(u.update_id);
          await this.handle(u);
        }
      } catch (err) {
        if (!this.polling) break;
        this.log(`[telegram] polling error: ${String(err)} (รอ ${backoff / 1000}s)`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  private async handle(u: TgUpdate): Promise<void> {
    const msg = u.message;
    if (!msg?.text) return;
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    if (!text.startsWith("/")) return;

    if (!this.opts.allowedChatIds.has(chatId)) {
      this.log(`[telegram] ปฏิเสธคำสั่งจาก chat ${chatId} (${msg.from?.username ?? "?"}): ${text}`);
      return;
    }

    const [rawCmd, ...args] = text.split(/\s+/);
    let cmd = rawCmd.slice(1).toLowerCase();
    if (cmd.includes("@")) {
      const [name, target] = cmd.split("@");
      if (this.botUsername && target !== this.botUsername) return; // สั่งบอทตัวอื่นในกลุ่ม
      cmd = name;
    }
    const handler = this.handlers.get(cmd);
    if (!handler) {
      await this.send(`ไม่รู้จักคำสั่ง /${escapeHtml(cmd)} — พิมพ์ /help`, chatId);
      return;
    }
    try {
      const reply = await handler({
        chatId,
        fromId: String(msg.from?.id ?? ""),
        fromName: msg.from?.username ?? msg.from?.first_name ?? "",
        args,
        text,
      });
      if (reply) await this.send(reply, chatId);
    } catch (err) {
      await this.send(`⚠️ คำสั่ง /${escapeHtml(cmd)} ล้มเหลว: ${escapeHtml(String(err))}`, chatId);
    }
  }
}
