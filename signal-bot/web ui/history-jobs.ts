import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { RequestConfig } from "./data";
interface Job {
  id: string; child: ChildProcess; status: "running" | "ready" | "error" | "cancelled";
  progress: string; at: number; result?: any; error?: string; busy: boolean;
  sequence: number; pending: Map<number, { resolve: (value: any) => void; reject: (e: Error) => void }>;
}
const jobs = new Map<string, Job>();
function request(job: Job, command: string, input: unknown) {
  const requestId = ++job.sequence;
  return new Promise<any>((resolve, reject) => {
    job.pending.set(requestId, { resolve, reject });
    job.child.send({ requestId, command, input }, error => {
      if (error) { job.pending.delete(requestId); reject(error); }
    });
  });
}
export function cancelJob(id: string) {
  const job = jobs.get(id);
  if (!job) throw Error("ไม่พบรอบทดสอบ");
  job.status = "cancelled"; job.result = undefined; job.progress = "ยกเลิกแล้ว";
  job.child.kill();
  for (const p of job.pending.values()) p.reject(Error("ยกเลิกแล้ว"));
  job.pending.clear();
}
export function startJob(cfg: RequestConfig) {
  if ([...jobs.values()].some(j => j.status === "running" || j.busy)) throw Error("มีงานทดสอบกำลังทำงานอยู่");
  // Keep one full dataset resident; a new local run explicitly replaces the previous one.
  for (const job of jobs.values()) if (job.child.connected) cancelJob(job.id);
  jobs.clear();
  const child = fork(fileURLToPath(new URL("./history-worker.ts", import.meta.url)), [], {
    execArgv: ["--import", "tsx", "--max-old-space-size=3072"], serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const job: Job = { id: randomUUID(), child, status: "running", progress: "เริ่มงาน", at: Date.now(), busy: false, sequence: 0, pending: new Map() };
  jobs.set(job.id, job);
  child.on("message", (m: any) => {
    job.at = Date.now();
    if (m.progress) job.progress = m.progress;
    const p = job.pending.get(m.requestId);
    if (p) { job.pending.delete(m.requestId); m.error ? p.reject(Error(m.error)) : p.resolve(m.result); }
  });
  const fail = (error: string) => {
    if (job.status !== "cancelled") { job.status = "error"; job.error ??= error; job.result = undefined; }
    for (const p of job.pending.values()) p.reject(Error(error));
    job.pending.clear();
  };
  child.on("error", e => fail(e.message));
  child.on("exit", (code, signal) => fail(`Worker หยุด (${code ?? signal})`));
  request(job, "start", cfg).then(result => {
    if (job.status === "cancelled") return;
    job.result = { ...result, runId: job.id }; job.status = "ready"; job.progress = "ทดสอบเสร็จ";
  }, e => { if (job.status !== "cancelled") { job.status = "error"; job.error = e.message; job.child.kill(); } });
  return job.id;
}
export function jobStatus(id: string) {
  const job = jobs.get(id);
  if (!job) throw Error("ผลทดสอบหมดอายุหรือไม่พบรอบทดสอบ");
  job.at = Date.now();
  return { runId: id, status: job.status, progress: job.progress, error: job.error, result: job.status === "ready" ? job.result : undefined };
}
export async function jobView(id: string, input: unknown) {
  const job = jobs.get(id);
  if (!job || job.status !== "ready") throw Error("ผลทดสอบยังไม่พร้อมหรือหมดอายุ");
  if (job.busy) throw Error("กำลังเปิดข้อมูล กรุณารอสักครู่");
  job.busy = true; job.at = Date.now();
  try { return { ...await request(job, "view", input), runId: id }; }
  finally { job.busy = false; }
}
setInterval(() => {
  for (const job of jobs.values()) if (job.status === "ready" && !job.busy && Date.now() - job.at > 30 * 60000) { cancelJob(job.id); jobs.delete(job.id); }
}, 60000).unref();
process.on("exit", () => { for (const job of jobs.values()) job.child.kill(); });
