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
