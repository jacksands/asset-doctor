import { safeDecode, extOf, kindOfExt, dirOf } from "./extract.mjs";
import { warn } from "./constants.mjs";

const nk = (p) => p.normalize("NFC").toLowerCase();
/** Valores de exemplo que modulos gravam como padrao (ex.: "path/image.png"). */
const PLACEHOLDER = /^path\/(to\/)?(image|file|icon|token|img|picture|photo)\.[a-z0-9]+$/i;

const getFP = () => foundry.applications.apps.FilePicker.implementation;

/** Executa fn em items com no maximo `limit` chamadas simultaneas. */
async function pool(items, limit, fn, onTick, isCancelled) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length && !isCancelled()) {
      const idx = next++;
      try { await fn(items[idx], idx); } catch (e) { warn("falha em item", e); }
      done++;
      onTick?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Compatibilidade entre o tipo esperado pelo campo e o tipo do arquivo. */
const isCompatible = (expect, kind, ext) => {
  if (expect === "audio") return kind === "audio" || ext === "webm";
  if (expect === "visual") return kind === "image" || kind === "video";
  return true;
};
const isMedia = (kind) => kind === "image" || kind === "video" || kind === "audio";

function ownerOf(norm) {
  const m = norm.match(/^(modules|systems)\/([^/]+)\//);
  if (!m) return null;
  const [, folder, id] = m;
  if (folder === "modules") {
    const mod = game.modules.get(id);
    return { type: "module", id, state: !mod ? "notinstalled" : mod.active ? "active" : "inactive" };
  }
  return { type: "system", id, state: id === game.system.id ? "active" : "other" };
}

/**
 * Verifica todos os grupos (um grupo = um caminho unico).
 * Preenche g.status e g.extra em cada grupo.
 */
export async function verifyGroups(list, ctl) {
  const FP = getFP();
  const concrete = [];
  const wild = [];
  const folders = [];

  for (const g of list) {
    if (g.isCore) { g.status = "core"; continue; }
    if (g.isExternal) { g.status = "external"; continue; }
    (g.isFolder ? folders : g.isWildcard ? wild : concrete).push(g);
  }

  // ---- 1. Lista cada pasta uma unica vez ---------------------------------
  const dirSet = new Set();
  for (const g of concrete) dirSet.add(dirOf(g.norm));
  for (const g of folders) dirSet.add(g.norm.replace(/\/+$/, ""));
  for (const g of wild) {
    const d = dirOf(g.norm);
    if (!/[*{}]/.test(d)) dirSet.add(d);
  }

  const dirs = new Map();
  await pool([...dirSet], 6, async (dir) => {
    try {
      const r = await FP.browse("data", dir);
      const files = new Map();
      const stems = new Map();
      for (const f of r.files ?? []) {
        const full = safeDecode(f).replace(/^\/+/, "");
        files.set(nk(full), full);
        const name = full.slice(full.lastIndexOf("/") + 1);
        const stem = nk(name.replace(/\.[^.]+$/, ""));
        if (!stems.has(stem)) stems.set(stem, []);
        stems.get(stem).push(name);
      }
      dirs.set(dir, { ok: true, files, stems, count: (r.files ?? []).length });
    } catch {
      dirs.set(dir, { ok: false });
    }
  }, (done, total) => ctl.onProgress({ phase: "folders", done, total }), ctl.isCancelled);

  if (ctl.isCancelled()) return;

  // ---- 2. Arquivos concretos --------------------------------------------
  for (const g of concrete) {
    const owner = ownerOf(g.norm);
    const x = (g.extra = { owner });
    const entry = dirs.get(dirOf(g.norm));
    if (!entry?.ok) { g.status = "missing"; x.dirMissing = true; continue; }

    const actual = entry.files.get(nk(g.norm));
    if (!actual) {
      g.status = "missing";
      x.dirCount = entry.count;
      const stem = nk(g.norm.slice(g.norm.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""));
      const alt = entry.stems.get(stem);
      if (alt?.length) x.suggestion = alt[0];
      continue;
    }
    if (actual !== g.norm) {
      g.status = "case";
      x.actual = actual.slice(actual.lastIndexOf("/") + 1);
      continue;
    }
    const badExpect = isMedia(g.kind) ? [...g.expects].find((e) => !isCompatible(e, g.kind, g.ext)) : null;
    if (badExpect) {
      g.status = "wrongtype";
      g.expect = badExpect;
      continue;
    }
    g.status = "ok";
  }

  for (const g of concrete) if (g.status === "missing" && PLACEHOLDER.test(g.norm)) g.status = "placeholder";

  // ---- 3. Pastas de busca (ex.: Token Variant Art) -----------------------
  for (const g of folders) {
    const entry = dirs.get(g.norm.replace(/\/+$/, ""));
    g.extra = { owner: ownerOf(g.norm + "/") };
    if (entry?.ok) { g.status = "ok"; g.extra.count = entry.count; }
    else { g.status = "folder_missing"; }
  }

  // ---- 4. Wildcards ------------------------------------------------------
  await pool(wild, 4, async (g) => {
    let files = [];
    try {
      const r = await FP.browse("data", g.norm, { wildcard: true });
      files = (r.files ?? []).map((f) => safeDecode(f));
    } catch {
      files = [];
    }
    const x = (g.extra = { owner: ownerOf(g.norm), matched: files.length, good: 0, bad: 0 });

    if (files.length === 0) {
      g.status = "wild_empty";
      const pdir = dirOf(g.norm);
      if (!/[*{}]/.test(pdir) && dirs.get(pdir) && !dirs.get(pdir).ok) x.dirMissing = true;
      return;
    }

    // avalia cada tipo esperado (usos diferentes podem esperar tipos diferentes) e fica com o pior caso
    const rank = { ok: 0, wild_mixed: 1, wild_wrongtype: 2 };
    let worst = null;
    for (const e of g.expects.size ? [...g.expects] : [null]) {
      let good = 0;
      let bad = 0;
      for (const f of files) {
        const ext = extOf(f);
        const kind = kindOfExt(ext);
        if (!e || isCompatible(e, kind, ext)) good++;
        else if (isMedia(kind)) bad++;
      }
      const status = e && good === 0 ? "wild_wrongtype" : e && bad > 0 ? "wild_mixed" : "ok";
      if (!worst || rank[status] > rank[worst.status]) worst = { status, expect: e, good, bad };
    }
    g.status = worst.status;
    g.expect = worst.expect ?? g.expect;
    x.good = worst.good;
    x.bad = worst.bad;
  }, (done, total) => ctl.onProgress({ phase: "wildcards", done, total }), ctl.isCancelled);

  // tipo do grupo wildcard (para o filtro por tipo)
  for (const g of wild) g.kind = g.expect === "audio" ? "audio" : g.expect === "visual" ? "image" : "other";
}
