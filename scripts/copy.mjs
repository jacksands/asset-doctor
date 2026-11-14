import { safeDecode, extOf, kindOfExt, dirOf } from "./extract.mjs";
import { decodedNorm, existsNorm, isReplaceable, clearExistsCache } from "./replace.mjs";
import { warn } from "./constants.mjs";

const FP = () => foundry.applications.apps.FilePicker.implementation;
const nk = (p) => p.normalize("NFC").toLowerCase();

export const TYPE_FOLDER = { image: "images", video: "videos", audio: "sounds", other: "other" };
export const KIND_ORDER = ["image", "video", "audio", "other"];

/** Arquivos de outros modulos e sistemas (nao sao do mundo). */
const PACKAGE_RE = /^(modules|systems)\//i;

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------
/** URL para baixar um arquivo da pasta Data (respeita o prefixo do servidor). */
export function fileUrl(norm) {
  const enc = norm.split("/").map(encodeURIComponent).join("/");
  return foundry.utils?.getRoute ? foundry.utils.getRoute(enc) : enc;
}

/** Tamanho em bytes via HEAD, ou null se nao der para saber. */
export async function headSize(norm) {
  try {
    const r = await fetch(fileUrl(norm), { method: "HEAD" });
    if (!r.ok) return null;
    const raw = r.headers.get("content-length");
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function pool(items, limit, fn, onTick, isCancelled = () => false) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length && !isCancelled()) {
      const it = items[next++];
      try { await fn(it); } catch (e) { warn("falha em item", e); }
      onTick?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Onde os grupos sao usados (playlist, token, cena...), sem repetir. */
export function originsOf(groups) {
  const set = new Set();
  for (const g of groups) for (const r of g.refs ?? []) set.add(r.origin);
  return [...set];
}

/** Quantos arquivos copiados sao usados em cada lugar (um arquivo conta em cada lugar onde aparece). */
export function originCounts(items) {
  const out = new Map();
  for (const it of items) {
    if (it.status !== "copied" && it.status !== "already") continue;
    for (const o of originsOf(it.groups)) out.set(o, (out.get(o) ?? 0) + 1);
  }
  return out;
}

export const joinPath = (...parts) => parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/");

/** Caminho do arquivo dentro da pasta de tipo, conforme o layout escolhido. */
export function relPath(src, opts) {
  let rel = opts.keepFolders ? src : src.slice(src.lastIndexOf("/") + 1);
  if (opts.keepFolders && opts.strip) {
    const s = decodedNorm(opts.strip).replace(/\/*$/, "/");
    if (s !== "/" && nk(rel).startsWith(nk(s))) rel = rel.slice(s.length);
  }
  return rel;
}

const isInside = (src, dest) => !!dest && nk(src).startsWith(`${nk(dest)}/`);

// ---------------------------------------------------------------------------
// 1. Plano: o que copiar e o que nao copiar (e por que)
// ---------------------------------------------------------------------------
/**
 * @param {object[]} groups  grupos do resultado da verificacao
 * @param {{dest:string, types:object, includePackages:boolean, hidden:object}} opts
 * @returns {{items:object[], wild:object[], skipped:object[]}}
 */
export function classifyGroups(groups, opts) {
  const items = [];
  const wild = [];
  const skipped = [];
  const skip = (g, reason) => skipped.push({ reason, path: g.norm, kind: g.kind ?? "other", uses: g.count, origins: originsOf([g]) });

  for (const g of groups) {
    if (opts.hidden?.[g.norm]) { skip(g, "hidden"); continue; }
    if (g.status === "inactive_owner") { skip(g, "inactive"); continue; }
    if (g.status === "placeholder") { skip(g, "placeholder"); continue; }
    if (g.status === "external") { skip(g, "external"); continue; }
    if (g.status === "core") { skip(g, "core"); continue; }
    if (g.isFolder) { skip(g, "folder"); continue; }
    if (g.status === "missing" || g.status === "wild_empty") { skip(g, "missing"); continue; }

    if (g.isWildcard) {
      if (!["ok", "wild_mixed", "wild_wrongtype"].includes(g.status)) { skip(g, "missing"); continue; }
      const kind = g.kind ?? "other";
      if (!opts.types[kind]) { skip(g, "type"); continue; }
      if (!opts.includePackages && PACKAGE_RE.test(g.norm)) { skip(g, "package"); continue; }
      if (isInside(g.norm, opts.dest)) { skip(g, "inDest"); continue; }
      wild.push(g);
      continue;
    }

    if (!["ok", "case", "wrongtype"].includes(g.status)) { skip(g, "missing"); continue; }
    const src = g.status === "case" && g.extra?.actual
      ? joinPath(dirOf(g.norm), g.extra.actual) : g.norm;
    const kind = g.kind ?? kindOfExt(extOf(src)) ?? "other";
    if (!opts.types[kind]) { skip(g, "type"); continue; }
    if (!opts.includePackages && PACKAGE_RE.test(src)) { skip(g, "package"); continue; }
    if (isInside(src, opts.dest)) { skip(g, "inDest"); continue; }
    items.push({ src, kind, groups: [g], wildcard: false, status: "pending" });
  }
  return { items, wild, skipped };
}

/** Expande wildcards em arquivos reais (o Foundry resolve o padrao). */
export async function expandWildcards(wild, items, skipped, onTick, isCancelled) {
  await pool(wild, 4, async (g) => {
    let files = [];
    try {
      const r = await FP().browse("data", g.norm, { wildcard: true });
      files = (r.files ?? []).map((f) => safeDecode(f).replace(/^\/+/, ""));
    } catch { files = []; }
    if (!files.length) { skipped.push({ reason: "wildempty", path: g.norm, kind: g.kind ?? "other", uses: g.count, origins: originsOf([g]) }); return; }
    for (const f of files) items.push({ src: f, kind: g.kind ?? "other", groups: [g], wildcard: true, status: "pending" });
  }, onTick, isCancelled);
}

/** Junta duplicados (mesmo arquivo citado por varios grupos) e define o destino de cada um. */
export function assignDestinations(rawItems, opts) {
  const byKey = new Map();
  for (const it of rawItems) {
    const key = `${it.kind}|${nk(it.src)}`;
    const found = byKey.get(key);
    if (found) {
      for (const g of it.groups) if (!found.groups.includes(g)) found.groups.push(g);
      found.wildcard = found.wildcard && it.wildcard;
    } else {
      byKey.set(key, it);
    }
  }
  const items = [...byKey.values()].sort((a, b) =>
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.src.localeCompare(b.src));

  const used = new Map();
  for (const it of items) {
    const base = joinPath(opts.dest, TYPE_FOLDER[it.kind], relPath(it.src, opts));
    let d = base;
    let n = 1;
    while (used.has(nk(d)) && used.get(nk(d)) !== nk(it.src)) {
      n++;
      d = base.replace(/(\.[^./]*)?$/, `-${n}$1`);
    }
    used.set(nk(d), nk(it.src));
    it.dest = d;
  }
  return items;
}

/** Le o tamanho de cada arquivo (para o resumo e para conferir a copia). */
export async function readSizes(items, onTick, isCancelled) {
  await pool(items, 6, async (it) => { it.size = await headSize(it.src); }, onTick, isCancelled);
}

export function summarize(items) {
  const out = {};
  for (const k of KIND_ORDER) out[k] = { files: 0, bytes: 0, unknown: 0 };
  for (const it of items) {
    const s = out[it.kind];
    s.files++;
    if (it.size == null) s.unknown++; else s.bytes += it.size;
  }
  return out;
}

export function skippedByReason(skipped) {
  const out = new Map();
  for (const s of skipped) {
    if (!out.has(s.reason)) out.set(s.reason, []);
    out.get(s.reason).push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Copia
// ---------------------------------------------------------------------------
const ensured = new Set();
export const resetEnsured = () => ensured.clear();

async function ensureDirs(path) {
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (ensured.has(cur)) continue;
    try { await FP().browse("data", cur); }
    catch {
      try { await FP().createDirectory("data", cur); } catch { /* ja existe (criada por outro envio) */ }
    }
    ensured.add(cur);
  }
}

async function copyOne(it, ctx = {}) {
  // ja existe no destino com o mesmo tamanho?
  if (it.size != null && await existsNorm(it.dest)) {
    const ds = await headSize(it.dest);
    if (ds === it.size) { it.status = "already"; it.result = it.dest; return; }
  }

  const res = await fetch(fileUrl(it.src));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const name = it.dest.slice(it.dest.lastIndexOf("/") + 1);
  const dir = dirOf(it.dest);
  await ensureDirs(dir);

  const file = new File([blob], name, { type: blob.type });
  const up = await FP().upload("data", dir, file, {}, { notify: false });
  if (!up || up.status === "error" || up.error) throw new Error(up?.message ?? "upload refused");

  const newPath = safeDecode(up.path ?? `${dir}/${name}`).replace(/^\/+/, "");
  const size = await headSize(newPath);
  it.uploaded = newPath;
  if (size != null && size !== blob.size) {
    // Outro modulo (ex.: media-optimizer, filepicker-plus) pode converter ou renomear arquivos no envio.
    if (!ctx.acceptResized) throw new Error(`size mismatch (${size} vs ${blob.size})`);
    it.note = `size differs (${size} vs ${blob.size}): changed during upload by another module`;
  }
  it.status = "copied";
  it.result = newPath;
  it.size ??= blob.size;
}

/** Copia todos os itens (3 por vez). Quem nao for iniciado por cancelamento fica "pending". */
export async function copyAll(items, onTick, isCancelled = () => false, ctx = {}) {
  resetEnsured();
  clearExistsCache(); // listagens de pastas guardadas antes podem estar velhas
  await pool(items, 3, async (it) => {
    try { await copyOne(it, ctx); }
    catch (err) { it.status = "failed"; it.error = err.message; }
  }, onTick, isCancelled);
}

// ---------------------------------------------------------------------------
// 3. Atualizar os caminhos do mundo
// ---------------------------------------------------------------------------
const ok = (it) => it.status === "copied" || it.status === "already";

/**
 * Confere, depois da copia, se o novo padrao (wildcard) acha todos os arquivos copiados.
 * O envio pode renomear arquivos (minusculas, hifens), e ai o padrao antigo deixaria de achar os arquivos.
 * @returns {Promise<Map<object, boolean>>} grupo -> true se o padrao novo funciona
 */
export async function checkWildcards(items, opts) {
  const out = new Map();
  const byGroup = new Map();
  for (const it of items) for (const g of it.groups) {
    if (!g.isWildcard) continue;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(it);
  }
  await pool([...byGroup], 4, async ([g, its]) => {
    if (!opts.keepFolders || !its.every(ok)) { out.set(g, false); return; }
    const pattern = joinPath(opts.dest, TYPE_FOLDER[g.kind ?? "other"], relPath(g.norm, opts));
    try {
      const r = await FP().browse("data", pattern, { wildcard: true });
      const found = new Set((r.files ?? []).map((f) => nk(safeDecode(f).replace(/^\/+/, ""))));
      out.set(g, its.every((it) => found.has(nk(it.result))));
    } catch { out.set(g, false); }
  });
  return out;
}

/**
 * Mapa caminho antigo -> caminho novo para os grupos cujos arquivos foram copiados.
 * Retorna tambem as cadeias de documentos a atualizar e os grupos que nao puderam ser atualizados.
 */
export function buildRelinkMapping(items, groups, opts, wildChecks = null) {
  const map = new Map();
  const chains = new Set();
  const notRelinked = [];
  const byGroup = new Map();
  for (const it of items) for (const g of it.groups) {
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(it);
  }

  for (const [g, its] of byGroup) {
    if (!its.every(ok)) { notRelinked.push({ path: g.norm, reason: "failed", origins: originsOf([g]) }); continue; }
    if (!isReplaceable(g)) { notRelinked.push({ path: g.norm, reason: "notreplaceable", origins: originsOf([g]) }); continue; }

    if (g.isWildcard) {
      if (!opts.keepFolders) { notRelinked.push({ path: g.norm, reason: "flatwild", origins: originsOf([g]) }); continue; }
      const pattern = joinPath(opts.dest, TYPE_FOLDER[g.kind ?? "other"], relPath(g.norm, opts));
      if (!its.every((it) => dirOf(it.result) === dirOf(pattern))) { notRelinked.push({ path: g.norm, reason: "wildmoved", origins: originsOf([g]) }); continue; }
      if (wildChecks && wildChecks.get(g) !== true) { notRelinked.push({ path: g.norm, reason: "wildrenamed", origins: originsOf([g]) }); continue; }
      map.set(g.norm, pattern);
    } else {
      map.set(g.norm, its[0].result);
    }
    for (const c of g.chains) chains.add(c);
  }
  return { map, chains, notRelinked };
}

// ---------------------------------------------------------------------------
// 4. Relatorio
// ---------------------------------------------------------------------------
/** Linhas do relatorio: o que foi copiado e (principalmente) o que nao foi. */
export function buildReport(items, skipped, notRelinked = []) {
  const rows = [];
  for (const s of skipped) {
    rows.push({ status: "not copied", reason: s.reason, kind: s.kind, src: s.path, dest: "", size: "", uses: s.uses, origins: s.origins ?? [] });
  }
  for (const it of items) {
    const uses = it.wildcard ? "" : it.groups.reduce((n, g) => n + g.count, 0);
    const origins = originsOf(it.groups);
    if (it.status === "copied" || it.status === "already") {
      rows.push({ status: it.status === "copied" ? "copied" : "already there", reason: "", kind: it.kind, src: it.src, dest: it.result, size: it.size ?? "", uses, origins, error: it.note ?? "" });
    } else if (it.status === "failed") {
      rows.push({ status: "not copied", reason: "failed", kind: it.kind, src: it.src, dest: it.uploaded ?? it.dest, size: it.size ?? "", uses, origins, error: it.error });
    } else {
      rows.push({ status: "not copied", reason: "cancelled", kind: it.kind, src: it.src, dest: it.dest, size: it.size ?? "", uses, origins });
    }
  }
  for (const n of notRelinked) {
    rows.push({ status: "path not updated", reason: n.reason, kind: "", src: n.path, dest: "", size: "", uses: "", origins: n.origins ?? [] });
  }
  return rows;
}

export function reportCsv(rows, labelOf = (r) => r, originLabel = (o) => o) {
  const q = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const head = ["status", "reason", "type", "used_in", "source", "destination", "size_bytes", "uses", "error"];
  const lines = [head.map(q).join(",")];
  for (const r of rows) {
    lines.push([r.status, r.reason ? labelOf(r.reason) : "", r.kind, (r.origins ?? []).map(originLabel).join("; "), r.src, r.dest, r.size, r.uses, r.error ?? ""].map(q).join(","));
  }
  return "\ufeff" + lines.join("\n");
}

export const formatBytes = (n) => {
  if (n == null || !Number.isFinite(n)) return "?";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
};
