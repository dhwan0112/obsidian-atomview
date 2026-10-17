import { open, realpath, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Dataset, Frame } from "./model.ts";
import { LIMITS, estimatedFrameBytes } from "./model.ts";

export const STREAM_LIMITS = {
  bytes: 2 * 1024 ** 3,
  frames: 100000,
  chunk: 256 * 1024,
  line: 1024 * 1024,
  cache: 16 * 1024 ** 2,
  cachedFrames: 4,
};
export interface FrameEntry {
  offset: number;
  end: number;
  timestep: string;
  atoms: number;
}
export interface Progress {
  frames: number;
  bytes: number;
  total: number;
  complete: boolean;
  error?: string;
}
const indexCache = new Map<
  string,
  { signature: string; entries: FrameEntry[]; bytes: number }
>();
export function clearIndexCache() {
  indexCache.clear();
}
type Parse = (text: string, source: string) => Promise<Dataset>;
const yieldUI = () => new Promise<void>((r) => setTimeout(r, 0));

/** Byte-indexed, read-only LAMMPS source. The index validates framing; atom values are validated on access. */
export class DumpFrameSource {
  entries: FrameEntry[] = [];
  complete = false;
  error?: Error;
  cacheBytes = 0;
  private handle?: FileHandle;
  private signature = "";
  private closed = false;
  private scanning?: Promise<void>;
  private waiters = new Set<() => void>();
  private cache = new Map<number, { frame: Frame; bytes: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  private firstIDs?: Set<string>;
  private size = 0;
  private lastProgress = 0;
  private unbindAbort?: () => void;
  private disposing?: Promise<void>;
  private constructor(
    private file: string,
    private parse: Parse,
    private progress: (p: Progress) => void,
  ) {}
  static async create(
    file: string,
    parse: Parse,
    progress: (p: Progress) => void = () => {},
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) throw Error("Trajectory opening cancelled");
    const s = new DumpFrameSource(await realpath(file), parse, progress);
    try {
      s.handle = await open(s.file, "r");
      if (signal?.aborted) throw Error("Trajectory opening cancelled");
      if (signal) {
        const abort = () => {
          void s.dispose();
        };
        signal.addEventListener("abort", abort, { once: true });
        s.unbindAbort = () => signal.removeEventListener("abort", abort);
      }
      const info = await s.handle.stat();
      if (!info.isFile() || info.size > STREAM_LIMITS.bytes || !info.size)
        throw Error("Streaming requires a nonempty regular file ≤2 GiB");
      s.size = info.size;
      s.signature = s.key(info);
      const cached = indexCache.get(s.file);
      if (cached?.signature === s.signature) {
        s.entries = cached.entries;
        s.complete = true;
        s.notify(s.size, true);
        return s;
      }
      indexCache.delete(s.file);
      s.scanning = s.scan().catch((e) => {
        if (!s.closed) {
          s.error = e instanceof Error ? e : Error(String(e));
          s.notify(s.size, true);
        }
        s.wake();
      });
      await s.ensure(0, signal);
      return s;
    } catch (e) {
      await s.dispose();
      throw e;
    }
  }
  private key(s: {
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
  }) {
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  }
  private async unchanged() {
    if (this.closed || !this.handle) throw Error("Trajectory closed");
    if (
      (await realpath(this.file)) !== this.file ||
      this.key(await stat(this.file)) !== this.signature ||
      this.key(await this.handle.stat()) !== this.signature
    )
      throw Error(
        "Source changed or was replaced; reload to rebuild its frame index",
      );
  }
  private wake() {
    for (const w of this.waiters) w();
    this.waiters.clear();
  }
  private notify(bytes: number, force = false) {
    if (this.closed) return;
    if (force || Date.now() - this.lastProgress > 120) {
      this.lastProgress = Date.now();
      this.progress({
        frames: this.entries.length,
        bytes,
        total: this.size,
        complete: this.complete,
        error: this.error?.message,
      });
    }
  }
  private async wait(signal?: AbortSignal) {
    if (signal?.aborted) throw Error("Frame request cancelled");
    await new Promise<void>((resolve) => {
      const wake = () => {
        this.waiters.delete(wake);
        signal?.removeEventListener("abort", wake);
        resolve();
      };
      this.waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
    });
    if (signal?.aborted) throw Error("Frame request cancelled");
  }
  private async ensure(index: number, signal?: AbortSignal) {
    if (!Number.isInteger(index) || index < 0 || index >= STREAM_LIMITS.frames)
      throw Error("Frame out of range (0-based)");
    while (
      !this.closed &&
      !this.error &&
      this.entries.length <= index &&
      !this.complete
    )
      await this.wait(signal);
    if (this.closed) throw Error("Trajectory closed");
    if (this.error) throw this.error;
    if (!this.entries[index])
      throw Error(
        `Frame ${index} out of range: expected 0–${this.entries.length - 1}`,
      );
  }
  private async scan() {
    const buffer = new Uint8Array(STREAM_LIMITS.chunk);
    let pending = new Uint8Array(0),
      pendingOffset = 0,
      position = 0;
    let stage = 0,
      start = 0,
      timestep = "",
      atoms = 0,
      rows = 0,
      lineCount = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const line = (bytes: Uint8Array, offset: number, end: number) => {
      if (bytes.length > STREAM_LIMITS.line)
        throw Error("Trajectory line exceeds 1 MiB limit");
      if (stage === 9) {
        if (
          !bytes.length ||
          (bytes[0] === 73 &&
            bytes[1] === 84 &&
            bytes[2] === 69 &&
            bytes[3] === 77 &&
            bytes[4] === 58)
        )
          throw Error("Truncated frame / atom count mismatch");
        rows++;
        if (rows === atoms) {
          if (end - start > LIMITS.bytes)
            throw Error("One frame exceeds 16 MiB limit");
          if (this.entries.length >= STREAM_LIMITS.frames)
            throw Error("Streaming frame index exceeds 100,000 entries");
          this.entries.push({ offset: start, end, timestep, atoms });
          stage = 0;
          this.wake();
          this.notify(end, this.entries.length === 1);
        }
        return;
      }
      const s = decoder.decode(bytes).trim();
      if (!s && stage === 0) return;
      if (stage === 0) {
        if (s !== "ITEM: TIMESTEP")
          throw Error("Expected ITEM: TIMESTEP (uncompressed text dumps only)");
        start = offset;
      }
      if (end - start > LIMITS.bytes)
        throw Error("One frame exceeds 16 MiB limit");
      if (stage === 1) {
        if (!/^-?\d+$/.test(s)) throw Error("Invalid timestep");
        timestep = s;
      }
      if (stage === 2 && s !== "ITEM: NUMBER OF ATOMS")
        throw Error("Missing atom count");
      if (stage === 3) {
        atoms = Number(s);
        if (
          !/^\d+$/.test(s) ||
          !Number.isSafeInteger(atoms) ||
          atoms < 1 ||
          atoms > LIMITS.atoms
        )
          throw Error("Invalid/oversized frame atom count");
        rows = 0;
      }
      if (
        stage === 4 &&
        (!s.startsWith("ITEM: BOX BOUNDS") || /\b(abc|origin)\b/.test(s))
      )
        throw Error("Unsupported dump box (general triclinic is unsupported)");
      if (stage === 8 && !s.startsWith("ITEM: ATOMS "))
        throw Error("Missing atom columns");
      stage++;
    };
    while (position < this.size && !this.closed) {
      const { bytesRead } = await this.handle!.read(
        buffer,
        0,
        Math.min(buffer.length, this.size - position),
        position,
      );
      if (!bytesRead) throw Error("Source truncated during indexing");
      const chunk = new Uint8Array(pending.length + bytesRead);
      chunk.set(pending);
      chunk.set(buffer.subarray(0, bytesRead), pending.length);
      const base = pendingOffset;
      let sliceStart = performance.now();
      let from = 0,
        next = chunk.indexOf(10);
      while (next !== -1) {
        line(
          chunk.subarray(
            from,
            next > from && chunk[next - 1] === 13 ? next - 1 : next,
          ),
          base + from,
          base + next + 1,
        );
        from = next + 1;
        next = chunk.indexOf(10, from);
        if (++lineCount % 1024 === 0 && performance.now() - sliceStart > 6) {
          await yieldUI();
          sliceStart = performance.now();
          if (this.closed) return;
        }
      }
      pending = chunk.slice(from);
      pendingOffset = base + from;
      position += bytesRead;
      if (pending.length > STREAM_LIMITS.line)
        throw Error("Trajectory line exceeds 1 MiB limit");
      if (stage && position - start > LIMITS.bytes + STREAM_LIMITS.chunk)
        throw Error("One frame exceeds 16 MiB limit");
      this.notify(position);
      await yieldUI();
    }
    if (this.closed) return;
    if (pending.length) line(pending, pendingOffset, this.size);
    if (stage !== 0) throw Error("Truncated final trajectory frame");
    await this.unchanged();
    this.complete = true;
    const bytes = this.entries.length * 160;
    if (bytes <= 16 * 1024 ** 2) {
      let total = [...indexCache.values()].reduce((n, x) => n + x.bytes, 0);
      while (indexCache.size && total + bytes > 16 * 1024 ** 2) {
        const key = indexCache.keys().next().value!;
        total -= indexCache.get(key)!.bytes;
        indexCache.delete(key);
      }
      indexCache.set(this.file, {
        signature: this.signature,
        entries: this.entries,
        bytes,
      });
    }
    this.notify(this.size, true);
    this.wake();
  }
  /** Serial parser queue + LRU bounds retained frames; caller cancellation never publishes stale results. */
  getFrame(index: number, signal?: AbortSignal): Promise<Frame> {
    const job = async () => {
      if (signal?.aborted) throw Error("Frame request cancelled");
      await this.ensure(index, signal);
      await this.unchanged();
      if (signal?.aborted) throw Error("Frame request cancelled");
      const cached = this.cache.get(index);
      if (cached) {
        this.cache.delete(index);
        this.cache.set(index, cached);
        return cached.frame;
      }
      const e = this.entries[index],
        bytes = new Uint8Array(e.end - e.offset);
      let n = 0;
      while (n < bytes.length) {
        const r = await this.handle!.read(
          bytes,
          n,
          bytes.length - n,
          e.offset + n,
        );
        if (!r.bytesRead) throw Error("Truncated frame read");
        n += r.bytesRead;
      }
      await this.unchanged();
      if (signal?.aborted || this.closed)
        throw Error("Frame request cancelled");
      const d = await this.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        this.file,
      );
      await this.unchanged();
      if (signal?.aborted || this.closed)
        throw Error("Frame request cancelled");
      const frame = d.frames[0];
      if (
        d.frames.length !== 1 ||
        frame.atoms.length !== e.atoms ||
        frame.timestep !== e.timestep
      )
        throw Error("Frame index does not match source");
      const ids = new Set(frame.atoms.map((a) => a.id));
      if (!this.firstIDs) this.firstIDs = ids;
      else if (
        ids.size !== this.firstIDs.size ||
        [...ids].some((id) => !this.firstIDs!.has(id))
      )
        frame.warnings.push(
          "Atom ID set differs from initial frame; no cross-frame atom correspondence",
        );
      const cost =
        estimatedFrameBytes.get(frame) ??
        new TextEncoder().encode(JSON.stringify(frame)).length * 4 +
          frame.atoms.length * 256;
      if (cost > STREAM_LIMITS.cache)
        throw Error("Parsed frame exceeds 16 MiB per-view cache budget");
      while (
        this.cache.size &&
        (this.cacheBytes + cost > STREAM_LIMITS.cache ||
          this.cache.size >= STREAM_LIMITS.cachedFrames)
      ) {
        const key = this.cache.keys().next().value!;
        this.cacheBytes -= this.cache.get(key)!.bytes;
        this.cache.delete(key);
      }
      this.cache.set(index, { frame, bytes: cost });
      this.cacheBytes += cost;
      return frame;
    };
    const result = this.queue.then(job);
    this.queue = result.catch(() => {});
    return result;
  }
  async waitForIndex() {
    await this.scanning;
    if (this.error) throw this.error;
  }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.closed = true;
    this.unbindAbort?.();
    this.unbindAbort = undefined;
    this.wake();
    this.disposing = (async () => {
      try {
        await this.scanning;
        await this.queue;
      } finally {
        await this.handle?.close();
        this.handle = undefined;
        this.cache.clear();
        this.cacheBytes = 0;
        this.firstIDs = undefined;
      }
    })();
    return this.disposing;
  }
}
