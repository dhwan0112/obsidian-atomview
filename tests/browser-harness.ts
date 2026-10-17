import { AtomWidget } from "../src/main.ts";
import type AtomViewPlugin from "../src/main.ts";
import { parseConfig } from "../src/yaml-config.ts";
import type { MolstarAdapter } from "../src/molstar-adapter.ts";
import type { Dataset } from "../src/model.ts";
import { Vec2, Vec3, Vec4 } from "molstar/lib/mol-math/linear-algebra.js";
import { ShapeGroup } from "molstar/lib/mol-model/shape.js";
import { OrderedSet } from "molstar/lib/mol-data/int.js";
import { config } from "../src/config.ts";
import { FileSystemAdapter } from "obsidian";
declare const FIXTURES: Record<string, string>;
declare global {
  interface Window {
    fixtures: Record<string, string>;
    atomviewOpenHandles: number;
    harness: {
      mount: (name: string, color?: string) => number;
      reloadRace: (i: number) => Promise<void>;
      manualRelease: (i: number) => Promise<void>;
      hide: (i: number, hide: boolean) => void;
      cancelDuringLoad: (name: string) => Promise<void>;
      dispose: (i: number) => void;
      scroll: (i: number) => void;
      sphereRadius: (i: number) => number;
      state: (i: number) => {
        ready: boolean;
        status: string;
        frame: number;
        fps?: number;
        worker: boolean;
      };
      detachDuringLoad: () => number;
      reattach: (i: number) => void;
      stats: () => { widgets: number; active: number; memory: number };
      mountBlock: (block: string) => number;
      screen: (i: number) => { x: number; y: number };
      camera: (i: number) => unknown;
      pick: (i: number) => number | null;
    };
  }
}
window.fixtures = FIXTURES;
window.atomviewOpenHandles = 0;
const plugin = {
  app: { vault: { adapter: Object.create(FileSystemAdapter.prototype) } },
  widgets: new Set(),
  active: 0,
  memory: 0,
} as unknown as AtomViewPlugin;
const widgets: AtomWidget[] = [];
window.harness = {
  async reloadRace(i) {
    const w = widgets[i];
    const load = () => Reflect.get(w, "loadSource").call(w);
    await Promise.all(Array.from({ length: 12 }, () => load()));
    const c = Reflect.get(w, "controller");
    await Promise.all([2, 1, 0, 2].map((n) => c.setFrame(n)));
  },
  async manualRelease(i) {
    await Reflect.get(widgets[i], "releaseViewer").call(widgets[i]);
  },
  hide(i, hide) {
    widgets[i].containerEl.style.display = hide ? "none" : "";
  },
  async cancelDuringLoad(name) {
    const i = window.harness.mount(name);
    window.harness.scroll(i);
    const task = Reflect.get(widgets[i], "loadSource").call(widgets[i]);
    await new Promise((r) => setTimeout(r, 10));
    widgets[i].unload();
    await task;
  },
  sphereRadius(i) {
    return Reflect.get(
      Reflect.get(widgets[i], "renderer"),
      "atomsRepresentation",
    ).renderObjects[0].values.boundingSphere.ref.value.radius;
  },
  scroll(i) {
    widgets[i].containerEl.scrollIntoView({ block: "center" });
  },
  state(i) {
    const w = widgets[i];
    return {
      ready:
        !!Reflect.get(w, "renderer") &&
        !Reflect.get(w, "first") &&
        !Reflect.get(w, "rendering"),
      status: Reflect.get(w, "status").textContent,
      frame: Reflect.get(w, "cfg").frame,
      fps: Reflect.get(w, "controller")?.fps,
      worker: !!Reflect.get(Reflect.get(w, "parser"), "worker"),
    };
  },
  detachDuringLoad() {
    const i = window.harness.mount("water.xyz");
    const w = widgets[i];
    (Reflect.get(w, "loadSource") as () => Promise<void>).call(w);
    w.containerEl.remove();
    return i;
  },
  reattach(i) {
    document.body.append(widgets[i].containerEl);
  },
  mountBlock(block) {
    const root = document.createElement("div");
    root.style.width = "660px";
    document.body.append(root);
    const w = new AtomWidget(root, plugin, parseConfig(block));
    widgets.push(w);
    w.load();
    return widgets.length - 1;
  },
  camera(i) {
    return (Reflect.get(widgets[i], "renderer") as MolstarAdapter).camera();
  },
  pick(i) {
    const r = Reflect.get(widgets[i], "renderer") as MolstarAdapter;
    const screen = window.harness.screen(i);
    const c = widgets[i].containerEl.querySelector("canvas")!;
    const rect = c.getBoundingClientRect();
    const data = r.canvas3d.identify(
      Vec2.create(screen.x - rect.x, screen.y - rect.y),
    );
    if (!data) return null;
    const loci = r.canvas3d.getLoci(data.id).loci;
    return ShapeGroup.isLoci(loci) && loci.groups.length
      ? OrderedSet.getAt(loci.groups[0].ids, 0)
      : null;
  },
  screen(i) {
    const r = Reflect.get(widgets[i], "renderer") as MolstarAdapter;
    const d = Reflect.get(widgets[i], "dataset") as Dataset;
    const c = Reflect.get(widgets[i], "cfg");
    const p = (Reflect.get(widgets[i], "currentFrame") ?? d.frames[c.frame])
      .atoms[0].position;
    const out = r.canvas3d.camera.project(
      Vec4(),
      Vec3.create(p[0], p[1], p[2]),
    );
    const canvas = widgets[i].containerEl.querySelector("canvas")!;
    const b = canvas.getBoundingClientRect();
    return {
      x: b.x + (out[0] * b.width) / canvas.width,
      y: b.y + b.height - (out[1] * b.height) / canvas.height,
    };
  },
  mount(name, color = "element") {
    const root = document.createElement("div");
    root.style.width = "660px";
    document.body.append(root);
    const widget = new AtomWidget(
      root,
      plugin,
      config({
        source: name,
        colorBy: color,
        elementMap: { 1: "Fe", 2: "O" },
        height: 330,
      }),
    );
    widgets.push(widget);
    widget.load();
    return widgets.length - 1;
  },
  dispose(i) {
    widgets[i].unload();
  },
  stats: () => ({
    widgets: plugin.widgets.size,
    active: plugin.active,
    memory: plugin.memory,
  }),
};
