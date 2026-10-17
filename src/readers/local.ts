import type { Dataset, Format } from "../model.ts";
import { LIMITS, validate } from "../model.ts";
import { dump, data } from "./lammps.ts";
import { xyz } from "./xyz.ts";
export function detect(source: string, text: string): Format {
  if (/^\s*ITEM: TIMESTEP/.test(text)) return "lammps-dump";
  const ext = source.toLowerCase().split(".").pop();
  if (ext === "data") {
    if (!/^\s*\d+\s+atoms\s*$/m.test(text) || !/^Atoms\s*(?:#.*)?$/m.test(text))
      throw Error(".data content is not recognized as LAMMPS");
    return "lammps-data";
  }
  if (ext === "pdb") return "pdb";
  if (ext === "cif" || ext === "mmcif") return "cif";
  if (/^\s*\d+\s*\r?\n/.test(text)) return "xyz";
  throw Error("Unrecognized local structure format");
}
export function readLocal(
  text: string,
  source: string,
  format?: Format,
  atomStyle?: string,
): Dataset {
  if (new TextEncoder().encode(text).length > LIMITS.bytes)
    throw Error("File size limit exceeded");
  const f = format ?? detect(source, text);
  if (f === "pdb" || f === "cif")
    throw Error(`${f} requires async readStructure; use the main readers API`);
  return validate(
    f === "lammps-dump"
      ? dump(text)
      : f === "lammps-data"
        ? data(text, atomStyle)
        : xyz(text),
  );
}
