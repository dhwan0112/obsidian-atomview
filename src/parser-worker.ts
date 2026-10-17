import { readStructure } from "./readers/index.ts";
self.onmessage = async (e: MessageEvent) => {
  const { bytes, source, format, style } = e.data;
  try {
    const dataset = await readStructure(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      source,
      format,
      style,
    );
    const costs = dataset.frames.map(
      (f) =>
        new TextEncoder().encode(JSON.stringify(f)).length * 4 +
        f.atoms.length * 256,
    );
    const positions = new Float64Array(
      dataset.frames.reduce((n, f) => n + f.atoms.length * 3, 0),
    );
    let k = 0;
    const frames = dataset.frames.map((f) => ({
      ...f,
      atoms: f.atoms.map((a) => {
        const { position, ...rest } = a;
        positions.set(position, k);
        k += 3;
        return rest;
      }),
    }));
    self.postMessage(
      { dataset: { ...dataset, frames }, costs, positions: positions.buffer },
      { transfer: [positions.buffer] },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
