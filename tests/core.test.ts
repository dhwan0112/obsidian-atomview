import { test } from "node:test";
import assert from "node:assert/strict";
import { cart, validate } from "../src/model.ts";
import type { Cell } from "../src/model.ts";
import { dump, data } from "../src/readers/lammps.ts";
import { xyz } from "../src/readers/xyz.ts";
import { config, sourcePath, serialize } from "../src/config.ts";
import {
  RequestGate,
  TrajectoryController,
  scalar,
  range,
} from "../src/controller.ts";
const cell: Cell = {
  origin: [-2, 1, 3],
  vectors: [
    [10, 0, 0],
    [2, 8, 0],
    [-1, 1, 6],
  ],
  pbc: [true, true, true],
};
const fixture = (
  columns = "id type xs ys zs q ix iy iz",
  rows = ["9007199254740993 1 .25 .5 .75 -.4 1 -1 0", "2 2 0 0 0 .2 0 0 0"],
) =>
  `ITEM: TIMESTEP\n12345678901234567890\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS xy xz yz pp pp ff\n-3 10 2\n1 10 -1\n3 9 1\nITEM: ATOMS ${columns}\n${rows.join("\n")}\n`;
test("independent Float64 triclinic expected coordinate and dump bounding bounds", () => {
  assert.deepEqual(cart(cell, [0.25, 0.5, 0.75]), [0.75, 5.75, 7.5]);
  const d = validate(dump(fixture()));
  assert.deepEqual(d.frames[0].cell?.origin, [-2, 1, 3]);
  assert.deepEqual(d.frames[0].cell?.vectors, cell.vectors);
  assert.deepEqual(d.frames[0].atoms[0].position, [0.75, 5.75, 7.5]);
  assert.equal(d.frames[0].atoms[0].id, "9007199254740993");
  assert.equal(d.frames[0].timestep, "12345678901234567890");
  assert.deepEqual(d.frames[0].cell?.pbc, [true, true, false]);
  assert.equal(d.frames[0].atoms[0].properties.ix, 1);
});
test("shuffled rows and reordered columns keep IDs and data", () => {
  const d = validate(
    dump(
      fixture() +
        fixture("q zs type id ys xs", [
          ".2 0 2 2 0 0",
          "-.4 .75 1 9007199254740993 .5 .25",
        ]),
    ),
  );
  assert.equal(d.frames[1].atoms[1].id, d.frames[0].atoms[0].id);
  assert.deepEqual(d.frames[1].atoms[1].position, [0.75, 5.75, 7.5]);
  assert.deepEqual(d.frames[1].warnings, []);
});
for (const set of ["x y z", "xu yu zu", "xs ys zs", "xsu ysu zsu"])
  test(`coordinate set ${set}`, () => {
    const d = dump(
      fixture(`id type ${set} ix iy iz`, [
        "1 1 .25 .5 .75 10 10 10",
        "2 2 0 0 0 0 0 0",
      ]),
    );
    assert.deepEqual(
      d.frames[0].atoms[0].position,
      set.startsWith("xs") ? [0.75, 5.75, 7.5] : [0.25, 0.5, 0.75],
    );
  });
