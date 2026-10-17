export type V3 = [number, number, number];
/** Cell vectors are rows [a,b,c]. Cartesian = origin + sx*a + sy*b + sz*c. */
export interface Cell {
  origin: V3;
  vectors: [V3, V3, V3];
  pbc: [boolean | null, boolean | null, boolean | null];
}
export interface Atom {
  id: string;
  type?: string;
  element?: string;
  position: V3;
  properties: Record<string, number | string | number[] | string[]>;
}
export interface Frame {
  atoms: Atom[];
  cell?: Cell;
  timestep?: string;
  coordinateSet: string;
  warnings: string[];
  metadata: Record<string, unknown>;
}
export interface Dataset {
  format: Format;
  frames: Frame[];
  units: string;
  warnings: string[];
  topology?: unknown;
}
export type Format = "lammps-dump" | "lammps-data" | "xyz" | "pdb" | "cif";
export const LIMITS = {
  bytes: 16 * 1024 * 1024,
  atoms: 50000,
  frames: 500,
  totalAtoms: 250000,
  cacheBytes: 128 * 1024 * 1024,
};
export function num(s: string, context = "number"): number {
  if (
    !s?.trim() ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s.trim()) ||
    !Number.isFinite(Number(s))
  )
    throw Error(`Invalid ${context}: ${s}`);
  return Number(s);
}
export function integer(s: string, context = "count"): number {
  const n = num(s, context);
  if (!Number.isSafeInteger(n) || n < 0) throw Error(`Invalid ${context}`);
  return n;
}
export function id(s: string): string {
  if (!/^\d+$/.test(s) || BigInt(s) <= 0n) throw Error(`Invalid atom ID: ${s}`);
  return BigInt(s).toString();
}
export function cart(cell: Cell, s: V3): V3 {
  return [0, 1, 2].map(
    (k) =>
      cell.origin[k] + s.reduce((v, x, j) => v + x * cell.vectors[j][k], 0),
  ) as V3;
}
export function validate(d: Dataset): Dataset {
  if (!d.frames.length || d.frames.length > LIMITS.frames)
    throw Error("Frame count exceeds limit or no frames");
  let total = 0;
  let previous: Set<string> | undefined;
  for (const f of d.frames) {
    if (!f.atoms.length || f.atoms.length > LIMITS.atoms)
      throw Error("Atom count exceeds limit or zero atoms");
    total += f.atoms.length;
    if (f.cell) {
      const {
        origin,
        vectors: [a, b, c],
      } = f.cell;
      if (![...origin, ...a, ...b, ...c].every(Number.isFinite))
        throw Error("Invalid cell numbers");
      const det =
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0]);
      if (
        !Number.isFinite(det) ||
        Math.abs(det) <=
          16 *
            Number.EPSILON *
            Math.hypot(...a) *
            Math.hypot(...b) *
            Math.hypot(...c)
      )
        throw Error("Degenerate simulation cell");
    }
    const ids = new Set<string>();
    for (const a of f.atoms) {
      if (ids.has(a.id)) throw Error(`Duplicate atom ID ${a.id}`);
      ids.add(a.id);
      if (!a.position.every(Number.isFinite)) throw Error("Invalid coordinate");
    }
    if (
      previous &&
      (ids.size !== previous.size || [...ids].some((x) => !previous!.has(x)))
    )
      f.warnings.push(
        "Atom ID set changed; no cross-frame atom correspondence",
      );
    previous = ids;
  }
  if (total > LIMITS.totalAtoms) throw Error("Trajectory atom budget exceeded");
  return d;
}
export const ELEMENTS = new Set(
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(
    " ",
  ),
);
export function element(s: string): string | undefined {
  return ELEMENTS.has(s) ? s : undefined;
}

/** Derived storage estimate; not source metadata and not serialized view state. */
export const estimatedFrameBytes = new WeakMap<Frame, number>();
