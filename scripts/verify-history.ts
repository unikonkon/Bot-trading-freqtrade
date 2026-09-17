import path from "node:path";
import { readManifest, snapshotPath, PERIODS, verifySegment, atomicJSON } from "./history-storage";
async function main() {
  const id = process.argv[2];
  if (!id) throw Error("Usage: npm run history:verify -- <snapshot-id>");
  const m = await readManifest(id), root = snapshotPath(id), records = [];
  if (m.records.length !== 9 || new Set(m.records.map(r => r.interval)).size !== 9) throw Error("Expected all nine intervals");
  for (const r of m.records) {
    if (r.data.status !== "complete" || r.warmup.status !== "complete") throw Error(`Incomplete dataset: ${r.interval}`);
    if (r.warmup.to + 1 !== r.data.from || r.data.to >= m.asOf) throw Error("Invalid boundary");
    const data = await verifySegment(root, r.data, PERIODS[r.interval]);
    const warmup = await verifySegment(root, r.warmup, PERIODS[r.interval]);
    records.push({ interval: r.interval, from: new Date(r.data.from).toISOString(), to: new Date(r.data.to).toISOString(), ...data, warmupBars: warmup.bars });
    console.log(`${r.interval}: ${data.bars} + ${warmup.bars} warmup, SHA-256 OK, continuous closed candles`);
  }
  const report = { snapshot: id, checkedAt: new Date().toISOString(), passed: true, testBars: records.reduce((sum, r) => sum + r.bars, 0), records };
  await atomicJSON(path.join(root, "verification.json"), report);
  console.log(`Verified ${report.testBars} test candles across 9 intervals`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
