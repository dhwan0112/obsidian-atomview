import type { Dataset, Frame } from "./model.ts";
export class TrajectoryController {
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  index = 0;
  fps = 5;
  readonly dataset: Dataset;
  private change: (frame: Frame, index: number) => void | Promise<void>;
  constructor(
    dataset: Dataset,
    change: (frame: Frame, index: number) => void | Promise<void>,
  ) {
    this.dataset = dataset;
    this.change = change;
  }
  get playing(): boolean {
    return this.timer !== undefined;
  }
  setFrame(index: number) {
    if (this.disposed) return;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.dataset.frames.length
    )
      throw Error("Frame out of range (0-based)");
    this.index = index;
    return this.change(this.dataset.frames[index], index);
  }
  step(delta: number) {
    return this.setFrame(
      (this.index + delta + this.dataset.frames.length) %
        this.dataset.frames.length,
    );
  }
  play() {
    if (this.disposed || this.timer || this.dataset.frames.length < 2) return;
    this.timer = setInterval(() => {
      void this.step(1);
    }, 1000 / this.fps);
  }
  pause() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
  speed(fps: number) {
    if (!Number.isFinite(fps) || fps < 0.2 || fps > 30)
      throw Error("FPS must be 0.2–30");
    const was = this.playing;
    this.pause();
    this.fps = fps;
    if (was) this.play();
  }
  dispose() {
    this.pause();
    this.disposed = true;
  }
}
/** New requests invalidate earlier results; closing the view invalidates all results. */
export class RequestGate {
  private sequence = 0;
  private disposed = false;
  next(): number {
    if (this.disposed) throw Error("Disposed request gate");
    return ++this.sequence;
  }
  current(ticket: number): boolean {
    return !this.disposed && ticket === this.sequence;
  }
  cancel() {
    ++this.sequence;
  }
  dispose() {
    this.cancel();
    this.disposed = true;
  }
}
export interface ScalarChoice {
  property: string;
  component?: number | "magnitude";
}
export function scalar(frame: Frame, choice: ScalarChoice): number[] {
  return frame.atoms.map((a) => {
    const v = a.properties[choice.property];
    if (v === undefined)
      throw Error(`Missing property ${choice.property} on atom ${a.id}`);
    if (Array.isArray(v)) {
      if (!v.every((x) => typeof x === "number" && Number.isFinite(x)))
        throw Error(`Property ${choice.property} is not a numeric vector`);
      const vector = v as number[];
      if (choice.component === undefined)
        throw Error(
          "Vector coloring requires an explicit component or magnitude",
        );
      if (choice.component === "magnitude") return Math.hypot(...vector);
      if (
        !Number.isInteger(choice.component) ||
        choice.component < 0 ||
        choice.component >= vector.length
      )
        throw Error("Vector component out of range");
      return vector[choice.component];
    }
    if (choice.component !== undefined)
      throw Error("Component specified for scalar property");
    if (typeof v !== "number" || !Number.isFinite(v))
      throw Error(`Property ${choice.property} is not numeric`);
    return v;
  });
}
export function range(values: number[]): [number, number] {
  if (!values.length) throw Error("Empty scalar range");
  let min = Infinity,
    max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) throw Error("Non-finite property");
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return [min, max];
}

/** Async controller: one publication at a time, latest seek wins, playback waits for render completion. */
export class LazyTrajectoryController {
  index = 0;
  fps = 5;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private disposed = false;
  private request?: AbortController;
  private sequence = 0;
  private playbackEpoch = 0;
  constructor(
    private count: () => number,
    private getFrame: (index: number, signal: AbortSignal) => Promise<Frame>,
    private change: (frame: Frame, index: number) => void | Promise<void>,
    private fail: (e: unknown) => void,
  ) {}
  get playing() {
    return this.running;
  }
  async setFrame(index: number) {
    if (this.disposed) return;
    if (!Number.isInteger(index) || index < 0 || index >= this.count())
      throw Error("Frame out of indexed range (0-based)");
    this.request?.abort();
    const abort = (this.request = new AbortController()),
      sequence = ++this.sequence;
    try {
      const frame = await this.getFrame(index, abort.signal);
      if (this.disposed || abort.signal.aborted || sequence !== this.sequence)
        return;
      this.index = index;
      await this.change(frame, index);
    } catch (e) {
      if (!abort.signal.aborted && !this.disposed) {
        this.pause();
        this.fail(e);
      }
    }
  }
  step(delta: number) {
    return this.setFrame((this.index + delta + this.count()) % this.count());
  }
  play() {
    if (this.disposed || this.running || this.count() < 2) return;
    this.running = true;
    const epoch = ++this.playbackEpoch;
    const tick = async () => {
      if (!this.running || this.disposed || epoch !== this.playbackEpoch)
        return;
      const start = Date.now();
      await this.step(1);
      if (this.running && !this.disposed && epoch === this.playbackEpoch)
        this.timer = setTimeout(
          () => {
            void tick();
          },
          Math.max(0, 1000 / this.fps - (Date.now() - start)),
        );
    };
    this.timer = setTimeout(() => {
      void tick();
    }, 1000 / this.fps);
  }
  pause() {
    this.running = false;
    ++this.playbackEpoch;
    this.request?.abort();
    ++this.sequence;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  speed(fps: number) {
    if (!Number.isFinite(fps) || fps < 0.2 || fps > 30)
      throw Error("FPS must be 0.2–30");
    this.fps = fps;
  }
  dispose() {
    this.disposed = true;
    this.pause();
    this.request?.abort();
    ++this.sequence;
  }
}
