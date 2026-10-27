export const MODULE_ID = "asset-doctor";
export const VERSION = "1.0.0-beta";

export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp", "apng", "ico", "tif", "tiff"]);
export const VIDEO_EXT = new Set(["mp4", "webm", "ogv", "m4v", "mov", "mkv"]);
export const AUDIO_EXT = new Set(["mp3", "ogg", "oga", "wav", "flac", "m4a", "aac", "opus", "weba", "mid", "midi"]);
export const OTHER_EXT = new Set(["pdf", "glb", "gltf", "woff", "woff2", "ttf", "otf"]);

/** Pastas publicas do nucleo do Foundry (nao verificadas). */
export const PUBLIC_DIRS = new Set(["cards", "css", "fonts", "icons", "lang", "scripts", "sounds", "ui"]);

export const ORIGINS = [
  "scene", "token", "tile", "pin", "sound", "drawing", "region", "light",
  "actor", "item", "effect", "journal", "playlist", "table", "macro", "cards",
  "user", "setting", "other"
];
export const KINDS = ["image", "video", "audio", "other", "folder"];

/** status -> gravidade (broken | warn | ok | skip) */
export const SEVERITY = {
  missing: "broken",
  wild_empty: "broken",
  wild_wrongtype: "broken",
  folder_missing: "broken",
  case: "warn",
  wrongtype: "warn",
  wild_mixed: "warn",
  ok: "ok",
  external: "skip",
  core: "skip",
  inactive_owner: "skip",
  placeholder: "skip"
};

export const log = (...a) => console.log(`[${MODULE_ID}]`, ...a);
export const warn = (...a) => console.warn(`[${MODULE_ID}]`, ...a);
