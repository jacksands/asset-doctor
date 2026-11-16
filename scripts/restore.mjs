import { MODULE_ID } from "./constants.mjs";
import { fileUrl } from "./copy.mjs";
import { decodedNorm } from "./replace.mjs";

/**
 * Le um arquivo de backup salvo pelo Assets Doctor (Data/asset-doctor/<mundo>/backup-*.json)
 * e devolve { world, at, entries } com as entradas validas ({ uuid, old }).
 * Lanca erro com code "bad" se o arquivo nao for um backup do modulo.
 */
export async function loadBackup(path) {
  const res = await fetch(fileUrl(decodedNorm(path)));
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: "http" });
  let data;
  try { data = await res.json(); } catch { throw Object.assign(new Error("not json"), { code: "bad" }); }
  if (data?.module !== MODULE_ID || !Array.isArray(data.entries)) throw Object.assign(new Error("not a backup"), { code: "bad" });
  const entries = data.entries.filter((e) => typeof e?.uuid === "string" && e.old && typeof e.old === "object");
  return { world: data.world ?? null, at: data.at ?? null, kind: data.kind ?? "replace", entries };
}
