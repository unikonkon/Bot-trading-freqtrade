/** Run from the root of an extracted export: npm ci && npm run replay */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import type { KlineData } from "../../lib/types/kline";
import type { StrategyId } from "../../lib/backtest";
import { calculateExport } from "./export-calculations";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
async function main() {
  const read = (name: string) => fs.readFile(path.join(root, name), "utf8");
  const config = JSON.parse(await read("config.json")) as {
    startIndex: number;
    strategies: StrategyId[];
    params: Record<string, Record<string, number>>;
    fee: number;
    slippage: number;
    mode: string;
  };
  const manifest = JSON.parse(await read("manifest.json")) as {
    sha256: Record<string, string>;
  };
  for (const [file, hash] of Object.entries(manifest.sha256)) {
    if (path.isAbsolute(file) || file.split("/").includes(".."))
      throw new Error("Unsafe manifest path");
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(path.join(root, file)))
        .digest("hex"),
      hash,
      `Checksum mismatch: ${file}`,
    );
  }
  const klines = JSON.parse(await read("input-klines.json")) as KlineData[];
  await fs.mkdir(path.join(root, "recomputed"), { recursive: true });
  for (const id of config.strategies) {
    const actual = calculateExport(
      klines,
      config.startIndex,
      id,
      config.params[id],
      config.fee,
      config.slippage,
      config.mode,
    );
    const normalized = JSON.parse(JSON.stringify(actual));
    assert.deepEqual(
      normalized,
      JSON.parse(await read(`calculations/${id}.json`)),
      `Replay mismatch: ${id}`,
    );
    await fs.writeFile(
      path.join(root, `recomputed/${id}.json`),
      JSON.stringify(normalized, null, 2),
    );
    console.log(
      `PASS ${id}: ${actual.records.length} candles; signals, indicators and simulations match`,
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