test("orthogonal nonzero origin", () => {
  const s = fixture()
    .replace("xy xz yz pp pp ff", "pp pp pp")
    .replace("-3 10 2\n1 10 -1\n3 9 1", "-2 8\n1 9\n3 9");
  assert.deepEqual(dump(s).frames[0].atoms[0].position, [0.5, 5, 7.5]);
});
test("coordinate priority favors unwrapped and preserves raw sets", () => {
  const d = dump(
    fixture("id x y z xu yu zu", ["1 0 0 0 12 14 16", "2 0 0 0 1 2 3"]),
  );
  assert.deepEqual(d.frames[0].atoms[0].position, [12, 14, 16]);
  assert.equal(d.frames[0].atoms[0].properties.x, 0);
  assert.match(d.frames[0].warnings[0], /Multiple/);
});
test("dump rejects duplicate IDs, truncated, NaN, Infinity, malformed cell, general triclinic", () => {
  for (const s of [
    fixture().replace("2 2 0", "9007199254740993 2 0"),
    fixture().trim().split("\n").slice(0, -1).join("\n"),
    fixture().replace(".25", "NaN"),
    fixture().replace(".25", "Infinity"),
    fixture().replace("-3 10 2", "10 -3 2"),
    fixture().replace("xy xz yz", "abc origin"),
  ])
    assert.throws(() => validate(dump(s)));
});
test("missing IDs and changed ID sets explicit", () => {
  assert.match(
    dump(fixture("type x y z", ["1 0 0 0", "2 1 1 1"])).frames[0].warnings[0],
    /No IDs/,
  );
  assert.match(
    validate(dump(fixture() + fixture().replace("2 2 0", "3 2 0"))).frames[1]
      .warnings[0],
    /ID set changed/,
  );
});
const df = (style: string, row: string) =>
  `Synthetic AtomView\n1 atoms\n1 atom types\n-2 8 xlo xhi\n1 9 ylo yhi\n3 9 zlo zhi\n2 -1 1 xy xz yz\n\nMasses\n\n1 55.845\n\nAtoms # ${style}\n\n${row}\n`;
for (const [style, row] of [
  ["atomic", "1 1 .75 5.75 7.5"],
  ["charge", "1 1 -.4 .75 5.75 7.5"],
  ["full", "1 9 1 -.4 .75 5.75 7.5 1 -1 0"],
])
  test(`data style ${style}`, () => {
    const d = validate(data(df(style, row)));
    assert.deepEqual(d.frames[0].cell?.origin, [-2, 1, 3]);
    assert.deepEqual(d.frames[0].cell?.vectors, cell.vectors);
    assert.deepEqual(d.frames[0].cell?.pbc, [null, null, null]);
    assert.deepEqual(d.frames[0].atoms[0].position, [0.75, 5.75, 7.5]);
    assert.equal(d.frames[0].atoms[0].element, undefined);
    if (style !== "atomic")
      assert.equal(d.frames[0].atoms[0].properties.q, -0.4);
    if (style === "full")
      assert.equal(d.frames[0].atoms[0].properties.moleculeId, "9");
  });
test("data ambiguous/unsupported style and mismatch rejected", () => {
  for (const s of [
    df("", "1 1 0 0 0"),
    df("molecular", "1 1 1 0 0 0"),
    df("atomic", "1 1 NaN 0 0"),
    df("atomic", "1 1 0 0 0").replace("1 atoms", "2 atoms"),
  ])
    assert.throws(() => validate(data(s)));
  assert.throws(() => data(df("full", "1 1 1 0 0 0 0"), "atomic"));
});
const ex =
  '2\nLattice="10 0 0 2 8 0 -1 1 6" Properties=species:S:1:pos:R:3:q:R:1:force:R:3:id:I:1 pbc="T T F"\nFe .75 5.75 7.5 -.4 1 2 3 9007199254740993\nO 0 0 0 .2 3 4 5 2\n';
