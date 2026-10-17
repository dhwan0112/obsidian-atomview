import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { localSource } from "../src/paths.ts";
import { readLocal } from "../src/readers/local.ts";
test("missing file, symlink escape, directory and valid local source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "atomview-path-test-"));
  try {
    const vault = path.join(root, "vault");
    await mkdir(vault);
    await writeFile(path.join(root, "outside.xyz"), "1\nx\nFe 0 0 0");
    await symlink(
      path.join(root, "outside.xyz"),
      path.join(vault, "escape.xyz"),
    );
    await writeFile(path.join(vault, "ok.xyz"), "1\nx\nFe 0 0 0");
    await assert.rejects(() => localSource(vault, "missing.xyz"));
    await assert.rejects(
      () => localSource(vault, "escape.xyz"),
      /outside vault/,
    );
    assert.equal(
      await localSource(vault, "ok.xyz"),
      path.join(vault, "ok.xyz"),
    );
    await mkdir(path.join(vault, "folder"));
    await assert.rejects(() => localSource(vault, "folder"), /regular file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("data content sniff and asynchronous reader dispatch contract", () => {
  assert.throws(
    () => readLocal("arbitrary text", "other.data"),
    /not recognized/,
  );
  assert.throws(() => readLocal("ATOM", "x.pdb"), /readStructure/);
  assert.throws(() => readLocal("data_test", "x.cif"), /readStructure/);
  assert.equal(
    readLocal("1\nx\nFe 0 0 0", "x.xyz").frames[0].atoms[0].element,
    "Fe",
  );
});
