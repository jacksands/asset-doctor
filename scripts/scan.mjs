import { SEVERITY, PUBLIC_DIRS, warn } from "./constants.mjs";
import { walkSource, originOf, expectOf, flagNamespaces } from "./extract.mjs";
import { verifyGroups } from "./verify.mjs";

const SKIP_COLLECTIONS = new Set(["ChatMessage", "FogExploration", "Setting", "Folder", "Combat", "Adventure"]);
const PACK_TYPES = new Set(["Actor", "Item", "Scene", "JournalEntry", "Playlist", "RollTable", "Macro", "Cards", "Adventure"]);
const MAX_REFS_PER_GROUP = 500;
const yieldUI = () => new Promise((r) => setTimeout(r, 0));

/** active | inactive (modulo instalado e desligado) | unknown (nao e um modulo instalado) */
function ownerState(id) {
  if (!id || id === "core" || id === game.system.id) return "active";
  const m = game.modules.get(id);
  if (!m) return "unknown";
  return m.active ? "active" : "inactive";
}

const isKnownScope = (id) => id === "core" || id === game.system.id || game.modules.has(id);

/**
 * Dono do dado. Se um modulo guarda copia de dados de outro (ex.: predefinicoes do Mass Edit com
 * flags.barbrawl dentro de flags.multi-token-edit), o dono e o namespace mais interno que for um modulo conhecido.
 */
function pickOwner(keys) {
  const ns = flagNamespaces(keys);
  if (!ns.length) return null;
  for (let i = ns.length - 1; i >= 0; i--) if (isKnownScope(ns[i])) return ns[i];
  return ns[0];
}

/** Dono que vale a pena mostrar ao usuario (ignora o nucleo e o sistema). */
const showOwner = (id) => !!id && id !== "core" && id !== game.system.id;

/**
 * @param {{includeModulePacks:boolean, includeSettings:boolean}} opts
 * @param {{onProgress:Function, isCancelled:Function}} ctl
 * @returns {Promise<object|null>} resultado, ou null se cancelado
 */
