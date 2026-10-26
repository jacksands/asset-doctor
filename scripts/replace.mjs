import { classifyString, safeDecode, extOf, dirOf, hasWildcard, mapHtmlPaths, SKIP_KEYS } from "./extract.mjs";
import { warn } from "./constants.mjs";

const getFP = () => foundry.applications.apps.FilePicker.implementation;
const nk = (p) => p.normalize("NFC").toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Caminhos digitados pelo usuario
// ---------------------------------------------------------------------------
/** Forma decodificada e sem "./" ou "/" no inicio (a usada para comparar). */
export const decodedNorm = (input) => safeDecode(String(input ?? "").trim()).replace(/^\.?\/+/, "");

/** Forma gravada nos documentos: cada trecho codificado (%20 etc.), a menos que ja venha codificada. */
export function encodeStored(input) {
  const t = String(input ?? "").trim().replace(/^\.?\/+/, "");
  if (safeDecode(t) !== t) return t;
  return t.split("/").map(encodeURIComponent).join("/");
}

// ---------------------------------------------------------------------------
// Existe o arquivo novo?
// ---------------------------------------------------------------------------
const dirCache = new Map();
export const clearExistsCache = () => dirCache.clear();

/** true se o arquivo (ou algum arquivo do wildcard) existe na fonte "data". */
export async function existsNorm(norm) {
  if (!norm) return false;
  if (hasWildcard(norm)) {
    try {
      const r = await getFP().browse("data", norm, { wildcard: true });
      return (r.files?.length ?? 0) > 0;
    } catch { return false; }
  }
  const dir = dirOf(norm);
  if (!dirCache.has(dir)) {
    dirCache.set(dir, getFP().browse("data", dir)
      .then((r) => ({ ok: true, files: new Set((r.files ?? []).map((f) => nk(safeDecode(f).replace(/^\/+/, "")))) }))
      .catch(() => ({ ok: false, files: new Set() })));
  }
  const d = await dirCache.get(dir);
  return d.ok && d.files.has(nk(norm));
}

/** Pasta mais proxima que existe (para o Browse abrir no lugar certo). */
export async function nearestExistingDir(norm) {
  let dir = dirOf(norm);
  for (let i = 0; i < 12; i++) {
    try { await getFP().browse("data", dir); return dir; } catch { /* sobe um nivel */ }
    if (!dir) break;
    dir = dirOf(dir);
  }
  return "";
}

// ---------------------------------------------------------------------------
// Regras de troca
// ---------------------------------------------------------------------------
const swapExt = (norm, newExt) => {
  const ne = String(newExt ?? "").replace(/^\./, "").trim();
  if (!ne) return norm;
  const ext = extOf(norm);
  if (!ext) return norm;
  return norm.slice(0, norm.length - ext.length) + ne;
};

/**
 * Novo caminho (decodificado) para um grupo, ou null se a regra nao se aplica.
 * rule: { mode: "exact"|"prefix"|"contains"|"ext", to, find, repl, newExt }
 */
export function applyRule(g, rule) {
  const n = g.norm;
  let out = null;
  switch (rule.mode) {
    case "exact":
      out = decodedNorm(rule.to);
      break;
    case "prefix": {
      const f = decodedNorm(rule.find).normalize("NFC");
      if (!f) return null;
      const N = n.normalize("NFC");
      if (N.toLowerCase().startsWith(f.toLowerCase())) out = decodedNorm(rule.repl ?? "") + N.slice(f.length);
      break;
    }
    case "contains": {
      const f = decodedNorm(rule.find);
      if (!f) return null;
      const re = new RegExp(escapeRe(f), "gi");
      if (re.test(n)) out = n.replace(new RegExp(escapeRe(f), "gi"), () => decodedNorm(rule.repl ?? ""));
      break;
    }
    case "ext": {
      const fe = String(rule.find ?? "").replace(/^\./, "").trim().toLowerCase();
      if (fe && g.ext === fe) out = swapExt(n, rule.repl);
      break;
    }
    default: return null;
  }
  if (out != null && rule.newExt && rule.mode !== "ext") out = swapExt(out, rule.newExt);
  return out && out !== n ? out : null;
}

/** So trocamos caminhos locais, com pasta, que vieram de documentos (nao de configuracoes). */
export const isReplaceable = (g) =>
  !g.isCore && !g.isExternal && !g.isFolder && g.norm.includes("/") && (g.chains?.size ?? 0) > 0;

/** Itens da troca: [{ group, newNorm }] */
export function buildItems(groups, rule) {
  const items = [];
  for (const g of groups) {
    if (!isReplaceable(g)) continue;
    const newNorm = applyRule(g, rule);
    if (newNorm) items.push({ group: g, newNorm, exists: null });
  }
  return items;
}

/** Preenche item.exists (true/false) com no maximo 6 consultas simultaneas. */
export async function checkItems(items, onTick, isCancelled = () => false) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length && !isCancelled()) {
      const it = items[next++];
      it.exists = await existsNorm(it.newNorm);
      onTick?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker));
}

// ---------------------------------------------------------------------------
// Troca dentro dos dados de um documento
// ---------------------------------------------------------------------------
function replaceInString(s, map, counter) {
  const info = classifyString(s);
  if (info) {
    if (info.external) return s;
    const nv = map.get(info.norm);
    if (nv === undefined) return s;
    counter.n++;
    const lead = info.base.startsWith("/") ? "/" : info.base.startsWith("./") ? "./" : "";
    return lead + nv + s.trim().slice(info.base.length);
  }
  if (s.length > 20 && s.includes("<") && (s.includes("=") || s.includes("url("))) {
    const r = mapHtmlPaths(s, (dec) => {
      const i = classifyString(dec);
      if (!i || i.external) return null;
      const nv = map.get(i.norm);
      return nv === undefined ? null : nv + dec.trim().slice(i.base.length);
    });
    if (r.changed) { counter.n += r.changed; return r.html; }
  }
  return s;
}