test("extended XYZ declared vectors, ID precision and cell order", () => {
  const d = validate(xyz(ex));
  assert.deepEqual(d.frames[0].cell?.vectors, cell.vectors);
  assert.deepEqual(d.frames[0].atoms[0].properties.force, [1, 2, 3]);
  assert.equal(d.frames[0].atoms[0].id, "9007199254740993");
  assert.deepEqual(d.frames[0].cell?.pbc, [true, true, false]);
});
test("XYZ multi-frame without cell has explicit tracking warning", () => {
  const d = validate(xyz("1\nframe one\nFe 1 2 3\n1\nframe two\nFe 4 5 6\n"));
  assert.equal(d.frames.length, 2);
  assert.equal(d.frames[0].cell, undefined);
  assert.match(d.frames[0].warnings[0], /No IDs/);
});
test("invalid XYZ is rejected, never downgraded", () => {
  for (const s of [
    "2\nx\nFe 0 0 0",
    "1\nx\nFe Infinity 0 0",
    ex.replace("pos:R:3", "pos:R:2"),
    ex.replace("Properties=", "Bad="),
    ex.replace("T T F", "banana"),
  ])
    assert.throws(() => validate(xyz(s)));
});
test("missing property, vector explicit component and scalar ranges", () => {
  const f = xyz(ex).frames[0];
  assert.deepEqual(scalar(f, { property: "q" }), [-0.4, 0.2]);
  assert.throws(() => scalar(f, { property: "missing" }));
  assert.throws(() => scalar(f, { property: "force" }));
  assert.deepEqual(scalar(f, { property: "force", component: 0 }), [1, 3]);
  assert.ok(
    Math.abs(
      scalar(f, { property: "force", component: "magnitude" })[0] -
        3.7416573867739413,
    ) < 1e-12,
  );
  assert.deepEqual(range([-0.4, 0.2]), [-0.4, 0.2]);
});
test("config validation, traversal and serialization restore", () => {
  const c = config({
    source: "_atomview-tests/fixtures/fe-o-q.lammpstrj",
    elementMap: { 1: "Fe", 2: "O" },
    colorBy: "q",
    colorRange: [-1, 1],
    selectedId: "9007199254740993",
  });
  assert.deepEqual(
    config(JSON.parse(serialize(c).split("\n").slice(1, -1).join("\n"))),
    c,
  );
  for (const path of ["../x", "/x", "x/../y", "a\\b", "file:x", "x//y"])
    assert.throws(() => sourcePath(path));
  for (const raw of [
    null,
    {},
    { source: "x", frame: -1 },
    { source: "x", frame: 1.5 },
    { source: "x", elementMap: { 1: "X" } },
    { source: "x", colorRange: [1, -1] },
    { source: "x", bad: true },
  ])
    assert.throws(() => config(raw));
});
test("async stale results and disposal", () => {
  const g = new RequestGate();
  const old = g.next(),
    current = g.next();
  assert.equal(g.current(old), false);
  assert.equal(g.current(current), true);
  g.cancel();
  assert.equal(g.current(current), false);
  g.dispose();
  assert.throws(() => g.next());
});
test("trajectory bounds, speed and cleanup", async () => {
  let count = 0;
  const c = new TrajectoryController(
    xyz("1\na\nFe 0 0 0\n1\nb\nFe 1 1 1"),
    () => count++,
  );
  c.step(1);
  assert.equal(c.index, 1);
  assert.throws(() => c.setFrame(2));
  assert.throws(() => c.speed(0));
  c.speed(30);
  c.play();
  assert.equal(c.playing, true);
  c.dispose();
  assert.equal(c.playing, false);
  const before = count;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(count, before);
  c.setFrame(0);
  assert.equal(count, before);
});

test("degenerate cell and molecule ID zero", () => {
  assert.throws(
    () => validate(xyz(ex.replace("10 0 0 2 8 0 -1 1 6", "0 0 0 0 0 0 0 0 0"))),
    /Degenerate/,
  );
  assert.equal(
    validate(data(df("full", "1 0 1 -.4 .75 5.75 7.5"))).frames[0].atoms[0]
      .properties.moleculeId,
    "0",
  );
});

test("extended XYZ zero-based IDs and string vector metadata retained", () => {
  const d = validate(
    xyz(
      "1\nProperties=species:S:1:pos:R:3:id:I:1:tags:S:2\nFe 0 0 0 0 alpha beta",
    ),
  );
  assert.equal(d.frames[0].atoms[0].id, "0");
  assert.deepEqual(d.frames[0].atoms[0].properties.tags, ["alpha", "beta"]);
  assert.throws(
    () => scalar(d.frames[0], { property: "tags", component: 0 }),
    /not a numeric vector/,
  );
});
