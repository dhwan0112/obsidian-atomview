import type { Format } from "./model.ts";
import { ELEMENTS } from "./model.ts";
export interface ViewConfig {
  schemaVersion: 1;
  source: string;
  format?: Format;
  frame: number;
  representation: "spheres";
  colorBy: string;
  component?: number | "magnitude";
  showCell: boolean;
  elementMap: Record<string, string>;
  height: number;
  rangeMode: "fixed" | "frame";
  colorRange?: [number, number];
  atomStyle?: "atomic" | "charge" | "full";
  selectedId?: string;
  camera?: {
    position: number[];
    target: number[];
    up: number[];
    radius: number;
    radiusMax: number;
    mode: "perspective" | "orthographic";
    fov: number;
    fog: number;
    clipFar: boolean;
    minNear: number;
    minFar: number;
  };
}
export function sourcePath(source: string): string {
  if (/^external:[a-f0-9]{24}$/.test(source)) return source;
  if (
    !source ||
    source.includes("\0") ||
    source.includes("\\") ||
    source.startsWith("/") ||
    /^[a-z]+:/i.test(source)
  )
    throw Error("source must be a vault-root-relative path");
  const parts = source.split("/");
  if (parts.some((p) => p === ".." || p === "" || p === "."))
    throw Error("Path traversal or non-normalized source is forbidden");
  return parts.join("/");
}
const keys = new Set([
  "schemaVersion",
  "source",
  "format",
  "frame",
  "representation",
  "colorBy",
  "component",
  "showCell",
  "elementMap",
  "height",
  "rangeMode",
  "colorRange",
  "atomStyle",
  "selectedId",
  "camera",
]);
export function config(raw: unknown): ViewConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Expected YAML mapping");
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r))
    if (!keys.has(k)) throw Error(`Unknown atomview option: ${k}`);
  if (typeof r.source !== "string") throw Error("source is required");
  const source = sourcePath(r.source);
  if (r.schemaVersion !== undefined && r.schemaVersion !== 1)
    throw Error("Unsupported schemaVersion");
  if (
    r.format !== undefined &&
    !["lammps-dump", "lammps-data", "xyz", "pdb", "cif"].includes(
      String(r.format),
    )
  )
    throw Error("Unsupported format");
  const frame = r.frame ?? 0,
    height = r.height ?? 420;
  if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0)
    throw Error("frame must be a nonnegative 0-based integer");
  if (
    typeof height !== "number" ||
    !Number.isInteger(height) ||
    height < 180 ||
    height > 1600
  )
    throw Error("height must be 180–1600");
  if (r.representation !== undefined && r.representation !== "spheres")
    throw Error("Only spheres representation is supported");
  if (r.showCell !== undefined && typeof r.showCell !== "boolean")
    throw Error("showCell must be boolean");
  const map = r.elementMap ?? {};
  if (!map || typeof map !== "object" || Array.isArray(map))
    throw Error("elementMap must be a mapping");
  for (const [k, v] of Object.entries(map))
    if (!k || typeof v !== "string" || !ELEMENTS.has(v))
      throw Error(`Invalid elementMap entry ${k}`);
  if (r.colorBy !== undefined && (typeof r.colorBy !== "string" || !r.colorBy))
    throw Error("colorBy must be a nonempty string");
  if (
    r.component !== undefined &&
    r.component !== "magnitude" &&
    (typeof r.component !== "number" ||
      !Number.isInteger(r.component) ||
      r.component < 0)
  )
    throw Error("Invalid vector component");
  if (
    r.rangeMode !== undefined &&
    !["frame", "fixed"].includes(String(r.rangeMode))
  )
    throw Error("rangeMode must be fixed or frame");
  const colorRange = r.colorRange;
  if (
    colorRange !== undefined &&
    (!Array.isArray(colorRange) ||
      colorRange.length !== 2 ||
      !colorRange.every((x) => typeof x === "number" && Number.isFinite(x)) ||
      colorRange[0] > colorRange[1])
  )
    throw Error("Invalid colorRange");
  if (
    r.atomStyle !== undefined &&
    !["atomic", "charge", "full"].includes(String(r.atomStyle))
  )
    throw Error("Unsupported atomStyle");
  if (r.selectedId !== undefined && typeof r.selectedId !== "string")
    throw Error("selectedId must be a string");
  if (r.camera !== undefined) {
    if (!r.camera || typeof r.camera !== "object")
      throw Error("Invalid camera");
    const c = r.camera as Record<string, unknown>;
    for (const k of ["position", "target", "up"]) {
      const v = c[k];
      if (
        !Array.isArray(v) ||
        v.length !== 3 ||
        !v.every((x) => typeof x === "number" && Number.isFinite(x))
      )
        throw Error(`Invalid camera ${k}`);
    }
    for (const k of ["radius", "radiusMax", "fov", "fog", "minNear", "minFar"])
      if (typeof c[k] !== "number" || !Number.isFinite(c[k]))
        throw Error(`Invalid camera ${k}`);
    if (
      !["perspective", "orthographic"].includes(String(c.mode)) ||
      typeof c.clipFar !== "boolean"
    )
      throw Error("Invalid camera mode");
  }
  return {
    schemaVersion: 1,
    source,
    format: r.format as Format | undefined,
    frame,
    representation: "spheres",
    colorBy: (r.colorBy as string) ?? "element",
    component: r.component as ViewConfig["component"],
    showCell: (r.showCell as boolean) ?? true,
    elementMap: { ...map } as Record<string, string>,
    height,
    rangeMode: (r.rangeMode as ViewConfig["rangeMode"]) ?? "fixed",
    colorRange: colorRange as [number, number] | undefined,
    atomStyle: r.atomStyle as ViewConfig["atomStyle"],
    selectedId: r.selectedId as string | undefined,
    camera: r.camera as ViewConfig["camera"],
  };
}
/** JSON is valid YAML 1.2 and preserves arbitrary property names and camera precision. */
export function serialize(c: ViewConfig): string {
  return "```atomview\n" + JSON.stringify(config(c), null, 2) + "\n```";
}