export function replaceInValue(value, map, counter, depth = 0) {
  if (depth > 14 || value == null) return { value, changed: false };
  if (typeof value === "string") {
    const nv = replaceInString(value, map, counter);
    return { value: nv, changed: nv !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = replaceInValue(v, map, counter, depth + 1);
      if (r.changed) changed = true;
      return r.value;
    });
    return { value: changed ? out : value, changed };
  }
  if (typeof value === "object") {
    let changed = false;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SKIP_KEYS.has(k)) { out[k] = v; continue; }
      const r = replaceInValue(v, map, counter, depth + 1);
      if (r.changed) changed = true;
      out[k] = r.value;
    }
    return { value: changed ? out : value, changed };
  }
  return { value, changed: false };
}

// ---------------------------------------------------------------------------
// Planejar: localizar os documentos e calcular o que muda
// ---------------------------------------------------------------------------
/** Cada cadeia "uuid1|uuid2|..." vai do documento de topo ao mais fundo; usamos o mais fundo que existir. */
async function resolveChain(chain, cache) {
  const uuids = chain.split("|").filter(Boolean);
  for (let i = uuids.length - 1; i >= 0; i--) {
    const u = uuids[i];
    if (!cache.has(u)) {
      cache.set(u, fromUuid(u).catch(() => null));
    }
    const doc = await cache.get(u);
    if (doc) return doc;
  }
  return null;
}

/**
 * @param {Map<string,string>} map  caminho antigo (decodificado) -> caminho novo (como sera gravado)
 * @param {Set<string>} chains
 */
export async function planDocs(map, chains, onTick, isCancelled = () => false) {
  const cache = new Map();
  const docs = new Map();
  let unresolved = 0;
  let i = 0;
  for (const chain of chains) {
    if (isCancelled()) break;
    const doc = await resolveChain(chain, cache);
    if (doc) docs.set(doc.uuid, doc); else unresolved++;
    if (++i % 25 === 0) { onTick?.(i, chains.size); await new Promise((r) => setTimeout(r, 0)); }
  }

  const changes = [];
  const counter = { n: 0 };
  for (const doc of docs.values()) {
    const skip = new Set(Object.keys(doc.collections ?? {}));
    const update = {};
    const old = {};
    for (const [k, v] of Object.entries(doc._source ?? {})) {
      if (skip.has(k) || SKIP_KEYS.has(k)) continue;
      const r = replaceInValue(v, map, counter);
      if (r.changed) { update[k] = r.value; old[k] = structuredClone(v); }
    }
    if (Object.keys(update).length) changes.push({ doc, uuid: doc.uuid, update, old });
  }
  return { changes, unresolved, uses: counter.n, docsFound: docs.size };
}

// ---------------------------------------------------------------------------
// Aplicar / desfazer
// ---------------------------------------------------------------------------
async function runUpdates(entries, field, onTick, isCancelled) {
  // entries: [{ doc, data }]  data = objeto de update
  const failures = [];
  let done = 0;
  const embedded = new Map();
  const top = [];
  for (const e of entries) {
    if (e.doc.parent) {
      const key = `${e.doc.parent.uuid}|${e.doc.documentName}`;
      if (!embedded.has(key)) embedded.set(key, { parent: e.doc.parent, name: e.doc.documentName, list: [] });
      embedded.get(key).list.push({ _id: e.doc.id, ...e.data });
    } else {
      top.push(e);
    }
  }
  const total = top.length + [...embedded.values()].reduce((n, b) => n + b.list.length, 0);

  for (const e of top) {
    if (isCancelled()) break;
    try { await e.doc.update(e.data); } catch (err) { failures.push({ name: e.doc.name ?? e.doc.uuid, message: err.message }); }
    onTick?.(++done, total);
  }
  for (const b of embedded.values()) {
    for (let i = 0; i < b.list.length; i += 50) {
      if (isCancelled()) break;
      const chunk = b.list.slice(i, i + 50);
      try { await b.parent.updateEmbeddedDocuments(b.name, chunk); }
      catch (err) { failures.push({ name: `${b.parent.name ?? b.parent.uuid} › ${b.name} (${chunk.length})`, message: err.message }); }
      done += chunk.length;
      onTick?.(done, total);
    }
  }
  return failures;
}

/** Aplica o plano. Devolve { failures, batch } onde batch serve para desfazer. */
export async function applyPlan(plan, onTick, isCancelled = () => false) {
  const failures = await runUpdates(plan.changes.map((c) => ({ doc: c.doc, data: c.update })), "update", onTick, isCancelled);
  const batch = {
    at: Date.now(),
    world: game.world.id,
    entries: plan.changes.map((c) => ({ uuid: c.uuid, old: c.old }))
  };
  return { failures, batch };
}

/** Desfaz um lote: regrava os valores antigos. */
export async function undoBatch(batch, onTick, isCancelled = () => false) {
  const entries = [];
  let missing = 0;
  for (const e of batch.entries) {
    let doc = null;
    try { doc = await fromUuid(e.uuid); } catch { doc = null; }
    if (doc) entries.push({ doc, data: e.old }); else missing++;
  }
  const failures = await runUpdates(entries, "undo", onTick, isCancelled);
  return { failures, missing, restored: entries.length - failures.length };
}
