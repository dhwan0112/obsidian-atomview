import { readLocal, detect } from "./local.ts";
import { pdb, cif } from "./molecular.ts";
import type { Dataset, Format } from "../model.ts";
import { LIMITS } from "../model.ts";
export async function readStructure(
  text: string,
  source: string,
  format?: Format,
  style?: string,
): Promise<Dataset> {
  if (new TextEncoder().encode(text).length > LIMITS.bytes)
    throw Error("File size limit exceeded");
  if (/\.(gz|bz2|xz|bin)$/i.test(source))
    throw Error("Compressed and binary formats are unsupported");
  const f = format ?? detect(source, text);
  return f === "pdb"
    ? pdb(text)
    : f === "cif"
      ? cif(text)
      : readLocal(text, source, f, style);
}
