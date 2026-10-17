import {
  Canvas3D,
  Canvas3DContext,
} from "molstar/lib/mol-canvas3d/canvas3d.js";
import { resizeCanvas } from "molstar/lib/mol-canvas3d/util.js";
import { AssetManager } from "molstar/lib/mol-util/assets.js";
import { Shape, ShapeGroup } from "molstar/lib/mol-model/shape.js";
import { ShapeRepresentation } from "molstar/lib/mol-repr/shape/representation.js";
import { Mesh } from "molstar/lib/mol-geo/geometry/mesh/mesh.js";
import { MeshBuilder } from "molstar/lib/mol-geo/geometry/mesh/mesh-builder.js";
import { Spheres } from "molstar/lib/mol-geo/geometry/spheres/spheres.js";
import { SpheresBuilder } from "molstar/lib/mol-geo/geometry/spheres/spheres-builder.js";
import { addSimpleCylinder } from "molstar/lib/mol-geo/geometry/mesh/builder/cylinder.js";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra.js";
import { Sphere3D } from "molstar/lib/mol-math/geometry.js";
import { OrderedSet } from "molstar/lib/mol-data/int.js";
import { Color } from "molstar/lib/mol-util/color/index.js";
import type { Frame, V3 } from "./model.ts";
import { cart } from "./model.ts";
import type { ViewConfig } from "./config.ts";
import { scalar } from "./controller.ts";
const palette: Record<string, number> = {
  H: 0xffffff,
  C: 0x666666,
  N: 0x3050f8,
  O: 0xe84040,
  Fe: 0xdf8533,
  S: 0xead534,
  P: 0xff8030,
  Si: 0xc6a599,
  Cl: 0x30cc30,
};
function categorical(key: string): number {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const colors = [0x4287cf, 0xe88a38, 0x44b482, 0xa57acd, 0xd8648c, 0xc4b34c];
  return colors[h % colors.length];
}
export function scalarColor(v: number, [lo, hi]: [number, number]): number {
  const t = hi === lo ? 0.5 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const r = Math.round(255 * t),
    b = Math.round(255 * (1 - t)),
    g = Math.round(80 + 100 * (1 - Math.abs(2 * t - 1)));
  return (r << 16) | (g << 8) | b;
}
interface Scene {
  frame: Frame;
  config: ViewConfig;
  range?: [number, number];
}
export class MolstarAdapter {
  private readonly assets = new AssetManager();
  private readonly context: Canvas3DContext;
  readonly canvas3d: Canvas3D;
  private readonly representation = ShapeRepresentation<
    Scene,
    Mesh,
    typeof Mesh.Params
  >(
    (_ctx, d, _props, previous) => this.shape(d, previous?.geometry),
    Mesh.Utils,
  );
  private readonly atomsRepresentation = ShapeRepresentation<
    Scene,
    Spheres,
    typeof Spheres.Params
  >(
    (_ctx, d, _props, previous) => this.spheres(d, previous?.geometry),
    Spheres.Utils,
  );
  private readonly resize: ResizeObserver;
  private readonly subscription: { unsubscribe(): void };
  private disposed = false;
  private scene?: Scene;
  private selected?: (id: string) => void;
  constructor(
    private readonly container: HTMLDivElement,
    onSelect: (id: string) => void,
  ) {
    const canvas = container.createEl("canvas");
    canvas.setAttribute(
      "aria-label",
      "AtomView 3D structure: drag to rotate, right drag to pan, wheel to zoom",
    );
    container.append(canvas);
    resizeCanvas(canvas, container);
    this.context = Canvas3DContext.fromCanvas(canvas, this.assets, {
      handleResize: () => this.canvas3d?.requestResize(),
    });
    this.canvas3d = Canvas3D.create(this.context);
    this.canvas3d.setProps({
      renderer: { backgroundColor: Color(0x18212b) },
      camera: { helper: { axes: { name: "off", params: {} } } },
    });
    this.selected = onSelect;
    this.subscription = this.canvas3d.interaction.click.subscribe((e) => {
      const loci = e.current.loci;
      if (ShapeGroup.isLoci(loci) && loci.groups.length) {
        const i = OrderedSet.getAt(loci.groups[0].ids, 0);
        const atom = this.scene?.frame.atoms[i];
        if (atom) this.selected?.(atom.id);
      }
    });
    this.resize = new ResizeObserver(() => {
      if (container.clientWidth < 1 || container.clientHeight < 1) {
        this.canvas3d.pause(true);
        return;
      }
      resizeCanvas(canvas, container);
      this.canvas3d.handleResize();
    });
    this.resize.observe(container);
    this.canvas3d.animate();
  }
  private shape(d: Scene, previousMesh?: Mesh): Shape<Mesh> {
    const { frame, config } = d;
    // ShapeRepresentation retains GPU ValueCell bindings across updates.
    // Reuse the previous Mesh so its vertex/normal/group/index cells are updated.
    const b = MeshBuilder.createState(2048, 1024, previousMesh);
    const pos = (p: V3) => Vec3.create(...p);
    if (config.showCell && frame.cell) {
      b.currentGroup = frame.atoms.length;
      const corners = Array.from({ length: 8 }, (_, i) =>
        cart(frame.cell!, [i & 1 ? 1 : 0, i & 2 ? 1 : 0, i & 4 ? 1 : 0]),
      );
      for (let i = 0; i < 8; i++)
        for (const bit of [1, 2, 4])
          if (!(i & bit))
            addSimpleCylinder(b, pos(corners[i]), pos(corners[i | bit]), {
              radiusTop: 0.035,
              radiusBottom: 0.035,
              radialSegments: 6,
            });
    }
    const mesh = MeshBuilder.getMesh(b);
    return Shape.create(
      "AtomView local structure",
      d,
      mesh,
      () => Color(0xb8c7d6),
      () => 1,
      (i) => (frame.atoms[i] ? `Atom ${frame.atoms[i].id}` : "Cell wireframe"),
    );
  }
  private spheres(d: Scene, previous?: Spheres): Shape<Spheres> {
    const { frame, config } = d;
    const builder = SpheresBuilder.create(frame.atoms.length, 1024, previous);
    const values = !["element", "type"].includes(config.colorBy)
      ? scalar(frame, { property: config.colorBy, component: config.component })
      : undefined;
    const elements = frame.atoms.map(
      (a) => a.element ?? (a.type ? config.elementMap[a.type] : undefined),
    );
    const colors = frame.atoms.map((a, i) => {
      const element = elements[i];
      const atomColor =
        a.id === config.selectedId
          ? 0xffff00
          : values
            ? scalarColor(values[i], d.range!)
            : config.colorBy === "type"
              ? categorical(a.type ?? element ?? "unknown")
              : element
                ? (palette[element] ?? categorical(element))
                : categorical(a.type ?? "unknown");
      return Color(atomColor);
    });
    for (let i = 0; i < frame.atoms.length; i++) {
      const p = frame.atoms[i].position;
      builder.add(p[0], p[1], p[2], i);
    }
    const geometry = builder.getSpheres();
    // Mol* excludes padding for a zero-radius point cloud. A single atom still
    // has a display radius and must participate in camera fit/clipping.
    if (geometry.boundingSphere.radius < 0.45)
      geometry.setBoundingSphere(
        Sphere3D.create(Vec3.clone(geometry.boundingSphere.center), 0.45),
      );
    return Shape.create(
      "AtomView spheres",
      d,
      geometry,
      (i) => colors[i],
      (i) => (elements[i] === "H" ? 0.24 : 0.45),
      (i) => `Atom ${frame.atoms[i]?.id}`,
    );
  }
  async show(
    frame: Frame,
    config: ViewConfig,
    range?: [number, number],
    fit = false,
  ) {
    if (this.disposed) return;
    this.scene = { frame, config, range };
    await this.atomsRepresentation
      .createOrUpdate({ alpha: 1, sizeFactor: 1, lodLevels: [] }, this.scene)
      .run();
    if (config.showCell && frame.cell)
      await this.representation.createOrUpdate({ alpha: 1 }, this.scene).run();
    if (this.disposed) return;
    this.canvas3d.add(this.atomsRepresentation);
    if (config.showCell && frame.cell) this.canvas3d.add(this.representation);
    else this.canvas3d.remove(this.representation);
    if (fit) this.fit();
  }
  fit() {
    this.canvas3d.requestCameraReset({ durationMs: 0 });
  }
  camera(): ViewConfig["camera"] {
    return structuredClone(this.canvas3d.camera.getSnapshot());
  }
  restore(camera: NonNullable<ViewConfig["camera"]>) {
    this.canvas3d.camera.setState(
      {
        ...camera,
        position: Vec3.create(...(camera.position as V3)),
        target: Vec3.create(...(camera.target as V3)),
        up: Vec3.create(...(camera.up as V3)),
      },
      0,
    );
  }
  pause() {
    this.canvas3d.pause(true);
  }
  resume() {
    if (!this.disposed) this.canvas3d.animate();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.selected = undefined;
    const steps = [
      () => this.subscription.unsubscribe(),
      () => this.resize.disconnect(),
      () => this.canvas3d.remove(this.representation),
      () => this.canvas3d.remove(this.atomsRepresentation),
      () => this.atomsRepresentation.destroy(),
      () => this.representation.destroy(),
      () => this.canvas3d.dispose(),
      () => this.context.dispose(),
      () => this.assets.dispose(),
      () => this.container.replaceChildren(),
    ];
    for (const cleanup of steps) {
      try {
        cleanup();
      } catch (e) {
        console.warn("AtomView resource cleanup failed", e);
      }
    }
  }
}
