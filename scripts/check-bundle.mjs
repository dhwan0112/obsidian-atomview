import fs from "node:fs/promises";
import vm from "node:vm";
import assert from "node:assert/strict";
import path from "node:path";
const host = await import("node:fs/promises");
class Component {}
const obsidian = {
  Plugin: Component,
  FileView: Component,
  MarkdownRenderChild: Component,
  PluginSettingTab: Component,
  Modal: Component,
};
const requested = [];
const sandbox = {
  module: { exports: {} },
  exports: {},
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  TextEncoder,
  TextDecoder,
  URL,
  Blob,
  performance,
  btoa,
  atob,
  Buffer,
  process: { env: { NODE_ENV: "production" } },
  require(name) {
    requested.push(name);
    if (name === "obsidian") return obsidian;
    if (name === "node:fs/promises") return host;
    if (name === "node:path") return path;
    throw Error("Unexpected runtime dependency " + name);
  },
};
sandbox.exports = sandbox.module.exports;
try {
  vm.runInNewContext(await fs.readFile("dist/main.js", "utf8"), sandbox, {
    filename: "deployed-main.js",
    timeout: 10000,
  });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
assert.equal(typeof sandbox.module.exports.default, "function");
console.log(
  JSON.stringify(
    {
      status: "PASS",
      runtimeRequires: [...new Set(requested)],
      nodeModulesRequired: false,
      limitations:
        "Module evaluation with mocked Obsidian; not actual plugin load",
    },
    null,
    2,
  ),
);
