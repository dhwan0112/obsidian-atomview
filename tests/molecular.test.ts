import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pdb, cif } from "../src/readers/molecular.ts";
import { parseConfig } from "../src/yaml-config.ts";
const fixture = (f: string) =>
  readFile(new URL("../fixtures/" + f, import.meta.url), "utf8");
test("PDB validated tokenizer, model selection and metadata", async () => {
  const d = await pdb(await fixture("models.pdb"));
  assert.equal(d.frames.length, 2);
  assert.deepEqual(d.frames[0].atoms[0].position, [0, 0, 0]);
  assert.deepEqual(d.frames[1].atoms[0].position, [1, 0, 0]);
  assert.equal(d.frames[0].metadata.model, "1");
  assert.equal(d.frames[0].atoms[0].element, "O");
  assert.equal(d.frames[0].atoms[0].properties.chain, "A");
  assert.equal(d.frames[0].atoms[0].properties.residue, "HOH");
});
test("PDB empty/truncated/nonfinite records rejected", async () => {
  const text = await fixture("models.pdb");
  for (const s of [
    "garbage",
    text.replace(/ENDMDL/g, ""),
    "ATOM      1",
    text.replace("   0.000", "     NaN"),
  ])
    await assert.rejects(() => pdb(s));
});
test("coreCIF Float64 fractional conversion independent expected and cell", async () => {
  const d = await cif(await fixture("fractional.cif"));
  const a = d.frames[0].atoms[0];
  assert.equal(a.id, "Fe1");
  assert.equal(a.element, "Fe");
  for (const [i, v] of [2.5, 4, 4.5].entries())
    assert.ok(Math.abs(a.position[i] - v) < 1e-12);
  const m = d.frames[0].cell!.vectors;
  assert.ok(Math.abs(m[1][1] - 8) < 1e-12);
  assert.deepEqual(a.properties.fractional, [0.25, 0.5, 0.75]);
  assert.equal(a.properties.occupancy, 1);
  assert.match(d.warnings[0], /Asymmetric unit/);
});
const mm = `data_demo\nloop_\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.label_atom_id\n_atom_site.label_asym_id\n_atom_site.pdbx_PDB_model_num\n9007199254740993 Fe 1.1234567890123 2 3 Fe1 A 1\n9007199254740993 Fe 4 5 6 Fe1 A 2\n`;
test("mmCIF distinguishes Cartesian and retains precision-safe ID; first model only", async () => {
  const d = await cif(mm);
  assert.equal(d.frames[0].metadata.kind, "mmCIF");
  assert.equal(d.frames[0].atoms.length, 1);
  assert.equal(d.frames[0].atoms[0].id, "9007199254740993");
  assert.equal(d.frames[0].atoms[0].position[0], 1.1234567890123);
  assert.match(d.warnings[1], /first deposited model only/);
});
test("CIF missing/invalid coordinates, malformed loop and duplicate ID rejected", async () => {
  for (const s of [
    "data_x\n_bad 1",
    mm.replace("1.1234567890123", "NaN"),
    mm.replace("4 5 6 Fe1 A 2", "4 5 6 Fe1 A 1"),
    mm + "broken_loop_value",
  ])
    await assert.rejects(() => cif(s));
});
test("YAML example, invalid YAML, duplicate keys and scalar config rejected", () => {
  const c = parseConfig(
    'source: "_atomview-tests/fixtures/fe-o-q.lammpstrj"\nformat: lammps-dump\nframe: 0\nrepresentation: spheres\ncolorBy: q\nshowCell: true\nelementMap:\n  1: Fe\n  2: O\nheight: 420',
  );
  assert.equal(c.elementMap["1"], "Fe");
  assert.equal(c.frame, 0);
  for (const s of [
    "source: [broken",
    "source: x\nsource: y",
    "a string",
    "source: ../escape.xyz",
    "source: x\nframe: 2.5",
  ])
    assert.throws(() => parseConfig(s));
});
