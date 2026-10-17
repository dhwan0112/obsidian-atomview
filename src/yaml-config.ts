import { parseDocument } from "yaml";
import { config } from "./config.ts";
import type { ViewConfig } from "./config.ts";
export function parseConfig(text: string): ViewConfig {
  if (text.length > 32768) throw Error("atomview configuration exceeds 32 KiB");
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw Error(`Invalid YAML: ${doc.errors[0].message}`);
  return config(doc.toJS({ maxAliasCount: 20 }));
}
