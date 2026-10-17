import { build } from "esbuild";
import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
const worker = await build({
  entryPoints: ["src/parser-worker.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  write: false,
  minify: true,
  metafile: true,
  logLevel: "info",
});
await mkdir("dist", { recursive: true });
const main = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "fs", "node:fs/promises", "node:path"],
  format: "cjs",
  target: "es2022",
  platform: "browser",
  outfile: "dist/main.js",
  minify: true,
  sourcemap: false,
  metafile: true,
  define: { ATOMVIEW_WORKER: JSON.stringify(worker.outputFiles[0].text) },
  banner: {
    js: "/*! AtomView — MIT. Bundled dependency licenses: THIRD_PARTY_LICENSES.txt */",
  },
  logLevel: "info",
});
for (const name of ["manifest.json", "styles.css"])
  await copyFile(name, `dist/${name}`);
const roots = new Set();
for (const name of [
  ...Object.keys(worker.metafile.inputs),
  ...Object.keys(main.metafile.inputs),
]) {
  const m = name.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (m) roots.add(m[1]);
}
const licenses = [];
for (const root of [...roots].sort()) {
  const pkg = JSON.parse(await readFile(root + "/package.json", "utf8"));
  licenses.push(
    `\n===== ${pkg.name} ${pkg.version} (${pkg.license ?? "see package"}) =====\n`,
  );
  const files = (await readdir(root)).filter((f) =>
    /^licen[cs]e(?:\.|$)/i.test(f),
  );
  for (const f of files) licenses.push(await readFile(root + "/" + f, "utf8"));
  if (!files.length)
    licenses.push(
      "No standalone license file in package; see package metadata and source legal notices.\n",
    );
}
await writeFile("dist/THIRD_PARTY_LICENSES.txt", licenses.join("\n"));
