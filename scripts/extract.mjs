import { IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, OTHER_EXT, PUBLIC_DIRS } from "./constants.mjs";

// ---------------------------------------------------------------------------
// Utilitarios de caminho
// ---------------------------------------------------------------------------
export const safeDecode = (s) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

export function extOf(p) {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i + 1).toLowerCase();
}

export function kindOfExt(ext) {
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (OTHER_EXT.has(ext)) return "other";
  return null;
}

export const dirOf = (p) => {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
};

const isCore = (norm) => norm.includes("/") && PUBLIC_DIRS.has(norm.split("/")[0]);

const WILDCARD = /\*|\{[^{}]*,[^{}]*\}/;
export const hasWildcard = (p) => WILDCARD.test(p);

/**
 * Decide se uma string e um caminho de arquivo (ou wildcard) e normaliza.
 * Retorna null se nao parecer um caminho.
 */
export function classifyString(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length < 3 || s.length > 600) return null;
  if (/[\n\r\t<>"]/.test(s)) return null;
  if (/^(data:|blob:|#|javascript:|mailto:|tel:)/i.test(s)) return null;

  const external = /^https?:\/\//i.test(s);
  // Em arquivos locais, "#" e "?" podem fazer parte do nome (ex.: "Faixa #1.mp3").
  // So removemos o que vem depois se, com ele, a extensao nao for reconhecida.
  const stripped = s.replace(/[?#].*$/, "");
  const base = !external && kindOfExt(extOf(safeDecode(s))) ? s : stripped;

  if (external) {
    const ext = extOf(base);
    const kind = kindOfExt(ext);
    if (!kind) return null;
    return { raw: s, base, norm: base, external: true, wildcard: false, core: false, bare: false, ext, kind };
  }

  const norm = safeDecode(base).replace(/^\.?\/+/, "");
  if (base.includes("/") && WILDCARD.test(base)) {
    return { raw: s, base, norm, external: false, wildcard: true, core: isCore(norm), bare: false, ext: "", kind: null };
  }

  const ext = extOf(norm);
  const kind = kindOfExt(ext);
  if (!kind) return null;
  return { raw: s, base, norm, external: false, wildcard: false, core: isCore(norm), bare: !norm.includes("/"), ext, kind };
}

// ---------------------------------------------------------------------------
// HTML (journals, descricoes de ator/item etc.)
// ---------------------------------------------------------------------------
const ATTR_RE = /\b(?:src|href|poster|data-src|data-url|data-image)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSSURL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]+))\s*\)/gi;

export function extractHtml(html) {
  const out = [];
  for (const m of html.matchAll(ATTR_RE)) out.push(m[1] ?? m[2]);
  for (const m of html.matchAll(CSSURL_RE)) out.push(m[1] ?? m[2] ?? m[3]);
  return out
    .filter(Boolean)
    .map((s) => s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/"));
}

/** Troca caminhos dentro de HTML. fn(caminhoDecodificado) devolve o novo caminho (ou null para manter). */
export function mapHtmlPaths(html, fn) {
  let changed = 0;
  const run = (re, pick) => {
    html = html.replace(re, (m, a, b, c) => {
      const raw = pick(a, b, c);
      if (!raw) return m;
      const dec = raw.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/");
      const nv = fn(dec);
      if (nv == null) return m;
      changed++;
      return m.split(raw).join(nv.replace(/&/g, "&amp;"));
    });
  };
  run(ATTR_RE, (a, b) => a ?? b);
  run(CSSURL_RE, (a, b, c) => a ?? b ?? c);
  return { html, changed };
}

// ---------------------------------------------------------------------------
// Origem e tipo esperado
// ---------------------------------------------------------------------------
const ADVENTURE_MAP = {
  scenes: "Scene", actors: "Actor", items: "Item", journal: "JournalEntry",
  playlists: "Playlist", tables: "RollTable", macros: "Macro", cards: "Cards"
};

export function originOf(topType, keys) {
  if (topType === "Adventure") {
    const mapped = ADVENTURE_MAP[keys[0]];
    return mapped ? originOf(mapped, keys.slice(1)) : "other";
  }
  const has = (k) => keys.includes(k);
  switch (topType) {
    case "Scene":
      if (has("tokens")) return "token";
      if (has("tiles")) return "tile";
      if (has("notes")) return "pin";
      if (has("sounds")) return "sound";
      if (has("drawings")) return "drawing";
      if (has("regions")) return "region";
      if (has("lights")) return "light";
      return "scene";
    case "Actor":
      if (has("prototypeToken")) return "token";
      if (has("items")) return "item";
      if (has("effects")) return "effect";
      return "actor";
    case "Item":
      return has("effects") ? "effect" : "item";
    case "JournalEntry": return "journal";
    case "Playlist": return "playlist";
    case "RollTable": return "table";
    case "Macro": return "macro";
    case "Cards": return "cards";
    case "User": return "user";
    case "Setting": return "setting";
    default: return "other";
  }
}

const VISUAL_KEY = /^(img|image|icon|src|avatar|texture|overlay|background|foreground|portrait|banner)$/i;

/** "audio" | "visual" | null (desconhecido: nao checa tipo) */
export function expectOf(topType, keys) {
  const last = keys[keys.length - 1] ?? "";
  if (last === "path" && (topType === "Playlist" || keys.includes("sounds"))) return "audio";
  if (VISUAL_KEY.test(last)) return "visual";
  return null;
}

/**
 * Namespaces de flags no caminho de um dado, de fora para dentro.
 * Ex.: flags.multi-token-edit.preset.data.flags.barbrawl.x -> ["multi-token-edit", "barbrawl"].
 * "system.flags" e dado do sistema, nao um namespace de modulo.
 */
export function flagNamespaces(keys) {
  const out = [];
  keys.forEach((k, i) => {
    if (k === "flags" && keys[i - 1] !== "system" && typeof keys[i + 1] === "string") out.push(keys[i + 1]);
  });
  return out;
}

/** Primeiro namespace (compatibilidade). */
export const flagOwnerOf = (keys) => flagNamespaces(keys)[0] ?? null;

// ---------------------------------------------------------------------------
// Percorre o _source de um documento (inclui filhos embutidos)
// ---------------------------------------------------------------------------
export const SKIP_KEYS = new Set(["_stats", "ownership", "_id", "folder", "sort", "walls", "thumb", "_source", "exploredScenes"]);

const EMBED_DOC = {
  tokens: "Token", tiles: "Tile", notes: "Note", sounds: "AmbientSound", drawings: "Drawing",
  lights: "AmbientLight", regions: "Region", behaviors: "RegionBehavior", levels: "Level",
  items: "Item", effects: "ActiveEffect", pages: "JournalEntryPage", results: "TableResult", cards: "Card"
};

const LABEL = {
  tokens: "Token", tiles: "Tile", notes: "Pin", sounds: "Som", drawings: "Desenho", lights: "Luz",
  regions: "Região", behaviors: "Comportamento", levels: "Nível", items: "Item", effects: "Efeito",
  pages: "Página", results: "Resultado", cards: "Carta"
};

function embeddedName(el) {
  const n = el.name ?? el.label ?? el.title ?? (typeof el.text === "string" ? el.text.slice(0, 40) : null);
  return n || String(el._id).slice(0, 6);
}

/**
 * @param {string} topType       documentName do documento de topo
 * @param {object} source        doc._source
 * @param {string[]} baseLabels  rotulos iniciais (nome do documento)
 * @param {string} topUuid
 * @param {(ref:{info:object,keys:string[],labels:string[],uuids:string[],via:string})=>void} emit
 */
export function walkSource(topType, source, baseLabels, topUuid, emit) {
  // Nome de arquivo solto (sem pasta) em campo desconhecido costuma ser rotulo ou cache de modulo, nao um link.
  const accept = (info, keys) => !(info.bare && !expectOf(topType, keys));

  const handleString = (s, keys, labels, uuids) => {
    const info = classifyString(s);
    if (info) {
      if (accept(info, keys)) emit({ info, keys, labels, uuids, via: "path" });
      return;
    }
    if (s.length > 20 && s.includes("<") && (s.includes("=") || s.includes("url("))) {
      for (const raw of extractHtml(s)) {
        const i = classifyString(raw);
        if (i && accept(i, keys)) emit({ info: i, keys, labels, uuids, via: "html" });
      }
    }
  };

  const visit = (value, keys, labels, uuids, depth) => {
    if (depth > 14 || value == null) return;
    const t = typeof value;
    if (t === "string") { handleString(value, keys, labels, uuids); return; }
    if (t !== "object") return;

    if (Array.isArray(value)) {
      const key = keys[keys.length - 1];
      for (const el of value) {
        if (el && typeof el === "object" && !Array.isArray(el)) {
          let l = labels;
          let u = uuids;
          if (el._id && key) {
            l = [...labels, `${LABEL[key] ?? key}: ${embeddedName(el)}`];
            const dn = key === "sounds" && topType === "Playlist" ? "PlaylistSound" : EMBED_DOC[key];
            if (dn && uuids.length) u = [...uuids, `${uuids[uuids.length - 1]}.${dn}.${el._id}`];
          }
          visit(el, keys, l, u, depth + 1);
        } else {
          visit(el, keys, labels, uuids, depth + 1);
        }
      }
      return;
    }

    for (const [k, v] of Object.entries(value)) {
      if (SKIP_KEYS.has(k)) continue;
      visit(v, [...keys, k], labels, uuids, depth + 1);
    }
  };

  visit(source, [], baseLabels, topUuid ? [topUuid] : [], 0);
}
