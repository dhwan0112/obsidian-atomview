import { test } from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "../src/molstar-scheduler.ts";

test("desktop Mol* scheduler yields, forwards arguments and cancels tasks", async () => {
  const events: string[] = [];
  Scheduler.setImmediate(
    (name: string, n: number) => events.push(name + n),
    "task",
    2,
  );
  const cancelled = Scheduler.setImmediate(() => events.push("cancelled"));
  Scheduler.clearImmediate(cancelled);
  assert.deepEqual(events, []);
  await Scheduler.immediatePromise();
  assert.deepEqual(events, ["task2"]);
  assert.equal(await Scheduler.delay(1, 42), 42);
});

import { timersFor } from "../src/timers.ts";
import { TrajectoryController } from "../src/controller.ts";
import type { Dataset } from "../src/model.ts";

test("playback schedules and cancels on its owning window", () => {
  let callback: (() => void) | undefined;
  let cancelled = 0;
  const owner = {
    setInterval(fn: () => void) {
      assert.equal(this, owner);
      callback = fn;
      return 73;
    },
    clearInterval(id: number) {
      assert.equal(this, owner);
      assert.equal(id, 73);
      cancelled++;
    },
  };
  const data: Dataset = {
    format: "xyz",
    units: "unknown",
    warnings: [],
    frames: [0, 1].map(() => ({
      atoms: [],
      coordinateSet: "test",
      warnings: [],
      metadata: {},
    })),
  };
  const seen: number[] = [];
  const c = new TrajectoryController(
    data,
    (_frame, index) => {
      seen.push(index);
    },
    timersFor(owner as unknown as Window),
  );
  c.play();
  assert.deepEqual(seen, []);
  callback!();
  assert.deepEqual(seen, [1]);
  c.dispose();
  assert.equal(cancelled, 1);
  c.play();
  assert.equal(c.playing, false);
});
