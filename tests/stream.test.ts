import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  rm,
  rename,
  symlink,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DumpFrameSource, STREAM_LIMITS } from "../src/stream-source.ts";
import { readLocal } from "../src/readers/local.ts";
import { LazyTrajectoryController } from "../src/controller.ts";
import { registerExternal, registeredSource } from "../src/paths.ts";
import { config, serialize } from "../src/config.ts";
const frame = (
  i: number,
  rows = "9007199254740993 1 .25 .5 .75 -.4\n2 2 0 0 0 .2",
) =>
  `ITEM: TIMESTEP\n${i * 100}\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS xy xz yz pp pp ff\n-3 10 2\n1 10 -1\n3 9 1\nITEM: ATOMS id type xs ys zs q\n${rows}\n`;
const parse = async (text: string, source: string) =>
  readLocal(text, source, "lammps-dump");
async function setup(
  text: string,
  fn: (file: string, dir: string) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atomview-stream-"));
  try {
    const file = path.join(dir, "test.lammpstrj");
    await writeFile(file, text);
    await fn(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("byte index across chunks, CRLF, Unicode and final line without newline; bounded LRU", async () => {
  const text = Array.from({ length: 2400 }, (_, i) => frame(i))
    .join("")
    .replaceAll(" 1 .25", " α .25")
    .replace(/\n/g, "\r\n")
    .trimEnd();
  await setup(text, async (file) => {
    const s = await DumpFrameSource.create(file, parse);
    try {
      await s.waitForIndex();
      assert.equal(s.entries.length, 2400);
      assert.equal(s.entries[2399].end, new TextEncoder().encode(text).length);
      for (const i of [0, 2399, 1123, 56, 999, 1]) {
        const f = await s.getFrame(i);
        assert.equal(f.timestep, String(i * 100));
        assert.equal(f.atoms[0].id, "9007199254740993");
        assert.deepEqual(f.cell?.origin, [-2, 1, 3]);
        assert.deepEqual(f.cell?.vectors, [
          [10, 0, 0],
          [2, 8, 0],
          [-1, 1, 6],
        ]);
        assert.deepEqual(f.atoms[0].position, [0.75, 5.75, 7.5]);
      }
      assert.ok(s.cacheBytes <= STREAM_LIMITS.cache);
      assert.equal(Reflect.get(s, "cache").size, 4);
    } finally {
      await s.dispose();
    }
    assert.equal(s.cacheBytes, 0);
    await assert.rejects(() => s.getFrame(0), /closed/);
  });
});
test("progress first-frame before entire index and cancellation closes scanner", async () => {
  await setup(
    Array.from({ length: 9000 }, (_, i) => frame(i)).join(""),
    async (file) => {
      let first = 0;
      const s = await DumpFrameSource.create(file, parse, (p) => {
        if (!first) first = p.bytes;
      });
      assert.ok(first > 0);
      assert.ok(!s.complete);
      await s.dispose();
      assert.ok(s.entries.length < 9000);
    },
  );
});
test("row reordering preserves IDs, changed set warned, properties retained", async () => {
  await setup(
    frame(0) +
      frame(1, "2 2 0 0 0 .3\n9007199254740993 1 .5 0 0 -.5") +
      frame(2, "3 2 0 0 0 .2\n4 1 0 0 0 -.4"),
    async (file) => {
      const s = await DumpFrameSource.create(file, parse);
      try {
        await s.waitForIndex();
        await s.getFrame(0);
        const f = await s.getFrame(1);
        assert.equal(f.atoms[1].id, "9007199254740993");
        assert.equal(f.atoms[1].properties.q, -0.5);
        assert.deepEqual(f.atoms[1].position, [3, 1, 3]);
        assert.match((await s.getFrame(2)).warnings.join(), /ID set differs/);
      } finally {
        await s.dispose();
      }
    },
  );
});
test("duplicate IDs and invalid values rejected on accessed frame", async () => {
  for (const rows of [
    "1 1 0 0 0 .2\n1 1 0 0 0 .3",
    "1 1 NaN 0 0 .2\n2 1 0 0 0 .3",
  ]) {
    await setup(frame(0, rows), async (file) => {
      const s = await DumpFrameSource.create(file, parse);
      try {
        await assert.rejects(() => s.getFrame(0), /Duplicate|Invalid/);
      } finally {
        await s.dispose();
      }
    });
  }
});
test("truncated tail and unsupported general triclinic index fail explicitly", async () => {
  for (const text of [
    frame(0) + frame(1).split("\n").slice(0, -2).join("\n"),
    frame(0).replace("xy xz yz", "abc origin"),
  ])
    await setup(text, async (file) => {
      let s: DumpFrameSource | undefined;
      await assert.rejects(async () => {
        s = await DumpFrameSource.create(file, parse);
        await s.waitForIndex();
      }, /Truncated|Unsupported/);
      await s?.dispose();
    });
});
test("source mutation/replacement and cancelled reads never return cached stale frames", async () => {
  await setup(frame(0), async (file, dir) => {
    const s = await DumpFrameSource.create(file, parse);
    try {
      await s.waitForIndex();
      await s.getFrame(0);
      const abort = new AbortController();
      abort.abort();
      await assert.rejects(() => s.getFrame(0, abort.signal), /cancelled/);
      await writeFile(path.join(dir, "new"), frame(1));
      await rename(path.join(dir, "new"), file);
      await assert.rejects(() => s.getFrame(0), /changed|replaced/);
    } finally {
      await s.dispose();
    }
  });
});
test("async controller latest request wins; disposed requests do not publish", async () => {
  const pending = new Map<number, (f: any) => void>(),
    seen: number[] = [];
  const c = new LazyTrajectoryController(
    () => 3,
    (i) => new Promise((r) => pending.set(i, r)),
    (_f, i) => {
      seen.push(i);
    },
    (e) => {
      throw e;
    },
  );
  const a = c.setFrame(1),
    b = c.setFrame(2);
  pending.get(2)!({});
  await b;
  pending.get(1)!({});
  await a;
  assert.deepEqual(seen, [2]);
  const d = c.setFrame(0);
  c.dispose();
  pending.get(0)!({});
  await d;
  assert.deepEqual(seen, [2]);
  assert.equal(c.playing, false);
});
test("external registration is one explicit file; symlink retarget and unregistered IDs blocked", async () => {
  await setup(frame(0), async (file, dir) => {
    const link = path.join(dir, "chosen.lammpstrj");
    await symlink(file, link);
    const entry = await registerExternal(link);
    assert.equal(await registeredSource(entry, STREAM_LIMITS.bytes), file);
    await assert.rejects(
      () => registeredSource(undefined, 1),
      /not registered/,
    );
    await assert.rejects(() => registerExternal("relative.xyz"), /absolute/);
    await unlink(link);
    await writeFile(path.join(dir, "other.lammpstrj"), frame(1));
    await symlink(path.join(dir, "other.lammpstrj"), link);
    await assert.rejects(
      () => registeredSource(entry, STREAM_LIMITS.bytes),
      /target changed/,
    );
    const c = config({
      source: "external:" + "a".repeat(24),
      frame: 1000,
      colorRange: [-1, 1],
    });
    assert.match(serialize(c), /external:/);
    assert.throws(() => config({ source: "external:../../file" }));
  });
});

test("aborting source creation stops indexing and concurrent dispose awaits the same cleanup", async () => {
  await setup(
    Array.from({ length: 9000 }, (_, i) => frame(i)).join(""),
    async (file) => {
      const abort = new AbortController();
      await assert.rejects(
        () =>
          DumpFrameSource.create(
            file,
            parse,
            () => abort.abort(),
            abort.signal,
          ),
        /closed|cancelled/,
      );
      const source = await DumpFrameSource.create(file, parse);
      const a = source.dispose(),
        b = source.dispose();
      assert.equal(a, b);
      await Promise.all([a, b]);
      assert.equal(Reflect.get(source, "handle"), undefined);
      assert.equal(source.cacheBytes, 0);
    },
  );
});
test("aborted seek waiting for an unindexed frame unblocks the serial queue", async () => {
  await setup(
    Array.from({ length: 9000 }, (_, i) => frame(i)).join(""),
    async (file) => {
      const s = await DumpFrameSource.create(file, parse);
      try {
        const abort = new AbortController();
        const old = s.getFrame(8999, abort.signal);
        const rejected = assert.rejects(old, /cancelled/);
        await new Promise((r) => setTimeout(r, 0));
        abort.abort();
        await rejected;
        await s.getFrame(0);
        assert.ok(!s.complete);
      } finally {
        await s.dispose();
      }
    },
  );
});