export async function runScan(opts, ctl) {
  const t0 = performance.now();
  const groups = new Map();
  const stats = { docs: 0, packs: 0, refs: 0, warnings: [], timings: {} };
  let tPhase = performance.now();
  const lap = (name) => { const n = performance.now(); stats.timings[name] = n - tPhase; tPhase = n; };
  const progress = (phase, done, total) => ctl.onProgress({ phase, done, total });

  const addRef = (info, meta) => {
    const key = info.external ? `E|${info.norm}` : info.norm;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, norm: info.norm, raw: info.raw, kind: info.kind, ext: info.ext,
        isWildcard: info.wildcard, isExternal: info.external, isCore: info.core, isFolder: false,
        expect: null, expects: new Set(), activeCount: 0, owners: new Map(), offOwners: new Map(), chains: new Set(),
        refs: [], count: 0, status: null, extra: null
      };
      groups.set(key, g);
    }
    g.count++;
    if (meta.uuids?.length) g.chains.add(meta.uuids.join("|"));
    const st = ownerState(meta.owner);
    if (showOwner(meta.owner)) g.owners.set(meta.owner, st);
    if (st === "active") g.activeCount++;
    else g.offOwners.set(meta.owner, st);
    stats.refs++;
    g.expect ??= meta.expect;
    if (meta.expect) g.expects.add(meta.expect);
    if (g.refs.length < MAX_REFS_PER_GROUP) {
      g.refs.push({
        origin: meta.origin, location: meta.labels.join(" › "), field: meta.keys.join("."),
        uuids: meta.uuids, via: meta.via, pack: meta.pack, docType: meta.topType,
        owner: showOwner(meta.owner) ? meta.owner : null, ownerState: showOwner(meta.owner) ? st : null
      });
    }
  };

  const scanSource = (topType, source, baseLabels, topUuid, pack, settingOwner = null) => {
    walkSource(topType, source, baseLabels, topUuid, ({ info, keys, labels, uuids, via }) => {
      addRef(info, {
        origin: originOf(topType, keys), expect: expectOf(topType, keys),
        labels, keys, uuids, via, pack, topType, owner: settingOwner ?? pickOwner(keys)
      });
    });
  };

  // ---- Fase 1: documentos do mundo --------------------------------------
  const collections = opts.world
    ? [...game.collections.values()].filter((c) => !SKIP_COLLECTIONS.has(c.documentName))
    : [];
  const totalDocs = collections.reduce((n, c) => n + c.contents.length, 0);
  let doneDocs = 0;
  progress("docs", 0, totalDocs);
  for (const coll of collections) {
    for (const doc of coll.contents) {
      if (ctl.isCancelled()) return null;
      try {
        scanSource(coll.documentName, doc._source, [doc.name ?? coll.documentName], doc.uuid, null);
      } catch (e) {
        stats.warnings.push(`${coll.documentName} ${doc.name}: ${e.message}`);
        warn("erro ao ler documento", doc, e);
      }
      stats.docs++;
      if (++doneDocs % 20 === 0) { progress("docs", doneDocs, totalDocs); await yieldUI(); }
    }
  }
  progress("docs", totalDocs, totalDocs);
  lap("docs");

  // ---- Fase 2: compendios -------------------------------------------------
  const packSet = new Set();
  const supported = (p) => PACK_TYPES.has(p.documentName);
  if (opts.compendiums) {
    for (const p of game.packs.contents) {
      if (supported(p) && (p.metadata.packageType === "world" || opts.modulePacks)) packSet.add(p);
    }
  }
  if (opts.module && opts.moduleId) {
    for (const p of game.packs.contents) {
      if (supported(p) && p.metadata.packageType === "module" && p.metadata.packageName === opts.moduleId) packSet.add(p);
    }
  }
  const packs = [...packSet];
  let donePacks = 0;
  progress("packs", 0, packs.length);
  for (const pack of packs) {
    if (ctl.isCancelled()) return null;
    try {
      const docs = await pack.getDocuments();
      for (const doc of docs) {
        scanSource(pack.documentName, doc._source, [`[${pack.metadata.label}] ${doc.name}`], doc.uuid, pack.metadata.label);
      }
      stats.packs++;
    } catch (e) {
      stats.warnings.push(`${pack.metadata.label}: ${e.message}`);
      warn("erro ao ler compendio", pack.collection, e);
    }
    progress("packs", ++donePacks, packs.length);
    await yieldUI();
  }

  lap("packs");

  // ---- Fase 3: pastas de busca do Token Variant Art (faz parte da configuracao do mundo) ----
  if (opts.world) {
    progress("settings", 0, 1);
    try {
      addTokenVariantFolders(groups);
    } catch (e) {
      stats.warnings.push(`Token Variant Art: ${e.message}`);
      warn("erro ao ler pastas do Token Variant Art", e);
    }
    progress("settings", 1, 1);
  }

  lap("settings");
  if (ctl.isCancelled()) return null;

  // ---- Fases 4 e 5: verificacao (pastas e wildcards) ----------------------
  const list = [...groups.values()];
  await verifyGroups(list, ctl);
  if (ctl.isCancelled()) return null;
  lap("verify");

  // Dado gravado so por modulo desligado (ou que nao existe mais) nao e problema do mundo: vai para "Ignorados".
  for (const g of list) {
    const sev = SEVERITY[g.status];
    if ((sev === "broken" || sev === "warn") && g.activeCount === 0 && g.offOwners.size) {
      g.extra = { ...(g.extra ?? {}), was: g.status, off: [...g.offOwners].map(([id, state]) => ({ id, state })) };
      g.status = "inactive_owner";
    }
  }

  // ---- Resultado ----------------------------------------------------------
  const sevRank = { broken: 0, warn: 1, ok: 2, skip: 3 };
  list.sort((a, b) =>
    (sevRank[SEVERITY[a.status]] ?? 9) - (sevRank[SEVERITY[b.status]] ?? 9) ||
    b.count - a.count || a.norm.localeCompare(b.norm));

  const counts = { broken: 0, warn: 0, ok: 0, skip: 0 };
  for (const g of list) counts[SEVERITY[g.status] ?? "skip"]++;

  return { groups: list, stats, counts, durationMs: performance.now() - t0, finishedAt: Date.now(), options: { ...opts } };
}

/**
 * Token Variant Art guarda uma lista de pastas de busca na configuracao
 * "token-variants.settings" (searchPaths[].text). Verificamos se cada pasta existe.
 */
function addTokenVariantFolders(groups) {
  let cfg;
  try { cfg = game.settings.get("token-variants", "settings"); } catch { return; }
  const paths = cfg?.searchPaths;
  if (!Array.isArray(paths)) return;
  for (const p of paths) {
    if (!p || typeof p.text !== "string") continue;
    if (p.source && p.source !== "data") continue;
    const norm = p.text.trim().replace(/^\.?\/+/, "").replace(/\/+$/, "");
    if (!norm || (norm.includes("/") && PUBLIC_DIRS.has(norm.split("/")[0]))) continue;
    const key = `F|${norm}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, norm, raw: p.text, kind: "folder", ext: "", isWildcard: false, isExternal: false,
        isCore: false, isFolder: true, expect: null, expects: new Set(), activeCount: 1,
        owners: new Map([["token-variants", "active"]]), offOwners: new Map(), refs: [], count: 0, status: null, extra: null
      };
      groups.set(key, g);
    }
    g.count++;
    g.refs.push({
      origin: "setting", location: "Token Variant Art › pasta de busca", field: "searchPaths.text",
      uuids: [], via: "path", pack: null, docType: "Setting", owner: "token-variants", ownerState: "active"
    });
  }
}
