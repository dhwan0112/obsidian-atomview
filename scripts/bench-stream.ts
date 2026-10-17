/** Read-only full byte-index + selected-frame diagnostic; no source content is written. */
import { DumpFrameSource } from "../src/stream-source.ts";
import { readLocal } from "../src/readers/local.ts";
import { writeFile } from "node:fs/promises";
const file = process.argv[2];
if (!file) throw Error("Supply one local dump path");
const start = performance.now(),
  baseline = process.memoryUsage();
let peak = baseline.rss,
  maxLag = 0,
  last = performance.now();
const interval = setInterval(() => {
  const now = performance.now();
  maxLag = Math.max(maxLag, now - last - 20);
  last = now;
  peak = Math.max(peak, process.memoryUsage().rss);
}, 20);
let source: DumpFrameSource | undefined;
try {
  source = await DumpFrameSource.create(file, async (text, path) =>
    readLocal(text, path, "lammps-dump"),
  );
  const first = await source.getFrame(0),
    firstMs = performance.now() - start;
  await source.waitForIndex();
  const indexedMs = performance.now() - start,
    count = source.entries.length;
  const seeks = [];
  for (const index of [
    count - 1,
    Math.floor(count / 2),
    1,
    Math.floor(count / 3),
    count - 2,
    0,
  ]) {
    const t = performance.now(),
      frame = await source.getFrame(index);
    seeks.push({
      index,
      timestep: frame.timestep,
      atoms: frame.atoms.length,
      ms: performance.now() - t,
    });
  }
  peak = Math.max(peak, process.memoryUsage().rss);
  const result = {
    status: "PASS",
    scope: "Node production byte index and parsers; no GUI/GPU/worker transfer",
    sourceName: file.split("/").pop(),
    bytes: source.entries.at(-1)?.end,
    frames: count,
    atoms: first.atoms.length,
    firstMs,
    indexedMs,
    seeks,
    cacheBytes: source.cacheBytes,
    baseline,
    final: process.memoryUsage(),
    peakSampledRss: peak,
    maxEventLoopLagMs: maxLag,
    sourceModified: false,
  };
  await writeFile(
    "test-artifacts/stream-benchmark-" + source.entries.at(-1)?.end + ".json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearInterval(interval);
  await source?.dispose();
}
