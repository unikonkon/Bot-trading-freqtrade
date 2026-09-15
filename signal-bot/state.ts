/**
 * สถานะที่ต้องรอดข้าม restart — เก็บเป็น JSON ไฟล์เดียว เขียนแบบ atomic (tmp + rename)
 */
import fs from "node:fs";
import path from "node:path";

export interface AlertRecord {
  closeTime: number;
  signal: string;
  price: number;
  at: number;
}

export interface BotState {
  paused: boolean;
  lastAlert: Record<string, AlertRecord>;   // key = bot.id
  telegramOffset: number;                    // update_id ล่าสุดที่ประมวลผลแล้ว
  lastScanAt: number;
  lastHeartbeatAt: number;
  lastError: string | null;
  startedAt: number;
}

const DEFAULT_STATE: BotState = {
  paused: false,
  lastAlert: {},
  telegramOffset: 0,
  lastScanAt: 0,
  lastHeartbeatAt: 0,
  lastError: null,
  startedAt: 0,
};

export class StateStore {
  private state: BotState;

  constructor(private readonly file: string) {
    this.state = this.load();
  }

  private load(): BotState {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<BotState>;
        return { ...DEFAULT_STATE, ...parsed, lastAlert: parsed.lastAlert ?? {} };
      }
    } catch (err) {
      console.error(`[state] อ่าน ${this.file} ไม่ได้ ใช้ค่าเริ่มต้น: ${String(err)}`);
    }
    return { ...DEFAULT_STATE, lastAlert: {} };
  }

  get(): Readonly<BotState> {
    return this.state;
  }

  update(fn: (s: BotState) => void): void {
    fn(this.state);
    this.save();
  }

  save(): void {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
