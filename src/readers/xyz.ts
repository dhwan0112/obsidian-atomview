import type { Atom, Cell, Dataset, Frame, V3 } from "../model.ts";
import { num, integer, element, LIMITS } from "../model.ts";
export function xyz(text: string): Dataset {
  const lines = text.split(/\r?\n/);
  let p = 0,
    total = 0;
  const frames: Frame[] = [];
  while (p < lines.length) {
    if (!lines[p].trim()) {
      p++;
      continue;
    }
    if (frames.length >= LIMITS.frames) throw Error("Frame limit exceeded");
    const n = integer(lines[p++]);
    if (n < 1 || n > LIMITS.atoms) throw Error("Atom limit");
    total += n;
    if (total > LIMITS.totalAtoms)
      throw Error("Trajectory atom budget exceeded");
    const comment = lines[p++];
    if (comment === undefined) throw Error("Truncated XYZ header");
    const header: Record<string, string> = {};
    const re = /(\w+)=("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(comment))) {
      if (header[m[1]] !== undefined) throw Error("Duplicate extended XYZ key");
      header[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
    const extended = /\b(Properties|Lattice|pbc)\s*=/.test(comment);
    if (extended && !header.Properties)
      throw Error("Extended XYZ requires explicit Properties");
    let cell: Cell | undefined;
    if (header.Lattice) {
      const v = header.Lattice.trim()
        .split(/\s+/)
        .map((x) => num(x));
      if (v.length !== 9) throw Error("Lattice requires 9 numbers");
      cell = {
        origin: [0, 0, 0],
        vectors: [
          v.slice(0, 3) as V3,
          v.slice(3, 6) as V3,
          v.slice(6, 9) as V3,
        ],
        pbc: [null, null, null],
      };
    }
    if (header.pbc) {
      if (!cell) throw Error("pbc without Lattice");
      const b = header.pbc.split(/\s+/);
      if (
        b.length !== 3 ||
        b.some((x) => !["T", "F", "true", "false", "1", "0"].includes(x))
      )
        throw Error("Invalid pbc");
      cell.pbc = b.map((x) => ["T", "true", "1"].includes(x)) as Cell["pbc"];
    }
    const decl = (header.Properties ?? "species:S:1:pos:R:3").split(":");
    if (decl.length % 3) throw Error("Invalid Properties declaration");
    const specs: { name: string; kind: string; n: number }[] = [];
    for (let k = 0; k < decl.length; k += 3) {
      const size = integer(decl[k + 2]);
      if (!["R", "I", "S", "L"].includes(decl[k + 1]) || size < 1 || size > 16)
        throw Error("Unsupported property declaration");
      specs.push({ name: decl[k], kind: decl[k + 1], n: size });
    }
    if (
      new Set(specs.map((x) => x.name)).size !== specs.length ||
      !specs.some((x) => x.name === "species" && x.n === 1 && x.kind === "S") ||
      !specs.some((x) => x.name === "pos" && x.n === 3 && x.kind === "R")
    )
      throw Error("Properties require species:S:1 and pos:R:3");
    const atoms: Atom[] = [];
    for (let i = 0; i < n; i++) {
      if (p >= lines.length || !lines[p].trim())
        throw Error("Truncated XYZ frame");
      const row = lines[p++].trim().split(/\s+/);
      if (row.length !== specs.reduce((v, s) => v + s.n, 0))
        throw Error("XYZ column count mismatch");
      let k = 0;
      const props: Atom["properties"] = {};
      let position: V3 = [0, 0, 0],
        species = "",
        atomId = `row:${i}`;
      for (const s of specs) {
        const raw = row.slice(k, k + s.n);
        k += s.n;
        if (s.name === "id") {
          if (s.n !== 1) throw Error("ID must be scalar");
          if (!/^[+-]?\d+$/.test(raw[0])) throw Error("Invalid XYZ ID");
          atomId = BigInt(raw[0]).toString();
          props.id = raw[0];
          continue;
        }
        const vals = raw.map((x) => {
          if (s.kind === "S") return x;
          if (s.kind === "L") {
            if (!["T", "F", "true", "false", "0", "1"].includes(x))
              throw Error("Invalid logical");
            return ["T", "true", "1"].includes(x) ? 1 : 0;
          }
          const v = num(x);
          if (s.kind === "I" && !Number.isSafeInteger(v))
            throw Error("Unsafe integer property");
          return v;
        });
        if (s.name === "pos") position = vals as V3;
        else if (s.name === "species") species = String(vals[0]);
        else if (s.n === 1) props[s.name] = vals[0];
        else {
          props[s.name] = vals as number[] | string[];
        }
      }
      atoms.push({
        id: atomId,
        element: element(species),
        type: element(species) ? undefined : species,
        position,
        properties: props,
      });
    }
    frames.push({
      atoms,
      cell,
      coordinateSet: "pos Cartesian",
      warnings: specs.some((s) => s.name === "id")
        ? []
        : [
            "No IDs: row-order correspondence assumed; identity tracking is not guaranteed",
          ],
      metadata: { header, comment },
    });
  }
  return {
    format: "xyz",
    frames,
    units: "unknown (XYZ convention often angstrom; not asserted)",
    warnings: [],
  };
}
