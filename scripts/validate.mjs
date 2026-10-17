import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import crypto from "node:crypto";
await fs.mkdir("test-artifacts", { recursive: true });
const commands = [];
for (const name of ["typecheck", "test", "build"]) {
  const r = spawnSync("npm", ["run", name], { encoding: "utf8" });
  const log = (r.stdout ?? "") + (r.stderr ?? "");
  await fs.writeFile(`test-artifacts/${name}.log`, log);
  process.stdout.write(log);
  commands.push({ command: `npm run ${name}`, exitCode: r.status });
  if (r.status !== 0) throw Error(`${name} failed: ${r.status}`);
}
const sha256 = {};
for (const name of [
  "main.js",
  "manifest.json",
  "styles.css",
  "THIRD_PARTY_LICENSES.txt",
])
  sha256[name] = crypto
    .createHash("sha256")
    .update(await fs.readFile("dist/" + name))
    .digest("hex");
await fs.writeFile(
  "dist/validation.json",
  JSON.stringify(
    {
      typecheck: true,
      tests: true,
      build: true,
      time: new Date().toISOString(),
      sha256,
      commands,
    },
    null,
    2,
  ),
);
