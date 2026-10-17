import { timersFor } from "./timers.ts";
import type { TimerHost, TimerHandle } from "./timers.ts";
import type { Dataset, Format } from "./model.ts";
import { estimatedFrameBytes } from "./model.ts";
declare const ATOMVIEW_WORKER: string;
/** Persistent local parser worker; cancellation terminates CPU work and revokes its asset. */
export class ParserClient {
  constructor(private readonly timers: TimerHost = timersFor()) {}
  private worker?: Worker;
  private disposed = false;
  private url?: string;
  private reject?: (e: Error) => void;
  private timeout?: TimerHandle;
  parse(
    text: string,
    source: string,
    format?: Format,
    style?: string,
  ): Promise<Dataset> {
    if (this.disposed) return Promise.reject(Error("Parser disposed"));
    if (this.reject) this.cancel();
    return new Promise((resolve, reject) => {
      this.reject = reject;
      try {
        if (!this.worker) {
          this.url = URL.createObjectURL(
            new Blob([ATOMVIEW_WORKER], { type: "text/javascript" }),
          );
          this.worker = new Worker(this.url);
        }
        const w = this.worker;
        this.timeout = this.timers.setTimeout(
          () => this.cancel("Parsing exceeded 30 second limit"),
          30000,
        );
        w.onmessage = (
          e: MessageEvent<{
            error?: string;
            dataset?: Dataset;
            positions?: ArrayBuffer;
            costs?: number[];
          }>,
        ) => {
          if (this.worker !== w || this.reject !== reject) return;
          try {
            const data = e.data;
            if (data.error) {
              this.timers.clearTimeout(this.timeout);
              this.timeout = undefined;
              this.reject = undefined;
              reject(Error(data.error));
              return;
            }
            const d = data.dataset;
            if (
              !d ||
              !Array.isArray(d.frames) ||
              !(data.positions instanceof ArrayBuffer)
            )
              throw Error("Malformed parser response");
            const p = new Float64Array(data.positions);
            if (
              p.length !== d.frames.reduce((n, f) => n + f.atoms.length * 3, 0)
            )
              throw Error("Parser coordinate buffer length mismatch");
            let k = 0;
            for (const f of d.frames)
              for (const a of f.atoms) a.position = [p[k++], p[k++], p[k++]];
            if (data.costs)
              d.frames.forEach((f, i) =>
                estimatedFrameBytes.set(f, data.costs![i]),
              );
            this.timers.clearTimeout(this.timeout);
            this.timeout = undefined;
            this.reject = undefined;
            resolve(d);
          } catch (error) {
            this.cancel(error instanceof Error ? error.message : String(error));
          }
        };
        w.onerror = (e) => {
          if (this.worker === w && this.reject === reject)
            this.cancel(e.message || "Parser worker failed");
        };
        const bytes = new TextEncoder().encode(text);
        w.postMessage({ bytes: bytes.buffer, source, format, style }, [
          bytes.buffer,
        ]);
      } catch (e) {
        this.cancel();
        reject(e instanceof Error ? e : Error(String(e)));
      }
    });
  }
  cancel(message = "Parsing cancelled") {
    const reject = this.reject;
    this.reject = undefined;
    if (this.timeout) this.timers.clearTimeout(this.timeout);
    this.timeout = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = undefined;
    reject?.(Error(message));
  }
  dispose() {
    this.disposed = true;
    this.cancel();
  }
}
