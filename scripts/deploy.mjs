// AtomView-owned outputs only; never alter community-plugins.json or workspace.
import fs from "node:fs/promises";
import { deployDemo } from "./demo.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = process.argv.slice(2);
const pluginOnly = args[2] === "--plugin-only";
if (
  (args.length !== 2 && !(args.length === 3 && pluginOnly)) ||
  args[0] !== "--vault"
)
  throw Error("Usage: npm run deploy:dev -- --vault EXISTING_VAULT");
const vault = await fs.realpath(args[1]);
if (!(await fs.stat(vault)).isDirectory()) throw Error("Not a directory");
// Until an integration can positively determine app.vault.configDir, require the default directory.
const config = path.join(vault, ".obsidian");
if (!(await fs.stat(config)).isDirectory())
  throw Error(
    "Existing .obsidian directory required; custom config directory not yet supported by this script",
  );
const under = (root, target) => {
  const rel = path.relative(root, target);
  return (
    rel !== "" &&
    !path.isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${path.sep}`)
  );
};
if (!under(vault, await fs.realpath(config)))
  throw Error("Config directory escapes vault");
const files = [
  "main.js",
  "manifest.json",
  "styles.css",
  "THIRD_PARTY_LICENSES.txt",
];
// Fail before any writes if the build or receipt is absent/stale.
const receipt = JSON.parse(
  await fs.readFile(path.join(project, "dist", "validation.json"), "utf8"),
);
if (
  receipt.typecheck !== true ||
  receipt.tests !== true ||
  receipt.build !== true
)
  throw Error("Build has no successful validation receipt");
const crypto = await import("node:crypto");
for (const name of files) {
  const bytes = await fs.readFile(path.join(project, "dist", name));
  if (
    crypto.createHash("sha256").update(bytes).digest("hex") !==
    receipt.sha256?.[name]
  )
    throw Error(`Stale or invalid validated artifact ${name}`);
}
const manifest = JSON.parse(
  await fs.readFile(path.join(project, "dist", "manifest.json"), "utf8"),
);
if (manifest.id !== "atomview") throw Error("Wrong plugin ID");
const plugins = path.join(config, "plugins");
try {
  if (!under(config, await fs.realpath(plugins)))
    throw Error("Plugins symlink escapes config");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const dest = path.join(plugins, "atomview");
const marker = ".atomview-owned.json";
let existing = false;
try {
  await fs.lstat(dest);
  existing = true;
  if ((await fs.lstat(dest)).isSymbolicLink())
    throw Error("Plugin target is a symlink; explicit review required");
  if (!under(plugins, await fs.realpath(dest)))
    throw Error("Target escapes plugins");
  if ((await fs.lstat(path.join(dest, marker))).isSymbolicLink())
    throw Error("Ownership marker must not be a symlink");
  const ownership = JSON.parse(
    await fs.readFile(path.join(dest, marker), "utf8"),
  );
  if (ownership.project !== "obsidian-atomview")
    throw Error("Target belongs to another project");
} catch (e) {
  if (e.code !== "ENOENT" || existing) throw e;
}
for (const name of [...files, marker, "data.json", ".backups"]) {
  try {
    if ((await fs.lstat(path.join(dest, name))).isSymbolicLink())
      throw Error(`Refusing installed symlink ${name}`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
try {
  if ((await fs.lstat(path.join(vault, "_atomview-tests"))).isSymbolicLink())
    throw Error("_atomview-tests is a symlink; explicit review required");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (existing) {
  const backup = path.join(dest, ".backups", String(Date.now()));
  await fs.mkdir(backup, { recursive: true });
  for (const name of [...files, marker, "data.json"]) {
    try {
      await fs.copyFile(path.join(dest, name), path.join(backup, name));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  console.log(`Backup: ${backup}`);
}
await fs.mkdir(dest, { recursive: true });
for (const name of files) {
  const out = path.join(dest, name);
  try {
    if ((await fs.lstat(out)).isSymbolicLink())
      throw Error(`Refusing artifact symlink ${name}`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await fs.copyFile(path.join(project, "dist", name), out);
}
await fs.writeFile(
  path.join(dest, marker),
  JSON.stringify(
    {
      project: "obsidian-atomview",
      files,
      installedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  `Installed ${dest}. Preserved data.json; activate with Obsidian UI.`,
);

const demo = pluginOnly ? {} : await deployDemo(project, vault);
if (!pluginOnly) {
  console.log(`Demo: ${demo.note}`);
  console.log(`Generated inventory: ${demo.inventory}`);
}
await fs.writeFile(
  path.join(
    project,
    "test-artifacts",
    pluginOnly ? "deployment-update.json" : "deployment.json",
  ),
  JSON.stringify({ vault, install: dest, ...demo }, null, 2),
);
