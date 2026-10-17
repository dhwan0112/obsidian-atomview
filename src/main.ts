import {
  Plugin,
  FileView,
  FileSystemAdapter,
  TFile,
  MarkdownRenderChild,
  Notice,
  PluginSettingTab,
  Setting,
  Modal,
} from "obsidian";
import type { App, WorkspaceLeaf, ViewStateResult } from "obsidian";
import { readFile, stat } from "node:fs/promises";
import { config, serialize } from "./config.ts";
import type { ViewConfig } from "./config.ts";
import { parseConfig } from "./yaml-config.ts";
import { localSource, registerExternal, registeredSource } from "./paths.ts";
import type { RegisteredSource } from "./paths.ts";
import {
  DumpFrameSource,
  STREAM_LIMITS,
  clearIndexCache,
} from "./stream-source.ts";
import { LIMITS } from "./model.ts";
import type { Dataset, Frame } from "./model.ts";
import {
  TrajectoryController,
  LazyTrajectoryController,
  RequestGate,
  scalar,
  range,
} from "./controller.ts";
import { ParserClient } from "./worker-client.ts";
import { MolstarAdapter } from "./molstar-adapter.ts";
const VIEW = "atomview";
function el<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  text?: string,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  parent.append(e);
  return e;
}
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
export class AtomWidget extends MarkdownRenderChild {
  private readonly gate = new RequestGate();
  private readonly parser = new ParserClient();
  private observer?: IntersectionObserver;
  private controller?: TrajectoryController | LazyTrajectoryController;
  private stream?: DumpFrameSource;
  private currentFrame?: Frame;
  private displayedIndex?: number;
  private hiddenTimer?: ReturnType<typeof setTimeout>;
  private indexStatus?: HTMLElement;
  private rangeReference?: number;
  private rangeAbort?: AbortController;
  private loadAbort?: AbortController;
  private manualReleased = false;
  private playbackFps = 5;
  private renderer?: MolstarAdapter;
  private dataset?: Dataset;
  private visible = true;
  private started = false;
  private released = false;
  private disposed = false;
  private reserved = false;
  private memory = 0;
  private status!: HTMLElement;
  private info!: HTMLElement;
  private legend!: HTMLElement;
  private viewport!: HTMLDivElement;
  private slider!: HTMLInputElement;
  private caption!: HTMLElement;
  private play!: HTMLButtonElement;
  private min!: HTMLInputElement;
  private max!: HTMLInputElement;
  private rendering = false;
  private pending = false;
  private renderTask: Promise<void> = Promise.resolve();
  private first = true;
  private releasing = false;
  constructor(
    root: HTMLElement,
    private plugin: AtomViewPlugin,
    private cfg: ViewConfig,
  ) {
    super(root);
  }
  onload() {
    this.plugin.widgets.add(this);
    this.containerEl.classList.add("atomview");
    const controls = el(
      this.containerEl,
      "div",
      undefined,
      "atomview-controls",
    );
    const button = (label: string, fn: () => void | Promise<void>) => {
      const b = el(controls, "button", label);
      this.registerDomEvent(b, "click", () => {
        this.background(fn);
      });
      return b;
    };
    this.play = button("Play", () => {
      if (!this.visible || document.hidden) return;
      const c = this.controller;
      if (!c) return;
      if (c.playing) c.pause();
      else c.play();
      this.play.textContent = c.playing ? "Pause" : "Play";
    });
    button("◀ Previous", () => this.controller?.step(-1));
    button("Next ▶", () => this.controller?.step(1));
    button("Fit / reset", () => this.renderer?.fit());
    this.slider = el(controls, "input");
    this.slider.type = "range";
    this.slider.min = "0";
    this.slider.max = "0";
    this.slider.value = String(this.cfg.frame);
    this.slider.setAttribute("aria-label", "Frame (0-based)");
    this.registerDomEvent(this.slider, "input", () =>
      this.background(() =>
        this.controller?.setFrame(Number(this.slider.value)),
      ),
    );
    const fps = el(controls, "input");
    fps.type = "number";
    fps.min = ".2";
    fps.max = "30";
    fps.step = ".2";
    fps.value = "5";
    fps.setAttribute("aria-label", "Playback FPS");
    this.registerDomEvent(fps, "change", () => {
      try {
        const value = Number(fps.value);
        if (!Number.isFinite(value) || value < 0.2 || value > 30)
          throw Error("FPS must be 0.2–30");
        this.controller?.speed(value);
        this.playbackFps = value;
      } catch (e) {
        fps.value = String(this.playbackFps);
        this.error(e);
      }
    });
    el(controls, "span", "fps");
    this.caption = el(controls, "span");
    const colors = el(this.containerEl, "div", undefined, "atomview-controls");
    el(colors, "label", "Color by: ");
    const property = el(colors, "input");
    property.value = this.cfg.colorBy;
    property.placeholder = "element, type, q, force…";
    property.setAttribute("aria-label", "Color property");
    const component = el(colors, "input");
    component.value =
      this.cfg.component === undefined ? "" : String(this.cfg.component);
    component.placeholder = "vector: index or magnitude";
    component.setAttribute(
      "aria-label",
      "Vector component (0-based) or magnitude",
    );
    const mode = el(colors, "select");
    for (const [v, label] of [
      ["fixed", "Fixed across trajectory"],
      ["frame", "Auto each frame (colors change meaning)"],
    ]) {
      const o = el(mode, "option", label);
      o.value = v;
    }
    mode.value = this.cfg.rangeMode;
    this.min = el(colors, "input");
    this.max = el(colors, "input");
    for (const [input, label] of [
      [this.min, "Fixed minimum"],
      [this.max, "Fixed maximum"],
    ] as const) {
      input.type = "number";
      input.step = "any";
      input.placeholder = label;
      input.setAttribute("aria-label", label);
    }
    if (this.cfg.colorRange) {
      this.min.value = String(this.cfg.colorRange[0]);
      this.max.value = String(this.cfg.colorRange[1]);
    }
    const apply = el(colors, "button", "Apply colors");
    this.registerDomEvent(apply, "click", () => {
      try {
        if ((this.min.value === "") !== (this.max.value === ""))
          throw Error("Set both fixed range bounds or leave both empty");
        this.rangeAbort?.abort();
        this.rangeReference = undefined;
        this.cfg = config({
          ...this.cfg,
          colorBy: property.value.trim(),
          component: component.value.trim()
            ? component.value === "magnitude"
              ? "magnitude"
              : Number(component.value)
            : undefined,
          rangeMode: mode.value,
          colorRange:
            this.min.value !== "" || this.max.value !== ""
              ? [Number(this.min.value), Number(this.max.value)]
              : undefined,
        });
        this.requestRender();
      } catch (e) {
        this.error(e);
      }
    });
    const cell = el(colors, "input");
    cell.type = "checkbox";
    cell.checked = this.cfg.showCell;
    el(colors, "label", "Cell wireframe");
    this.registerDomEvent(cell, "change", () => {
      this.cfg.showCell = cell.checked;
      this.requestRender();
    });
    const details = el(this.containerEl, "details");
    el(details, "summary", "Type → element mapping / data atom style");
    const map = el(details, "textarea");
    map.value = JSON.stringify(this.cfg.elementMap);
    map.setAttribute("aria-label", "Type to element map (JSON)");
    const style = el(details, "select");
    for (const s of ["", "atomic", "charge", "full"]) {
      const o = el(style, "option", s || "Use Atoms # hint");
      o.value = s;
    }
    style.value = this.cfg.atomStyle ?? "";
    const update = el(details, "button", "Apply mapping / reload");
    this.registerDomEvent(update, "click", () => {
      try {
        this.cfg = config({
          ...this.cfg,
          elementMap: JSON.parse(map.value),
          atomStyle: style.value || undefined,
        });
        this.manualReleased = false;
        this.background(() => this.loadSource());
      } catch (e) {
        this.error(e);
      }
    });
    const copyDetails = el(
      this.containerEl,
      "details",
      undefined,
      "atomview-copy-state",
    );
    el(copyDetails, "summary", "Last generated view block / manual copy");
    const copyText = el(copyDetails, "textarea");
    copyText.readOnly = true;
    copyText.setAttribute(
      "aria-label",
      "Last generated atomview block (manual copy)",
    );
    copyText.placeholder = "Use Copy current view to generate the block.";
    button("Copy current view as atomview block", async () => {
      if (
        !this.dataset ||
        !this.renderer ||
        this.rendering ||
        this.displayedIndex !== this.cfg.frame
      )
        throw Error(
          "Wait for the current frame to render successfully before copying",
        );
      this.cfg.frame = this.controller?.index ?? 0;
      this.cfg.camera = this.renderer.camera();
      const block = serialize(this.cfg);
      copyText.value = block;
      try {
        await navigator.clipboard.writeText(block);
        new Notice("AtomView block copied; manual copy is available below");
      } catch {
        copyDetails.open = true;
        copyText.focus();
        copyText.select();
        new Notice(
          "Clipboard unavailable. Press Ctrl+C / Cmd+C on the selected view block.",
        );
      }
    });
    button("Scan full property range", async () => {
      if (!this.stream)
        throw Error(
          "Small files already use the full trajectory range; select a scalar property first",
        );
      if (["element", "type"].includes(this.cfg.colorBy))
        throw Error("Select a scalar property first");
      this.controller?.pause();
      this.play.textContent = "Play";
      this.rangeAbort?.abort();
      const abort = (this.rangeAbort = new AbortController()),
        stream = this.stream;
      const choice = {
        property: this.cfg.colorBy,
        component: this.cfg.component,
      };
      let lo = Infinity,
        hi = -Infinity;
      await stream.waitForIndex();
      for (let i = 0; i < stream.entries.length; i++) {
        if (abort.signal.aborted || this.stream !== stream || this.disposed)
          return;
        const [a, b] = range(
          scalar(await stream.getFrame(i, abort.signal), choice),
        );
        if (abort.signal.aborted || this.stream !== stream || this.disposed)
          return;
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
        if (this.indexStatus)
          this.indexStatus.textContent = `Property range scan: ${i + 1} / ${stream.entries.length} frames (cancel with Cancel parsing)`;
      }
      if (
        abort.signal.aborted ||
        this.stream !== stream ||
        this.cfg.colorBy !== choice.property ||
        this.cfg.component !== choice.component
      )
        return;
      this.cfg.colorRange = [lo, hi];
      this.cfg.rangeMode = "fixed";
      this.rangeReference = undefined;
      this.min.value = String(lo);
      this.max.value = String(hi);
      if (this.indexStatus)
        this.indexStatus.textContent = `Full property scan complete: ${stream.entries.length} frames; fixed global bounds`;
      this.requestRender();
    });
    button("Reload / retry", () => {
      this.manualReleased = false;
      return this.loadSource();
    });
    button("Release viewer", () => this.releaseViewer());
    button("Cancel parsing", () => {
      this.rangeAbort?.abort();
      this.background(() => this.releaseViewer());
      this.status.textContent = "Parsing cancelled";
    });
    this.status = el(
      this.containerEl,
      "div",
      "Waiting until visible…",
      "atomview-status",
    );
    this.viewport = el(this.containerEl, "div", undefined, "atomview-viewport");
    this.viewport.style.height = `${this.cfg.height}px`;
    this.legend = el(this.containerEl, "div", undefined, "atomview-legend");
    this.info = el(
      this.containerEl,
      "pre",
      "Click an atom to inspect original ID, coordinates and properties.",
      "atomview-info",
    );
    this.indexStatus = el(
      this.containerEl,
      "div",
      undefined,
      "atomview-index-status",
    );
    this.observer = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
      if (!this.visible) {
        this.controller?.pause();
        this.play.textContent = "Play";
        this.renderer?.pause();
        this.hiddenTimer = setTimeout(() => {
          if (!this.visible) this.background(() => this.releaseViewer(true));
        }, 300);
      } else {
        this.renderer?.resume();
        if (!this.started) {
          this.started = true;
          this.background(() => this.loadSource());
        }
      }
    });
    this.observer.observe(this.viewport);
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) {
        this.controller?.pause();
        this.play.textContent = "Play";
        this.renderer?.pause();
      } else if (this.visible) {
        this.renderer?.resume();
        if (!this.started && !this.manualReleased)
          this.background(() => this.loadSource());
      }
    });
  }
  private background(task: () => unknown) {
    try {
      void Promise.resolve(task()).catch((e) => this.error(e));
    } catch (e) {
      this.error(e);
    }
  }
  private error(e: unknown) {
    if (!this.disposed) {
      this.controller?.pause();
      this.play.textContent = "Play";
      this.status.textContent = `AtomView error: ${errorText(e)}`;
    }
  }
  private canInitializeRenderer(): boolean {
    return (
      this.visible &&
      !document.hidden &&
      this.containerEl.isConnected &&
      this.viewport.clientWidth > 0 &&
      this.viewport.clientHeight > 0
    );
  }
  private deferHiddenInitialization(): boolean {
    if (this.renderer || this.canInitializeRenderer()) return false;
    if (this.reserved) {
      this.plugin.active--;
      this.reserved = false;
    }
    this.started = false;
    this.status.textContent = "Waiting until visible…";
    return true;
  }
  private async loadSource() {
    if (this.disposed || this.releasing || this.manualReleased) return;
    if (this.deferHiddenInitialization()) return;
    const ticket = this.gate.next();
    this.loadAbort?.abort();
    const loading = (this.loadAbort = new AbortController());
    this.started = true;
    this.rangeAbort?.abort();
    this.parser.cancel();
    this.controller?.dispose();
    this.controller = undefined;
    const oldStream = this.stream;
    this.stream = undefined;
    this.pending = false;
    try {
      await oldStream?.dispose();
      await this.renderTask;
    } catch (e) {
      if (this.gate.current(ticket)) this.error(e);
    }
    if (!this.gate.current(ticket)) return;
    if (this.renderer && !this.first) this.cfg.camera = this.renderer.camera();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.dataset = undefined;
    this.currentFrame = undefined;
    this.displayedIndex = undefined;
    this.plugin.memory -= this.memory;
    this.memory = 0;
    if (this.indexStatus) this.indexStatus.textContent = "";
    if (!this.reserved) {
      if (this.plugin.active >= 4) {
        this.started = false;
        this.status.textContent =
          "Four viewers are already active. Close another AtomView view, then Reload / retry.";
        return;
      }
      this.plugin.active++;
      this.reserved = true;
    }
    try {
      this.status.textContent = "Opening local source…";
      const adapter = this.plugin.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter))
        throw Error("AtomView requires a desktop filesystem vault");
      const external = this.cfg.source.startsWith("external:");
      const file = external
        ? await registeredSource(
            this.plugin.settings.externalSources?.[this.cfg.source],
            STREAM_LIMITS.bytes,
          )
        : await localSource(
            adapter.getBasePath(),
            this.cfg.source,
            STREAM_LIMITS.bytes,
          );
      if (!this.gate.current(ticket)) return;
      const size = (await stat(file)).size;
      const streaming =
        this.cfg.format === "lammps-dump" || /\.lammpstrj$/i.test(file);
      let dataset: Dataset;
      if (streaming) {
        this.status.textContent =
          "Indexing local trajectory; loading first frame…";
        const stream = await DumpFrameSource.create(
          file,
          (text, source) => this.parser.parse(text, source, "lammps-dump"),
          (p) => {
            if (!this.gate.current(ticket)) return;
            this.slider.max = String(Math.max(0, p.frames - 1));
            if (this.indexStatus)
              this.indexStatus.textContent = p.error
                ? `Index error: ${p.error}`
                : `${p.complete ? "Index complete" : "Indexing"}: ${p.frames} frames · ${Math.round((100 * p.bytes) / p.total)}% · values validated on frame access`;
          },
          loading.signal,
        );
        if (!this.gate.current(ticket)) {
          await stream.dispose();
          return;
        }
        this.stream = stream;
        const first = await stream.getFrame(0);
        // A copied state may seek ahead of the currently available index.
        if (this.cfg.frame) await stream.waitForIndex();
        dataset = {
          format: "lammps-dump",
          frames: [first],
          units: "unknown",
          warnings: [
            "LAMMPS units unknown. No inferred bonds. Disk-backed trajectory; only accessed frames are parsed.",
          ],
        };
      } else {
        if (size > LIMITS.bytes)
          throw Error(
            "Only LAMMPS dumps support disk-backed access; this format exceeds 16 MiB",
          );
        const text = await readFile(file, {
          encoding: "utf8",
          signal: loading.signal,
        });
        if (!this.gate.current(ticket)) return;
        dataset = await this.parser.parse(
          text,
          file,
          this.cfg.format,
          this.cfg.atomStyle,
        );
      }
      if (!this.gate.current(ticket)) return;
      // Obsidian can virtualize/remove a code block while its worker is parsing.
      // Do not allocate a zero-size WebGL context for that detached/hidden root.
      if (this.deferHiddenInitialization()) {
        this.parser.cancel();
        const stream = this.stream;
        this.stream = undefined;
        await stream?.dispose();
        return;
      }
      const frameCount = this.stream
        ? this.stream.entries.length
        : dataset.frames.length;
      if (this.cfg.frame >= frameCount)
        throw Error(
          `Frame ${this.cfg.frame} out of range: expected 0–${frameCount - 1}`,
        );
      const bytes = this.stream
        ? STREAM_LIMITS.cache
        : new TextEncoder().encode(JSON.stringify(dataset)).length * 2;
      if (this.plugin.memory - this.memory + bytes > LIMITS.cacheBytes)
        throw Error(
          "AtomView combined dataset cache exceeds 128 MiB budget; close another view",
        );
      this.plugin.memory += bytes - this.memory;
      this.memory = bytes;
      this.dataset = dataset;
      if (!this.renderer)
        this.renderer = new MolstarAdapter(this.viewport, (id) => {
          this.cfg.selectedId = id;
          this.requestRender();
        });
      this.first = true;
      const changed = (f: Frame, index: number) => {
        if (!this.gate.current(ticket)) return;
        this.currentFrame = f;
        if (this.stream) dataset.frames = [f];
        this.cfg.frame = index;
        this.slider.value = String(index);
        this.caption.textContent = `Loading frame ${index}${this.displayedIndex !== undefined ? ` · displayed ${this.displayedIndex}` : ""}…`;
        this.requestRender();
        return this.renderTask;
      };
      const ownStream = this.stream;
      this.controller = ownStream
        ? new LazyTrajectoryController(
            () => ownStream.entries.length,
            (i, signal) => ownStream.getFrame(i, signal),
            changed,
            (e) => this.error(e),
          )
        : new TrajectoryController(dataset, changed);
      this.controller.speed(this.playbackFps);
      this.slider.max = String(frameCount - 1);
      await this.controller.setFrame(this.cfg.frame);
    } catch (e) {
      if (this.gate.current(ticket)) {
        this.parser.cancel();
        const failed = this.stream;
        this.stream = undefined;
        if (failed) this.background(() => failed.dispose());
        if (!this.renderer && !this.dataset && this.reserved) {
          this.reserved = false;
          this.plugin.active--;
        }
        this.error(e);
      }
    }
  }
  private async releaseViewer(automatic = false) {
    if (this.releasing || this.disposed || (automatic && this.manualReleased))
      return;
    if (!automatic) this.manualReleased = true;
    this.releasing = true;
    this.loadAbort?.abort();
    this.rangeAbort?.abort();
    if (this.renderer && !this.first) this.cfg.camera = this.renderer.camera();
    this.gate.cancel();
    this.parser.cancel();
    this.controller?.dispose();
    this.controller = undefined;
    const stream = this.stream;
    this.stream = undefined;
    try {
      await stream?.dispose();
    } catch (e) {
      this.error(e);
    }
    this.pending = false;
    await this.renderTask;
    if (this.disposed) return;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.dataset = undefined;
    this.currentFrame = undefined;
    this.displayedIndex = undefined;
    if (this.reserved) {
      this.plugin.active--;
      this.reserved = false;
    }
    this.plugin.memory -= this.memory;
    this.memory = 0;
    this.releasing = false;
    this.status.textContent = automatic
      ? "Suspended while offscreen; restored when visible."
      : "Viewer released. Reload / retry to reopen.";
    if (automatic) this.started = false;
    for (const w of this.plugin.widgets) {
      if (
        !w.started &&
        w.visible &&
        !w.disposed &&
        !w.releasing &&
        !w.manualReleased
      )
        setTimeout(() => {
          if (!w.started && w.visible && !w.disposed && !w.manualReleased)
            w.background(() => w.loadSource());
        }, 0);
    }
  }
  async revokeExternal(source: string) {
    if (this.cfg.source !== source) return;
    await this.releaseViewer();
    this.status.textContent =
      "External file permission revoked. Register the file again to open it.";
  }
  private currentRange(f: Frame): [number, number] | undefined {
    if (["type", "element"].includes(this.cfg.colorBy)) return undefined;
    const choice = {
      property: this.cfg.colorBy,
      component: this.cfg.component,
    };
    if (this.cfg.rangeMode === "frame") return range(scalar(f, choice));
    if (this.cfg.colorRange) {
      scalar(f, choice);
      return this.cfg.colorRange;
    }
    if (this.stream) {
      this.cfg.colorRange = range(scalar(f, choice));
      this.rangeReference = this.cfg.frame;
      this.min.value = String(this.cfg.colorRange[0]);
      this.max.value = String(this.cfg.colorRange[1]);
      return this.cfg.colorRange;
    }
    let lo = Infinity,
      hi = -Infinity;
    for (const frame of this.dataset!.frames) {
      const [a, b] = range(scalar(frame, choice));
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
    }
    this.cfg.colorRange = [lo, hi];
    this.min.value = String(lo);
    this.max.value = String(hi);
    return [lo, hi];
  }
  private frameCaption(index: number, f: Frame) {
    const count =
      this.stream?.entries.length ?? this.dataset?.frames.length ?? 0;
    return `Frame ${index} / ${count - 1}${this.stream && !this.stream.complete ? " (indexed so far)" : ""}${f.timestep !== undefined ? ` · timestep ${f.timestep}` : ""}`;
  }
  private requestRender() {
    this.pending = true;
    if (this.rendering) return;
    this.rendering = true;
    this.renderTask = (async () => {
      while (this.pending && !this.disposed) {
        this.pending = false;
        const f = this.currentFrame ?? this.dataset?.frames[this.cfg.frame];
        if (!f || !this.renderer) continue;
        try {
          const index = this.cfg.frame;
          const colorRange = this.currentRange(f);
          const snapshot = {
            ...this.cfg,
            elementMap: { ...this.cfg.elementMap },
          };
          this.legend.textContent = colorRange
            ? `${this.cfg.colorBy}${this.cfg.component !== undefined ? ` [${this.cfg.component}]` : ""}: ${colorRange[0]} … ${colorRange[1]} · ${this.cfg.rangeMode === "frame" ? "AUTO PER FRAME" : `FIXED${this.rangeReference !== undefined ? ` (reference frame ${this.rangeReference}; not global extrema)` : this.stream ? " (explicit bounds)" : " across trajectory"}`}`
            : `Color: ${this.cfg.colorBy}; unmapped types retain type identity`;
          this.legend.classList.toggle("atomview-scalar", !!colorRange);
          await this.renderer.show(
            f,
            snapshot,
            colorRange,
            this.first && !this.cfg.camera,
          );
          if (this.disposed) break;
          if (this.first && this.cfg.camera)
            this.renderer.restore(this.cfg.camera);
          this.first = false;
          this.displayedIndex = index;
          this.caption.textContent = this.frameCaption(index, f);
          if (!this.visible || document.hidden) this.renderer.pause();
          const a = f.atoms.find((a) => a.id === snapshot.selectedId);
          this.info.textContent = a
            ? JSON.stringify(
                {
                  id: a.id,
                  type: a.type ?? "unknown",
                  element:
                    a.element ??
                    (a.type ? snapshot.elementMap[a.type] : undefined) ??
                    "unknown",
                  coordinates: a.position,
                  units: this.dataset!.units,
                  properties: a.properties,
                },
                null,
                2,
              )
            : snapshot.selectedId
              ? `Selected ID ${snapshot.selectedId} absent in this frame`
              : "Click an atom for original data. Drag: rotate · right drag: pan · wheel: zoom.";
          this.status.textContent = [
            snapshot.source,
            `Coordinates: ${f.coordinateSet}`,
            `Units: ${this.dataset!.units}`,
            f.cell
              ? `Cell PBC: ${f.cell.pbc.map((x) => (x === null ? "unknown" : x ? "periodic" : "nonperiodic")).join(", ")}`
              : "Cell: unknown / absent",
            ...this.dataset!.warnings,
            ...f.warnings,
          ].join(" · ");
        } catch (e) {
          this.caption.textContent = `Frame ${this.cfg.frame} failed${this.displayedIndex !== undefined ? `; displayed frame ${this.displayedIndex}` : "; no frame displayed"}`;
          this.error(e);
        }
      }
    })().finally(() => {
      this.rendering = false;
    });
  }
  onunload() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer?.disconnect();
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    this.gate.dispose();
    this.loadAbort?.abort();
    this.rangeAbort?.abort();
    this.parser.dispose();
    this.controller?.dispose();
    void this.stream
      ?.dispose()
      .catch((e) => console.warn("AtomView file cleanup failed", e));
    this.stream = undefined;
    this.renderer?.pause();
    const renderer = this.renderer;
    void this.renderTask
      .finally(() => renderer?.dispose())
      .catch((e) => console.warn("AtomView renderer cleanup failed", e));
    this.dataset = undefined;
    this.plugin.widgets.delete(this);
    if (!this.released) {
      this.released = true;
      if (this.reserved) this.plugin.active--;
      this.plugin.memory -= this.memory;
      this.memory = 0;
      this.reserved = false;
    }
    this.containerEl.replaceChildren();
  }
}
class AtomFileView extends FileView {
  private widget?: AtomWidget;
  private independentSource?: string;
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: AtomViewPlugin,
  ) {
    super(leaf);
    this.allowNoFile = true;
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return (
      this.file?.name ?? this.independentSource?.split("/").pop() ?? "AtomView"
    );
  }
  getState() {
    return this.independentSource
      ? { source: this.independentSource }
      : super.getState();
  }
  async setState(state: Record<string, unknown>, result: ViewStateResult) {
    if (typeof state.source === "string") {
      const cfg = config({ source: state.source });
      await super.setState({}, result);
      this.clearWidget();
      this.independentSource = cfg.source;
      this.widget = this.addChild(
        new AtomWidget(this.contentEl, this.plugin, cfg),
      );
    } else {
      this.independentSource = undefined;
      await super.setState(state, result);
    }
  }
  async onLoadFile(file: TFile) {
    this.clearWidget();
    this.widget = this.addChild(
      new AtomWidget(
        this.contentEl,
        this.plugin,
        config({ source: file.path }),
      ),
    );
  }
  async onUnloadFile() {
    this.clearWidget();
  }
  private clearWidget() {
    if (this.widget) this.removeChild(this.widget);
    this.widget = undefined;
    this.contentEl.replaceChildren();
  }
  async onClose() {
    this.clearWidget();
  }
}
class SourceModal extends Modal {
  constructor(
    app: App,
    private plugin: AtomViewPlugin,
  ) {
    super(app);
  }
  onOpen() {
    el(this.contentEl, "h2", "Open local structure with AtomView");
    const input = el(this.contentEl, "input");
    input.placeholder = "Vault-root-relative path";
    input.style.width = "100%";
    const open = el(this.contentEl, "button", "Open");
    open.onclick = () => {
      try {
        const cfg = config({ source: input.value });
        this.close();
        void this.plugin.openSource(cfg.source);
      } catch (e) {
        new Notice(errorText(e));
      }
    };
    input.focus();
  }
}
class ExternalSourceModal extends Modal {
  constructor(
    app: App,
    private plugin: AtomViewPlugin,
  ) {
    super(app);
  }
  onOpen() {
    this.contentEl.classList.add("atomview-external-modal");
    el(this.contentEl, "h2", "Register one external file (read-only)");
    el(
      this.contentEl,
      "p",
      "Only this file will be allowed. AtomView will not copy or modify it. Its absolute path is stored in plugin settings on this device; copied blocks contain an opaque source ID. Cloud files must be downloaded locally.",
    );
    const input = el(this.contentEl, "input");
    input.placeholder = "Absolute local file path";
    input.style.width = "100%";
    const status = el(this.contentEl, "p");
    const button = el(this.contentEl, "button", "Register and open this file");
    button.onclick = async () => {
      button.disabled = true;
      try {
        const entry = await registerExternal(input.value);
        const bytes = crypto.getRandomValues(new Uint8Array(12));
        const existing = Object.entries(
          this.plugin.settings.externalSources ?? {},
        ).find(
          ([, v]) => v.path === entry.path && v.canonical === entry.canonical,
        )?.[0];
        const id =
          existing ??
          "external:" +
            [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
        this.plugin.settings.externalSources ??= {};
        this.plugin.settings.externalSources[id] = entry;
        await this.plugin.saveData(this.plugin.settings);
        this.close();
        await this.plugin.openSource(id);
      } catch (e) {
        status.textContent = errorText(e);
        button.disabled = false;
      }
    };
    input.focus();
  }
}
class SettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: AtomViewPlugin,
  ) {
    super(app, plugin);
  }
  display() {
    this.containerEl.replaceChildren();
    new Setting(this.containerEl)
      .setName("Automatically associate .data")
      .setDesc(
        "Off by default. Applies after plugin reload; file content is still validated as LAMMPS. Existing extension registrations are never overridden.",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoData).onChange(async (v) => {
          this.plugin.settings.autoData = v;
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
    for (const [id, entry] of Object.entries(
      this.plugin.settings.externalSources ?? {},
    )) {
      new Setting(this.containerEl)
        .setName(`External file: ${entry.canonical.split("/").pop()}`)
        .setDesc(`${id} · ${entry.canonical}`)
        .addButton((b) =>
          b.setButtonText("Revoke").onClick(async () => {
            delete this.plugin.settings.externalSources[id];
            await this.plugin.saveData(this.plugin.settings);
            await Promise.all(
              [...this.plugin.widgets].map((w) => w.revokeExternal(id)),
            );
            this.display();
          }),
        );
    }
  }
}
export default class AtomViewPlugin extends Plugin {
  readonly widgets = new Set<AtomWidget>();
  active = 0;
  memory = 0;
  settings: {
    autoData: boolean;
    externalSources: Record<string, RegisteredSource>;
  } = { autoData: false, externalSources: {} };
  async onload() {
    this.settings = { ...this.settings, ...(await this.loadData()) };
    this.registerView(VIEW, (leaf) => new AtomFileView(leaf, this));
    for (const extension of [
      "lammpstrj",
      "xyz",
      "extxyz",
      "pdb",
      "cif",
      "mmcif",
      ...(this.settings.autoData ? ["data"] : []),
    ]) {
      try {
        this.registerExtensions([extension], VIEW);
      } catch (e) {
        console.info(
          `AtomView left existing .${extension} association unchanged`,
          e,
        );
      }
    }
    this.registerMarkdownCodeBlockProcessor("atomview", (source, root, ctx) => {
      try {
        ctx.addChild(new AtomWidget(root, this, parseConfig(source)));
      } catch (e) {
        root.classList.add("atomview");
        el(
          root,
          "div",
          `AtomView configuration error: ${errorText(e)}`,
          "atomview-status",
        );
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (
          file instanceof TFile &&
          /\.(lammpstrj|data|xyz|extxyz|pdb|cif|mmcif)$/i.test(file.path)
        )
          menu.addItem((item) =>
            item
              .setTitle("Open with AtomView")
              .setIcon("atom")
              .onClick(() => void this.openSource(file.path)),
          );
      }),
    );
    this.addCommand({
      id: "open-local-structure",
      name: "Open with AtomView",
      callback: () => new SourceModal(this.app, this).open(),
    });
    this.addCommand({
      id: "register-external-source",
      name: "Register selected external file (read-only)",
      callback: () => new ExternalSourceModal(this.app, this).open(),
    });
    this.addSettingTab(new SettingsTab(this.app, this));
  }
  async openSource(source: string) {
    try {
      const leaf = this.app.workspace.getLeaf("tab");
      const file = this.app.vault.getAbstractFileByPath(source);
      if (file instanceof TFile) {
        await leaf.setViewState({
          type: VIEW,
          state: { file: source },
          active: true,
        });
      } else {
        await leaf.setViewState({
          type: VIEW,
          state: { source: config({ source }).source },
          active: true,
        });
      }
    } catch (e) {
      new Notice(errorText(e));
    }
  }
  onunload() {
    for (const widget of [...this.widgets]) widget.unload();
    this.app.workspace.detachLeavesOfType(VIEW);
    clearIndexCache();
  }
}
