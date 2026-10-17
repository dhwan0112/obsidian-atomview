import { test } from "node:test";
import assert from "node:assert/strict";
import { ParserClient } from "../src/worker-client.ts";
import { LazyTrajectoryController } from "../src/controller.ts";
import type { Frame } from "../src/model.ts";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = {
  atoms: [],
  coordinateSet: "test",
  warnings: [],
  metadata: {},
} as Frame;

test("pause invalidates in-flight frame publication", async () => {
  let resolve!: (f: Frame) => void;
  const seen: number[] = [];
  const c = new LazyTrajectoryController(
    () => 3,
    () => new Promise((r) => (resolve = r)),
    (_f, i) => {
      seen.push(i);
    },
    (e) => {
      throw e;
    },
  );
  const pending = c.setFrame(1);
  c.pause();
  resolve(frame);
  await pending;
  assert.deepEqual(seen, []);
  assert.equal(c.index, 0);
  c.dispose();
});
test("pause/play during pending tick never creates an extra playback loop", async () => {
  const pending: ((f: Frame) => void)[] = [];
  const seen: number[] = [];
  const c = new LazyTrajectoryController(
    () => 3,
    () => new Promise((r) => pending.push(r)),
    (_f, i) => {
      seen.push(i);
    },
    (e) => {
      throw e;
    },
  );
  c.speed(30);
  c.play();
  await delay(60);
  assert.equal(pending.length, 1);
  c.pause();
  c.play();
  await delay(60);
  assert.equal(pending.length, 2);
  pending[0](frame);
  await delay(80);
  assert.equal(pending.length, 2);
  assert.deepEqual(seen, []);
  c.pause();
  pending[1](frame);
  await delay(0);
  assert.deepEqual(seen, []);
  c.dispose();
});

test("worker ignores queued events after cancellation, handles bad protocol and cannot resurrect after dispose", async () => {
  const oldWorker = globalThis.Worker;
  class FakeWorker {
    static workers: FakeWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    constructor(_url: string) {
      FakeWorker.workers.push(this);
    }
    terminate() {}
    postMessage() {}
  }
  Object.assign(globalThis, {
    Worker: FakeWorker,
    ATOMVIEW_WORKER: "// fake protocol transport only",
  });
  const p = new ParserClient();
  try {
    const first = p.parse("", "x");
    const rejected = assert.rejects(first, /cancelled/);
    const stale = FakeWorker.workers[0].onmessage!;
    p.cancel();
    await rejected;
    const second = p.parse("", "x");
    const current = FakeWorker.workers[1];
    stale({ data: { error: "stale failure" } });
    assert.ok(Reflect.get(p, "reject"));
    current.onmessage!({
      data: {
        dataset: { frames: [], format: "xyz", units: "unknown", warnings: [] },
        positions: new ArrayBuffer(0),
      },
    });
    assert.equal((await second).format, "xyz");
    const malformed = p.parse("", "x");
    const bad = assert.rejects(malformed, /coordinate buffer length mismatch/);
    current.onmessage!({
      data: {
        dataset: { frames: [frame] },
        positions: new Float64Array([1]).buffer,
      },
    });
    await bad;
    const inFlight = p.parse("", "x");
    const closed = assert.rejects(inFlight, /cancelled/);
    p.dispose();
    await closed;
    await assert.rejects(() => p.parse("", "x"), /disposed/);
  } finally {
    p.dispose();
    Object.assign(globalThis, { Worker: oldWorker });
    Reflect.deleteProperty(globalThis, "ATOMVIEW_WORKER");
  }
});
