import { build } from "esbuild";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
await fs.mkdir("test-artifacts", { recursive: true });
const fixtures = Object.fromEntries(
  await Promise.all(
    [
      "fe-o-q.lammpstrj",
      "iron.data",
      "water.xyz",
      "properties.xyz",
      "models.pdb",
      "fractional.cif",
      "truncated.xyz",
    ].map(async (f) => [f, await fs.readFile("fixtures/" + f, "utf8")]),
  ),
);
fixtures["varying-q.lammpstrj"] = [0, 1]
  .map(
    (i) =>
      `ITEM: TIMESTEP\n${i}\nITEM: NUMBER OF ATOMS\n1\nITEM: BOX BOUNDS pp pp pp\n0 4\n0 4\n0 4\nITEM: ATOMS id type x y z${i === 0 ? " q" : ""}\n1 1 ${i} 0 0${i === 0 ? " .2" : ""}\n`,
  )
  .join("");
const worker = await build({
  entryPoints: ["src/parser-worker.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
  minify: true,
});
await build({
  entryPoints: ["tests/browser-harness.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: "test-artifacts/harness.js",
  define: {
    ATOMVIEW_WORKER: JSON.stringify(worker.outputFiles[0].text),
    FIXTURES: JSON.stringify(fixtures),
  },
  plugins: [
    {
      name: "test-only-shims",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({
          path: path.resolve("tests/obsidian-shim.ts"),
        }));
        b.onResolve({ filter: /^node:fs\/promises$/ }, () => ({
          path: "fs",
          namespace: "test",
        }));
        b.onResolve({ filter: /paths\.ts$/ }, () => ({
          path: "paths",
          namespace: "test",
        }));
        b.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents:
            args.path === "fs"
              ? `const bytes=p=>new TextEncoder().encode(window.fixtures[p]);
export async function readFile(p){return window.fixtures[p];}
export async function stat(p){if(!Object.hasOwn(window.fixtures,p))throw Error('Missing local file '+p);return{size:bytes(p).length,dev:1,ino:1,mtimeMs:1,ctimeMs:1,isFile:()=>true};}
export async function realpath(p){return p;}
export async function open(p){let closed=false;window.atomviewOpenHandles++;return {stat:()=>stat(p),close:async()=>{if(!closed){closed=true;window.atomviewOpenHandles--;}},read:async(b,o,n,pos)=>{if(closed)throw Error("File handle already closed");const s=bytes(p).subarray(pos,pos+n);b.set(s,o);return{bytesRead:s.length}}};}`
              : `export async function localSource(_root,p){if(!Object.hasOwn(window.fixtures,p))throw Error('Missing local file '+p);return p;} export async function registeredSource(){throw Error("Not registered");} export async function registerExternal(){throw Error("Unavailable in mocked host");}`,
        }));
      },
    },
  ],
});
await fs.writeFile(
  "test-artifacts/harness.html",
  `<!DOCTYPE html><meta charset="utf-8"><title>AtomView synthetic automated harness</title><link rel="stylesheet" href="../styles.css"><body><script src="harness.js"></script></body>`,
);
const browser = await chromium.launch({
  headless: true,
  timeout: 20000,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await Promise.race([
  browser.newPage({ viewport: { width: 760, height: 2000 } }),
  new Promise((_, reject) =>
    setTimeout(() => reject(Error("newPage exceeded 20s")), 20000),
  ),
]);
const errors = [];
const network = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route(/^https?:/, (route) => {
  network.push(route.request().url());
  return route.abort();
});
try {
  await page.goto(
    pathToFileURL(path.resolve("test-artifacts/harness.html")).href,
  );
  const waitReady = () =>
    page.waitForFunction(
      () =>
        [...document.querySelectorAll(".atomview-status")].some((e) =>
          e.textContent.includes("Coordinates:"),
        ),
      { timeout: 20000 },
    );
  await page.evaluate(() => window.harness.mount("fe-o-q.lammpstrj", "q"));
  await waitReady();
  assert.match(
    await page.locator(".atomview-status").first().innerText(),
    /xs ys zs/,
  );
  assert.match(
    await page.locator(".atomview-legend").first().innerText(),
    /FIXED/,
  );
  assert.equal(await page.locator("canvas").count(), 1);
  await page.waitForTimeout(150);
  const pick = await page.evaluate(() => window.harness.screen(0));
  await page.mouse.click(pick.x, pick.y);
  await page.waitForFunction(() =>
    document
      .querySelector(".atomview-info")
      ?.textContent.includes("9007199254740993"),
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copied = text;
        },
      },
    }),
  );
  await page
    .getByRole("button", {
      name: "Copy current view as atomview block",
      exact: true,
    })
    .first()
    .click();
  const copied = await page.evaluate(() => window.__copied);
  const saved = JSON.parse(copied.split("\n").slice(1, -1).join("\n"));
  assert.equal(saved.selectedId, "9007199254740993");
  assert.ok(saved.camera);
  assert.deepEqual(saved.colorRange, [-0.4, 0.2]);
  const cameraBefore = await page.evaluate(() => window.harness.camera(0));
  // Spheres/cell must really produce a WebGL scene with non-background pixels (screenshot size is a secondary check).
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-artifacts/synthetic-view.png" });
  const canvasData = await page.locator("canvas").evaluate((canvas) => {
    const c = canvas;
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { width: 0, colors: 0 };
    gl.finish();
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const colors = new Set();
    for (let i = 0; i < px.length; i += 4)
      colors.add(px[i] + "," + px[i + 1] + "," + px[i + 2]);
    return { width: c.width, colors: colors.size };
  });
  assert.ok(canvasData.width > 0);
  assert.ok(canvasData.colors > 8, JSON.stringify(canvasData));
  await page
    .getByRole("button", { name: "Next ▶", exact: true })
    .first()
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".atomview-controls")
      ?.textContent.includes("Frame 1 / 2"),
  );
  assert.match(
    await page.locator(".atomview-controls").first().innerText(),
    /timestep 100/,
  );
  await page.waitForFunction(() => window.harness.pick(0) === 0);
  const cameraAfter = await page.evaluate(() => window.harness.camera(0));
  assert.deepEqual(cameraAfter.position, cameraBefore.position);
  assert.deepEqual(cameraAfter.target, cameraBefore.target);
  await page.getByRole("button", { name: "Play", exact: true }).first().click();
  await page.waitForTimeout(250);
  await page
    .getByRole("button", { name: "Pause", exact: true })
    .first()
    .click();
  await page.evaluate(
    (block) => window.harness.mountBlock(block),
    copied.split("\n").slice(1, -1).join("\n"),
  );
  await page.locator(".atomview-status").nth(1).waitFor();
  await page.waitForFunction(() =>
    document
      .querySelectorAll(".atomview-status")[1]
      .textContent.includes("Coordinates:"),
  );
  const restored = await page.evaluate(() => window.harness.camera(1));
  for (const k of ["position", "target", "up"])
    for (let i = 0; i < 3; i++)
      assert.ok(Math.abs(restored[k][i] - saved.camera[k][i]) < 1e-8);
  const secondFrame = await page
    .locator('input[aria-label="Frame (0-based)"]')
    .nth(1)
    .inputValue();
  await page
    .getByRole("button", { name: "Next ▶", exact: true })
    .first()
    .click();
  assert.equal(
    await page
      .locator('input[aria-label="Frame (0-based)"]')
      .nth(1)
      .inputValue(),
    secondFrame,
  );
  await page.evaluate(() => {
    window.harness.dispose(0);
    window.harness.dispose(1);
  });
  assert.deepEqual(await page.evaluate(() => window.harness.stats()), {
    widgets: 0,
    active: 0,
    memory: 0,
  });
  await page.waitForFunction(
    () => document.querySelectorAll("canvas").length === 0,
  );
  for (const name of [
    "iron.data",
    "properties.xyz",
    "models.pdb",
    "fractional.cif",
  ]) {
    const index = await page.evaluate((n) => window.harness.mount(n), name);
    await page.evaluate((i) => window.harness.scroll(i), index);
    await waitReady();
    if (name === "models.pdb") {
      assert.ok(
        (await page.evaluate((i) => window.harness.sphereRadius(i), index)) >=
          0.45,
      );
      await page.waitForFunction(
        (i) => Math.hypot(...window.harness.camera(i).position) < 20,
        index,
      );
    }
    await page.evaluate((i) => window.harness.dispose(i), index);
  }
  // More than four embeds: offscreen renderers must be reclaimed automatically.
  const scrolling = await page.evaluate(() =>
    [
      "water.xyz",
      "properties.xyz",
      "iron.data",
      "fe-o-q.lammpstrj",
      "models.pdb",
      "fractional.cif",
    ].map((name) => window.harness.mount(name)),
  );
  for (const i of scrolling) {
    await page.evaluate((i) => window.harness.scroll(i), i);
    await page.waitForFunction((i) => window.harness.state(i).ready, i, {
      timeout: 20000,
    });
  }
  await page.evaluate((i) => window.harness.scroll(i), scrolling[0]);
  await page.waitForFunction(
    (i) => window.harness.state(i).ready,
    scrolling[0],
    { timeout: 20000 },
  );
  for (const i of scrolling)
    await page.evaluate((i) => window.harness.dispose(i), i);
  const malformed = await page.evaluate(() =>
    window.harness.mount("truncated.xyz"),
  );
  await page.evaluate((i) => window.harness.scroll(i), malformed);
  await page.waitForFunction(
    (i) => window.harness.state(i).status.includes("error"),
    malformed,
  );
  assert.equal(
    (await page.evaluate((i) => window.harness.state(i), malformed)).worker,
    false,
  );
  await page.evaluate((i) => window.harness.dispose(i), malformed);
  // A failed property render must not label old geometry as a new frame or copy inconsistent state.
  const missingProperty = await page.evaluate(() =>
    window.harness.mount("varying-q.lammpstrj", "q"),
  );
  await page.evaluate((i) => window.harness.scroll(i), missingProperty);
  await page.waitForFunction(
    (i) => window.harness.state(i).ready,
    missingProperty,
  );
  await page
    .getByRole("button", { name: "Next ▶", exact: true })
    .last()
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".atomview-status")].some((e) =>
      e.textContent.includes("Missing property q"),
    ),
  );
  assert.match(
    await page
      .locator(".atomview-controls")
      .filter({
        has: page.getByRole("button", { name: "Next ▶", exact: true }),
      })
      .last()
      .innerText(),
    /failed; displayed frame 0/,
  );
  await page
    .getByRole("button", {
      name: "Copy current view as atomview block",
      exact: true,
    })
    .last()
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".atomview-status")].some((e) =>
      e.textContent.includes("render successfully"),
    ),
  );
  await page
    .getByLabel("Color property", { exact: true })
    .last()
    .fill("element");
  await page
    .getByRole("button", { name: "Apply colors", exact: true })
    .last()
    .click();
  await page.waitForFunction(
    (i) =>
      window.harness.state(i).ready &&
      !window.harness.state(i).status.includes("error"),
    missingProperty,
  );
  await page.evaluate((i) => window.harness.dispose(i), missingProperty);
  // Clipboard denial leaves a complete, manually copyable block rather than losing view state.
  const copyFallback = await page.evaluate(() =>
    window.harness.mount("water.xyz"),
  );
  await page.evaluate((i) => window.harness.scroll(i), copyFallback);
  await page.waitForFunction(
    (i) => window.harness.state(i).ready,
    copyFallback,
  );
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw Error("Permission denied (test)");
    };
  });
  await page
    .getByRole("button", {
      name: "Copy current view as atomview block",
      exact: true,
    })
    .last()
    .click();
  const fallback = page
    .getByLabel("Last generated atomview block (manual copy)")
    .last();
  await fallback.waitFor({ state: "visible" });
  assert.match(await fallback.inputValue(), /schemaVersion/);
  await page.evaluate((i) => window.harness.dispose(i), copyFallback);
  // Reload/seek races and explicit release must not leak or auto-resurrect resources.
  const race = await page.evaluate(() =>
    window.harness.mount("fe-o-q.lammpstrj", "q"),
  );
  await page.evaluate((i) => window.harness.scroll(i), race);
  await page.waitForFunction((i) => window.harness.state(i).ready, race);
  await page.evaluate((i) => window.harness.reloadRace(i), race);
  await page.waitForFunction(
    (i) => window.harness.state(i).ready && window.harness.state(i).frame === 2,
    race,
  );
  assert.equal(await page.evaluate(() => window.atomviewOpenHandles), 1);
  await page.getByLabel("Playback FPS", { exact: true }).last().fill("12");
  await page
    .getByLabel("Playback FPS", { exact: true })
    .last()
    .dispatchEvent("change");
  await page.evaluate((i) => window.harness.manualRelease(i), race);
  await page.evaluate((i) => window.harness.hide(i, true), race);
  await page.waitForTimeout(400);
  await page.evaluate((i) => window.harness.hide(i, false), race);
  await page.waitForTimeout(400);
  assert.equal(
    (await page.evaluate((i) => window.harness.state(i), race)).ready,
    false,
  );
  assert.equal(await page.evaluate(() => window.atomviewOpenHandles), 0);
  await page
    .getByRole("button", { name: "Reload / retry", exact: true })
    .last()
    .click();
  await page.waitForFunction((i) => window.harness.state(i).ready, race);
  assert.equal(
    (await page.evaluate((i) => window.harness.state(i), race)).fps,
    12,
  );
  await page.evaluate((i) => window.harness.dispose(i), race);
  for (const name of [
    "models.pdb",
    "fractional.cif",
    "fe-o-q.lammpstrj",
    "water.xyz",
    "models.pdb",
    "fe-o-q.lammpstrj",
  ])
    await page.evaluate((n) => window.harness.cancelDuringLoad(n), name);
  await page.waitForFunction(
    () =>
      window.atomviewOpenHandles === 0 && window.harness.stats().active === 0,
  );
  const detached = await page.evaluate(() => window.harness.detachDuringLoad());
  await page.waitForTimeout(250);
  assert.equal(await page.locator("canvas").count(), 0);
  assert.equal((await page.evaluate(() => window.harness.stats())).active, 0);
  await page.evaluate((i) => {
    window.harness.reattach(i);
    window.harness.scroll(i);
  }, detached);
  await waitReady();
  await page.evaluate((i) => window.harness.dispose(i), detached);
  await page.evaluate(() => window.harness.mount("missing.xyz"));
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".atomview-status")].some((e) =>
      e.textContent.includes("Missing local file"),
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  const result = {
    status: "PASS",
    canvasData,
    checks: [
      "Mol* WebGL spheres and triclinic cell",
      "q fixed legend",
      "frame/timestep",
      "play/pause",
      "atom picking and original ID panel",
      "camera/selection/range copy and restore",
      "camera preserved across frame changes",
      "GPU atom position/picking updates after frame change (stale-mesh regression)",
      "two independent widgets",
      "all five formats rendered",
      "six scrolling embeds automatically reclaim slots; PDB/CIF and return-to-first render",
      "12 concurrent reloads and rapid seeks publish the latest frame with one handle",
      "manual release survives hide/show until explicit reload",
      "clipboard denial preserves a manually copyable complete view block",
      "missing-property frame labels remain honest; inconsistent copy refused; valid recolor recovers",
      "close during six mixed-format loads leaves zero handles/slots",
      "initial parser failure terminates its worker",
      "cleanup counters and canvas disposal",
      "detached/zero-size async initialization deferred and reattachment resumes",
      "missing file",
      "HTTP(S) requests blocked; zero attempted",
    ],
    limitations: [
      "Synthetic mocked Obsidian host; not actual Obsidian integration",
    ],
    errors,
    network,
  };
  await fs.writeFile(
    "test-artifacts/browser-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("Browser harness failure", errors);
  await page
    .screenshot({ path: "test-artifacts/failure.png", timeout: 5000 })
    .catch(() => {});
  await fs.writeFile(
    "test-artifacts/browser-failure.txt",
    String(e) +
      "\n" +
      errors.join("\n") +
      "\n" +
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")),
  );
  throw e;
} finally {
  await browser.close();
}
