import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { sourcePath } from "./config.ts";
import { LIMITS } from "./model.ts";
/** Use only on desktop; check the resolved target before any read. */
export async function localSource(
  vaultRoot: string,
  source: string,
  maxBytes = LIMITS.bytes,
): Promise<string> {
  const relative = sourcePath(source);
  const root = await realpath(vaultRoot);
  const candidate = await realpath(path.join(root, relative));
  const rel = path.relative(root, candidate);
  if (
    !rel ||
    rel.startsWith(`..${path.sep}`) ||
    rel === ".." ||
    path.isAbsolute(rel)
  )
    throw Error("Source resolves outside vault");
  const info = await stat(candidate);
  if (!info.isFile()) throw Error("Source is not a regular file");
  if (info.size > maxBytes) throw Error(`File exceeds ${maxBytes} byte limit`);
  return candidate;
}

export interface RegisteredSource {
  path: string;
  canonical: string;
}
/** A registration grants one selected file, never its parent directory. */
export async function registerExternal(
  file: string,
): Promise<RegisteredSource> {
  if (!path.isAbsolute(file)) throw Error("Choose an absolute local file path");
  const canonical = await realpath(file);
  const info = await stat(canonical);
  if (!info.isFile()) throw Error("Source is not a regular file");
  if (!/\.(lammpstrj|pdb|cif|mmcif|data|xyz|extxyz)$/i.test(canonical))
    throw Error("Unsupported external file extension");
  return { path: file, canonical };
}
export async function registeredSource(
  entry: RegisteredSource | undefined,
  maxBytes: number,
): Promise<string> {
  if (!entry)
    throw Error(
      "External source is not registered on this device; register the selected file first",
    );
  if ((await realpath(entry.path)) !== entry.canonical)
    throw Error("Registered source symlink target changed; register again");
  const info = await stat(entry.canonical);
  if (!info.isFile() || info.size > maxBytes)
    throw Error(
      "External source is not a regular file or exceeds its size limit",
    );
  return entry.canonical;
}
