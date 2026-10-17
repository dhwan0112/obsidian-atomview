import { Column } from "molstar/lib/mol-data/db.js";
import { CIF } from "molstar/lib/mol-io/reader/cif.js";
import { parsePDB } from "molstar/lib/mol-io/reader/pdb/parser.js";
import { Cell as SpacegroupCell } from "molstar/lib/mol-math/geometry/spacegroup/cell.js";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra.js";
import type { Atom, Cell, Dataset, Frame, V3 } from "../model.ts";
import { num, element, cart, LIMITS, validate } from "../model.ts";
const cifNum = (s: string) => num(s.replace(/\(\d+\)$/, ""), "CIF number");
function crystal(lengths: V3, angles: V3): Cell {
  if (lengths.some((x) => x <= 0) || angles.some((x) => x <= 0 || x >= 180))
    throw Error("Invalid crystal cell");
  const c = SpacegroupCell.create(
    Vec3.create(...lengths),
    Vec3.create(...(angles.map((x) => (x * Math.PI) / 180) as V3)),
  );
  const m = c.fromFractional;
  return {
    origin: [0, 0, 0],
    vectors: [
      [m[0], m[1], m[2]],
      [m[4], m[5], m[6]],
      [m[8], m[9], m[10]],
    ],
    pbc: [null, null, null],
  };
}
export async function pdb(text: string): Promise<Dataset> {
  const parsed = await parsePDB(text).run();
  if (parsed.isError) throw Error(parsed.message);
  // Mol* tokenizer supplies PDB records; retain exact IDs and Float64 fields rather than model Float32 buffers.
  const t = parsed.result.lines;
  const frames: Frame[] = [];
  let atoms: Atom[] = [];
  let cell: Cell | undefined;
  let model = "1";
  let explicit = false;
  let inModel = false;
  const finish = () => {
    if (atoms.length) {
      frames.push({
        atoms,
        cell,
        coordinateSet: "PDB Cartesian",
        warnings: [],
        metadata: {
          model,
          display: "deposited atoms; no biological/symmetry expansion",
        },
      });
      atoms = [];
    }
    if (frames.length > LIMITS.frames) throw Error("Frame limit");
  };
  for (let j = 0; j < t.count; j++) {
    const line = text.substring(t.indices[2 * j], t.indices[2 * j + 1]);
    const rec = line.slice(0, 6).trim();
    if (rec === "CRYST1") {
      cell = crystal(
        [
          num(line.slice(6, 15)),
          num(line.slice(15, 24)),
          num(line.slice(24, 33)),
        ],
        [
          num(line.slice(33, 40)),
          num(line.slice(40, 47)),
          num(line.slice(47, 54)),
        ],
      );
      continue;
    }
    if (rec === "MODEL") {
      if (inModel) throw Error("Nested MODEL");
      finish();
      model = line.slice(10, 14).trim() || String(frames.length + 1);
      explicit = true;
      inModel = true;
      continue;
    }
    if (rec === "ENDMDL") {
      if (!inModel) throw Error("Unexpected ENDMDL");
      finish();
      inModel = false;
      continue;
    }
    if (rec !== "ATOM" && rec !== "HETATM") continue;
    if (explicit && !inModel) throw Error("Atom outside MODEL");
    if (line.length < 54) throw Error("Truncated PDB atom record");
    if (atoms.length >= LIMITS.atoms) throw Error("Atom limit");
    const originalId = line.slice(6, 11).trim();
    if (!originalId) throw Error("Missing PDB serial");
    const alt = line.slice(16, 17).trim();
    const rawElement = line.slice(76, 78).trim();
    const canonical =
      rawElement.charAt(0).toUpperCase() + rawElement.slice(1).toLowerCase();
    const properties: Atom["properties"] = {
      atomName: line.slice(12, 16).trim(),
      residue: line.slice(17, 20).trim(),
      chain: line.slice(21, 22).trim(),
      residueId: line.slice(22, 26).trim(),
      insertionCode: line.slice(26, 27).trim(),
      altLoc: alt,
      serial: originalId,
    };
    for (const [key, start, end] of [
      ["occupancy", 54, 60],
      ["bFactor", 60, 66],
    ] as const) {
      const s = line.slice(start, end).trim();
      if (s) properties[key] = num(s, key);
    }
    atoms.push({
      id: originalId,
      element: element(canonical),
      position: [
        num(line.slice(30, 38)),
        num(line.slice(38, 46)),
        num(line.slice(46, 54)),
      ],
      properties,
    });
  }
  if (inModel) throw Error("Truncated PDB MODEL (missing ENDMDL)");
  finish();
  return validate({
    format: "pdb",
    frames,
    units: "angstrom (PDB specification)",
    warnings: [
      "Deposited atoms only; no bond inference, assembly or symmetry expansion. All model frames retained; altLoc and occupancy retained. Missing element fields remain unknown.",
    ],
  });
}
export async function cif(text: string): Promise<Dataset> {
  const parsed = await CIF.parseText(text).run();
  if (parsed.isError) throw Error(parsed.message);
  const blocks = parsed.result.blocks;
  if (blocks.length !== 1)
    throw Error("Exactly one CIF data block is supported");
  const b = blocks[0];
  const mm = !!b.categories.atom_site?.getField("Cartn_x");
  const f = (name: string) => {
    const [cat, field] = name.split(".");
    return b.categories[cat]?.getField(field ?? "");
  };
  const get = (name: string, i = 0, optional = false) => {
    const v = f(name);
    if (!v || v.valueKind(i) !== Column.ValueKind.Present) {
      if (optional) return undefined;
      throw Error(`Missing CIF field ${name}`);
    }
    return v.str(i);
  };
  const cellValues = [
    "length_a",
    "length_b",
    "length_c",
    "angle_alpha",
    "angle_beta",
    "angle_gamma",
  ].map((k) => get(mm ? `cell.${k}` : `cell_${k}`, 0, true));
  let cell: Cell | undefined;
  if (cellValues.some((x) => x !== undefined)) {
    if (cellValues.some((x) => x === undefined))
      throw Error("Incomplete CIF cell");
    cell = crystal(
      cellValues.slice(0, 3).map((x) => cifNum(x!)) as V3,
      cellValues.slice(3).map((x) => cifNum(x!)) as V3,
    );
  }
  const prefix = mm ? "atom_site." : "atom_site_";
  const xs = mm
    ? ["Cartn_x", "Cartn_y", "Cartn_z"]
    : ["fract_x", "fract_y", "fract_z"];
  const field = f(prefix + xs[0]);
  if (!field || !field.rowCount || field.rowCount > LIMITS.atoms)
    throw Error("Missing/oversized CIF atom table");
  if (!mm && !cell) throw Error("coreCIF fractional coordinates require cell");
  const firstModel = mm
    ? get(prefix + "pdbx_PDB_model_num", 0, true)
    : undefined;
  const atoms: Atom[] = [];
  for (let i = 0; i < field.rowCount; i++) {
    if (mm && get(prefix + "pdbx_PDB_model_num", i, true) !== firstModel)
      continue;
    const raw = xs.map((k) => cifNum(get(prefix + k, i)!)) as V3;
    const originalId = get(prefix + (mm ? "id" : "label"), i)!;
    const type = get(prefix + "type_symbol", i, true);
    const properties: Atom["properties"] = {};
    for (const key of mm
      ? [
          "label_atom_id",
          "label_comp_id",
          "label_asym_id",
          "auth_asym_id",
          "auth_seq_id",
          "label_alt_id",
          "pdbx_PDB_model_num",
        ]
      : ["disorder_group", "disorder_assembly"]) {
      const v = get(prefix + key, i, true);
      if (v !== undefined) properties[key] = v;
    }
    for (const key of [
      "occupancy",
      ...(mm ? ["B_iso_or_equiv"] : ["U_iso_or_equiv"]),
    ]) {
      const v = get(prefix + key, i, true);
      if (v !== undefined) properties[key] = cifNum(v);
    }
    if (!mm) properties.fractional = raw;
    atoms.push({
      id: originalId,
      element: type ? element(type) : undefined,
      type: undefined,
      position: mm ? raw : cart(cell!, raw),
      properties,
    });
  }
  // Keep original categories and values, including symmetry/disorder data, in structured metadata.
  const metadata: Record<string, unknown> = {
    kind: mm ? "mmCIF" : "coreCIF",
    display: "asymmetric unit (unexpanded)",
    categories: Object.fromEntries(
      b.categoryNames.map((n) => {
        const c = b.categories[n];
        return [
          n,
          Object.fromEntries(
            c.fieldNames.map((k) => [
              k,
              Array.from(c.getField(k)!.toStringArray()),
            ]),
          ),
        ];
      }),
    ),
  };
  return validate({
    format: "cif",
    frames: [
      {
        atoms,
        cell,
        coordinateSet: mm
          ? "Cartn Cartesian"
          : "fractional → Cartesian (Float64)",
        metadata,
        warnings: [],
      },
    ],
    units: "angstrom (CIF specification)",
    warnings: [
      "Asymmetric unit only; symmetry expansion is not performed. Occupancy/disorder retained; sites are displayed as listed, not a complete symmetry-expanded crystal.",
      ...(mm
        ? [
            "mmCIF: first deposited model only; model number retained in atom properties. Other models are not shown.",
          ]
        : []),
    ],
  });
}
