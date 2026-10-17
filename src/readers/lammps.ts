import type { Atom, Cell, Dataset, Frame, V3 } from "../model.ts";
import { cart, num, integer, id, element, LIMITS } from "../model.ts";
const words = (s: string) => s.trim().split(/\s+/);
export function dump(text: string): Dataset {
  const lines = text.trim().split(/\r?\n/);
  let p = 0,
    total = 0;
  const frames: Frame[] = [];
  const take = () => {
    if (p >= lines.length) throw Error("Truncated dump");
    return lines[p++].trim();
  };
  while (p < lines.length) {
    if (frames.length >= LIMITS.frames) throw Error("Frame limit exceeded");
    if (take() !== "ITEM: TIMESTEP") throw Error("Expected ITEM: TIMESTEP");
    const timestep = take();
    if (!/^-?\d+$/.test(timestep)) throw Error("Invalid timestep");
    if (take() !== "ITEM: NUMBER OF ATOMS") throw Error("Missing atom count");
    const n = integer(take());
    if (!n || n > LIMITS.atoms) throw Error("Atom limit exceeded");
    total += n;
    if (total > LIMITS.totalAtoms)
      throw Error("Trajectory atom budget exceeded");
    const header = take();
    if (!header.startsWith("ITEM: BOX BOUNDS")) throw Error("Missing box");
    if (/\b(abc|origin)\b/.test(header))
      throw Error("General triclinic dump is unsupported");
    const tokens = words(header).slice(3);
    const tric = tokens.includes("xy");
    if (tric && !["xy", "xz", "yz"].every((x) => tokens.includes(x)))
      throw Error("Incomplete tilt header");
    const bounds = [
      words(take()).map((x) => num(x)),
      words(take()).map((x) => num(x)),
      words(take()).map((x) => num(x)),
    ];
    if (bounds.some((x) => x.length !== (tric ? 3 : 2)))
      throw Error("Invalid bounds");
    const [xb, yb, zb] = bounds;
    const xy = tric ? xb[2] : 0,
      xz = tric ? yb[2] : 0,
      yz = tric ? zb[2] : 0;
    const xlo = xb[0] - Math.min(0, xy, xz, xy + xz),
      xhi = xb[1] - Math.max(0, xy, xz, xy + xz),
      ylo = yb[0] - Math.min(0, yz),
      yhi = yb[1] - Math.max(0, yz);
    if (xhi <= xlo || yhi <= ylo || zb[1] <= zb[0])
      throw Error("Invalid cell lengths");
    const bc = tokens.filter((x) => /^[pfsm]{2}$/.test(x));
    const cell: Cell = {
      origin: [xlo, ylo, zb[0]],
      vectors: [
        [xhi - xlo, 0, 0],
        [xy, yhi - ylo, 0],
        [xz, yz, zb[1] - zb[0]],
      ],
      pbc: [0, 1, 2].map((k) => (bc[k] ? bc[k] === "pp" : null)) as Cell["pbc"],
    };
    const ah = take();
    if (!ah.startsWith("ITEM: ATOMS ")) throw Error("Missing atom columns");
    const cols = words(ah).slice(2);
    if (new Set(cols).size !== cols.length) throw Error("Duplicate column");
    const sets = [
      ["xu", "yu", "zu"],
      ["xsu", "ysu", "zsu"],
      ["x", "y", "z"],
      ["xs", "ys", "zs"],
    ];
    const chosen = sets.find((s) => s.every((x) => cols.includes(x)));
    if (!chosen) throw Error("No supported complete coordinate set");
    const warnings: string[] = [];
    if (!cols.includes("id"))
      warnings.push(
        "No IDs: row-order correspondence assumed; identity tracking is not guaranteed",
      );
    if (sets.filter((s) => s.every((x) => cols.includes(x))).length > 1)
      warnings.push(
        `Multiple coordinate sets: using ${chosen.join(" ")} (priority xu, xsu, x, xs)`,
      );
    const atoms: Atom[] = [];
    for (let i = 0; i < n; i++) {
      const row = words(take());
      if (row.length !== cols.length) throw Error("Atom column count mismatch");
      const r = Object.fromEntries(cols.map((c, j) => [c, row[j]]));
      const properties: Atom["properties"] = {};
      for (const c of cols) {
        if (c === "id" || c === "type" || c === "element") continue;
        properties[c] = num(r[c], c);
        if (["ix", "iy", "iz"].includes(c) && !Number.isInteger(properties[c]))
          throw Error("Invalid image flag");
      }
      for (const [v, cs] of [
        ["force", ["fx", "fy", "fz"]],
        ["velocity", ["vx", "vy", "vz"]],
      ] as const)
        if (cs.every((c) => r[c] !== undefined))
          properties[v] = cs.map((c) => num(r[c]));
      const raw = chosen.map((c) => num(r[c])) as V3;
      const position =
        chosen[0] === "xs" || chosen[0] === "xsu" ? cart(cell, raw) : raw;
      atoms.push({
        id: r.id ? id(r.id) : `row:${i}`,
        type: r.type,
        element: r.element ? element(r.element) : undefined,
        position,
        properties,
      });
    }
    frames.push({
      atoms,
      cell,
      timestep,
      coordinateSet: chosen.join(" "),
      warnings,
      metadata: { columns: cols, boundary: bc },
    });
  }
  return {
    format: "lammps-dump",
    frames,
    units: "unknown",
    warnings: ["LAMMPS units unknown. No inferred bonds."],
  };
}
export function data(text: string, style?: string): Dataset {
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => /^ITEM:/.test(l)))
    throw Error("Not a LAMMPS data file");
  let count: number | undefined;
  const bounds: Record<string, number[]> = {};
  const sections: Record<string, { hint: string; rows: string[] }> = {};
  let section = "";
  let tilt = [0, 0, 0];
  for (const line of lines.slice(1)) {
    const clean = line.split("#")[0].trim();
    if (!clean) continue;
    if (/^\d+\s+atoms$/.test(clean)) {
      count = integer(words(clean)[0]);
      continue;
    }
    const b = clean.match(/^(\S+)\s+(\S+)\s+([xyz])lo\s+\3hi$/);
    if (b) {
      bounds[b[3]] = [num(b[1]), num(b[2])];
      continue;
    }
    if (/\sxy\s+xz\s+yz$/.test(clean)) {
      tilt = words(clean)
        .slice(0, 3)
        .map((x) => num(x));
      continue;
    }
    if (/^[A-Za-z]/.test(clean)) {
      section = clean;
      sections[section] = { hint: line.split("#")[1]?.trim() ?? "", rows: [] };
      continue;
    }
    if (section) sections[section].rows.push(clean);
  }
  if (!count || count > LIMITS.atoms || !sections.Atoms)
    throw Error("Not a supported LAMMPS data file: missing atoms/count");
  const hint = sections.Atoms.hint.split(/\s/)[0];
  if (style && hint && style !== hint)
    throw Error("Atom style conflicts with Atoms hint");
  style = style || hint;
  if (!["atomic", "charge", "full"].includes(style ?? ""))
    throw Error("Explicit supported atom style required: atomic, charge, full");
  if (sections.Atoms.rows.length !== count) throw Error("Atom count mismatch");
  if (!["x", "y", "z"].every((x) => bounds[x])) throw Error("Missing bounds");
  const [x, y, z] = ["x", "y", "z"].map((k) => bounds[k]);
  if ([x, y, z].some((b) => b[1] <= b[0])) throw Error("Invalid bounds");
  const cell: Cell = {
    origin: [x[0], y[0], z[0]],
    vectors: [
      [x[1] - x[0], 0, 0],
      [tilt[0], y[1] - y[0], 0],
      [tilt[1], tilt[2], z[1] - z[0]],
    ],
    pbc: [null, null, null],
  };
  const masses: Record<string, number> = {};
  for (const line of sections.Masses?.rows ?? []) {
    const r = words(line);
    masses[r[0]] = num(r[1]);
  }
  const atoms = sections.Atoms.rows.map((line) => {
    const r = words(line);
    const base = style === "full" ? 7 : style === "charge" ? 6 : 5;
    if (r.length !== base && r.length !== base + 3)
      throw Error("Invalid Atoms row");
    const type = r[style === "full" ? 2 : 1];
    const offset = base - 3;
    const properties: Atom["properties"] = {};
    if (style === "full") {
      if (!/^\d+$/.test(r[1])) throw Error("Invalid molecule ID");
      properties.moleculeId = BigInt(r[1]).toString();
    }
    if (style !== "atomic") properties.q = num(r[offset - 1]);
    if (masses[type] !== undefined) properties.mass = masses[type];
    if (r.length === base + 3) {
      properties.image = r.slice(base).map((x) => {
        const n = num(x);
        if (!Number.isInteger(n)) throw Error("Invalid image flag");
        return n;
      });
    }
    return {
      id: id(r[0]),
      type,
      position: r.slice(offset, offset + 3).map((x) => num(x)) as V3,
      properties,
    };
  });
  return {
    format: "lammps-data",
    units: "unknown",
    frames: [
      {
        atoms,
        cell,
        coordinateSet: "Cartesian",
        warnings: [],
        metadata: {
          style,
          masses,
          sections: Object.keys(sections),
          uninterpretedSections: Object.fromEntries(
            Object.entries(sections).filter(
              ([k]) => !["Atoms", "Masses"].includes(k),
            ),
          ),
        },
      },
    ],
    topology: sections.Bonds?.rows,
    warnings: [
      "PBC and units unknown. Masses do not establish elements.",
      ...(sections.Bonds
        ? [
            "Bonds preserved as raw records; topology is not interpreted or rendered.",
          ]
        : []),
      "No inferred bonds.",
      ...(Object.keys(sections).filter(
        (k) => !["Atoms", "Masses", "Bonds"].includes(k),
      ).length
        ? [
            "Additional data sections preserved as raw metadata, not interpreted.",
          ]
        : []),
    ],
  };
}
