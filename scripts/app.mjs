import { MODULE_ID, ORIGINS, KINDS, SEVERITY } from "./constants.mjs";
import { _getState } from "./state.mjs";
import { runScan } from "./scan.mjs";
import { pickModule, modulesWithPacks } from "./module-picker.mjs";
import { openReplace } from "./replace-app.mjs";
import { isReplaceable, undoBatch } from "./replace.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------
const t = (key) => game.i18n.localize(key);
const fmt = (key, data = {}) => {
  let s = game.i18n.localize(key);
  for (const [k, v] of Object.entries(data)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const TABS = ["problems", "broken", "warn", "ok", "skip", "hidden"];
const KIND_ICON = {
  image: "fa-image", video: "fa-film", audio: "fa-music", other: "fa-file", folder: "fa-folder"
};

/** Chips de tipo e origem: nenhum marcado = sem filtro; marcar mostra so aquele. */
export function defaultFilters() {
  return { status: "problems", kinds: {}, origins: {}, ext: "", text: "", prefix: "" };
}

const parseExts = (s) => (s ?? "").split(/[\s,;]+/).map((x) => x.replace(/^\./, "").toLowerCase()).filter(Boolean);
const sevOf = (g) => SEVERITY[g.status] ?? "skip";
const anyOn = (o) => Object.values(o).some(Boolean);

const isHidden = (g) => !!_getState().hidden?.[g.norm];

const statusMatch = (g, status) => {
  const hid = isHidden(g);
  if (status === "hidden") return hid;
  if (hid) return false;
  const sev = sevOf(g);
  return status === "problems" ? sev === "broken" || sev === "warn" : sev === status;
};

function passes(g, f) {
  if (!statusMatch(g, f.status)) return false;
  if (anyOn(f.kinds) && !f.kinds[g.kind ?? "other"]) return false;
  if (anyOn(f.origins) && !g.refs.some((r) => f.origins[r.origin])) return false;
  const exts = parseExts(f.ext);
  if (exts.length && !exts.includes(g.ext)) return false;
  if (f.prefix) {
    const p = f.prefix.trim().toLowerCase().replace(/^\.?\/+/, "");
    if (!g.norm.toLowerCase().startsWith(p)) return false;
  }
  if (f.text) {
    const q = f.text.trim().toLowerCase();
    if (!g.norm.toLowerCase().includes(q) && !g.refs.some((r) => r.location.toLowerCase().includes(q))) return false;
  }
  return true;
}

function detailOf(g) {
  let s = detailCore(g);
  if (["broken", "warn"].includes(sevOf(g)) && g.owners?.size) {
    const list = [...g.owners].slice(0, 4).map(([id, st]) => `${id} (${t(`ALD.OwnerState.${st}`)})`).join(", ");
    s += ` ${fmt("ALD.D.Owners", { list })}`;
  }
  return s;
}

function detailCore(g) {
  const x = g.extra ?? {};
  const o = x.owner;
  const expLabel = g.expect === "audio" ? t("ALD.Exp.audio") : t("ALD.Exp.visual");
  switch (g.status) {
    case "ok":
      if (g.isFolder) return fmt("ALD.D.FolderOk", { n: x.count });
      if (g.isWildcard) return fmt("ALD.D.WildOk", { n: x.matched });
      return "";
    case "missing": {
      if (x.dirMissing) {
        if (o?.type === "module" && o.state === "notinstalled") return fmt("ALD.D.ModuleMissing", { id: o.id });
        if (o?.type === "system" && o.state === "other") return fmt("ALD.D.SystemOther", { id: o.id });
        return t("ALD.D.DirMissing");
      }
      let s = x.dirCount != null ? fmt("ALD.D.MissingInDir", { n: x.dirCount }) : t("ALD.D.Missing");
      if (x.suggestion) s += " " + fmt("ALD.D.SameStem", { name: x.suggestion });
      if (o?.type === "module" && o.state === "inactive") s += " " + fmt("ALD.D.ModuleInactive", { id: o.id });
      return s;
    }
    case "case": return fmt("ALD.D.Case", { name: x.actual });
    case "wrongtype": return fmt("ALD.D.WrongType", { expected: expLabel, found: t(`ALD.Kind.${g.kind}`) });
    case "wild_empty": return x.dirMissing ? t("ALD.D.WildEmptyDir") : t("ALD.D.WildEmpty");
    case "wild_wrongtype": return fmt("ALD.D.WildWrong", { n: x.matched, expected: expLabel });
    case "wild_mixed": return fmt("ALD.D.WildMixed", { n: x.matched, bad: x.bad, expected: expLabel });
    case "folder_missing": return t("ALD.D.FolderMissing");
    case "inactive_owner": {
      const was = t(`ALD.Was.${x.was}`);
      const list = (x.off ?? []).map((o2) => `${o2.id} (${t(`ALD.OwnerState.${o2.state}`)})`).join(", ");
      return fmt("ALD.D.InactiveOwner", { id: list, was });
    }
    case "placeholder": return t("ALD.D.Placeholder");
    case "external": return t("ALD.D.External");
    case "core": return t("ALD.D.Core");
    default: return "";
  }
}

function scopeText(o = {}) {
  const parts = [];
  if (o.world) parts.push(t("ALD.OptWorld"));
  if (o.compendiums) parts.push(o.modulePacks ? `${t("ALD.OptComp")} + ${t("ALD.OptModPacks")}` : t("ALD.OptComp"));
  if (o.module && o.moduleId) parts.push(`${t("ALD.OptModule")}: ${o.moduleId}`);
  return parts.join(" | ") || t("ALD.NeedScopeShort");
}

function shellHTML(scopeOpen) {
  return `
  <header class="ald-top">
    <div class="ald-titleline">
      <h2>${esc(t("ALD.Title"))}</h2>
      <span class="ald-ver">v${esc(game.modules.get(MODULE_ID)?.version ?? "")}</span>
      <span class="ald-sub">${esc(t("ALD.Subtitle"))}</span>
    </div>
    <div class="ald-actions">
      <button type="button" class="ald-btn-primary" data-action="scan" id="ald-btn-scan"><i class="fa-solid fa-magnifying-glass"></i> ${esc(t("ALD.Scan"))}</button>
      <button type="button" class="ald-btn" data-action="cancel" id="ald-btn-cancel" hidden><i class="fa-solid fa-xmark"></i> ${esc(t("ALD.Cancel"))}</button>
      <button type="button" class="ald-btn" data-action="bulk" id="ald-btn-bulk" disabled title="${esc(t("ALD.BulkTip"))}"><i class="fa-solid fa-right-left"></i> ${esc(t("ALD.Bulk"))}</button>
      <button type="button" class="ald-btn" data-action="undo-last" id="ald-btn-undo" hidden><i class="fa-solid fa-rotate-left"></i> ${esc(t("ALD.UndoLast"))}</button>
      <button type="button" class="ald-btn" data-action="export" id="ald-btn-export" disabled><i class="fa-solid fa-file-csv"></i> ${esc(t("ALD.Export"))}</button>
      <button type="button" class="ald-btn" data-action="maximize" id="ald-btn-max"><i class="fa-solid fa-expand"></i> <span>${esc(t("ALD.Maximize"))}</span></button>
    </div>
  </header>

  <details class="ald-scope" id="ald-scope" ${scopeOpen ? "open" : ""}>
    <summary><i class="fa-solid fa-sliders"></i> <b>${esc(t("ALD.ScopeTitle"))}:</b> <span id="ald-scope-sum"></span></summary>
    <div class="ald-scope-body">
      <label class="ald-opt"><input type="checkbox" id="ald-opt-world">
        <span><b>${esc(t("ALD.OptWorld"))}</b><small>${esc(t("ALD.OptWorldHelp"))}</small></span></label>
      <label class="ald-opt"><input type="checkbox" id="ald-opt-comp">
        <span><b>${esc(t("ALD.OptComp"))}</b><small>${esc(t("ALD.OptCompHelp"))}</small></span></label>
      <label class="ald-opt ald-sub-opt"><input type="checkbox" id="ald-opt-modpacks">
        <span><b>${esc(t("ALD.OptModPacks"))}</b><small>${esc(t("ALD.OptModPacksHelp"))}</small></span></label>
      <div class="ald-opt-row">
        <label class="ald-opt"><input type="checkbox" id="ald-opt-module">
          <span><b>${esc(t("ALD.OptModule"))}</b><small>${esc(t("ALD.OptModuleHelp"))}</small></span></label>
        <button type="button" class="ald-btn" data-action="pick-module" id="ald-btn-module"><i class="fa-solid fa-cubes"></i> <span>${esc(t("ALD.ChooseModule"))}</span></button>
      </div>
      <div class="ald-scope-warn" id="ald-scope-warn" hidden>${esc(t("ALD.NeedScope"))}</div>
    </div>
  </details>

  <section class="ald-progress" id="ald-progress" hidden>
    <div class="ald-bar"><i id="ald-bar-fill"></i></div>
    <div class="ald-ptext" id="ald-ptext"></div>
  </section>

  <section class="ald-toolbar" id="ald-toolbar" hidden>
    <div class="ald-tabs" id="ald-tabs"></div>
    <input type="search" id="ald-text" placeholder="${esc(t("ALD.SearchPh"))}" title="${esc(t("ALD.FieldTextHelp"))}">
    <button type="button" class="ald-btn" data-action="toggle-filters" id="ald-btn-filters"><i class="fa-solid fa-filter"></i> <span>${esc(t("ALD.Filters"))}</span> <em id="ald-fcount"></em></button>
  </section>

  <section class="ald-filters" id="ald-filters" hidden>
    <div id="ald-chips"></div>
    <div class="ald-filter-inputs">
      <label class="ald-fld ald-grow"><span>${esc(t("ALD.FieldFolder"))}</span>
        <input type="text" id="ald-prefix" list="ald-roots" placeholder="${esc(t("ALD.FPrefix"))}">
        <datalist id="ald-roots"></datalist>
        <small>${esc(t("ALD.FieldFolderHelp"))}</small></label>
      <label class="ald-fld"><span>${esc(t("ALD.FieldExt"))}</span>
        <input type="text" id="ald-ext" list="ald-exts" placeholder="${esc(t("ALD.FExt"))}">
        <datalist id="ald-exts"></datalist>
        <small>${esc(t("ALD.FieldExtHelp"))}</small></label>
      <button type="button" class="ald-btn ald-reset" data-action="reset"><i class="fa-solid fa-rotate-left"></i> ${esc(t("ALD.Reset"))}</button>
    </div>
  </section>

  <div class="ald-info" id="ald-info" hidden></div>
  <div class="ald-listwrap" id="ald-listwrap"><div class="ald-list" id="ald-list"></div></div>
  <footer class="ald-footer" id="ald-footer"></footer>`;
}

// ---------------------------------------------------------------------------
// Janela
// ---------------------------------------------------------------------------
export class AssetLinkDoctorApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "ald-app",
    window: { title: "ALD.Title", icon: "fa-solid fa-link-slash", resizable: true },
    position: { width: 1020, height: 740 }
  };

  constructor(options = {}) {
    super({
      ...options,
      position: {
        width: Math.min(1020, window.innerWidth - 40),
        height: Math.min(740, window.innerHeight - 40),
        ...(options.position ?? {})
      }
    });
  }

  async _renderHTML() {
    const S = _getState();
    const root = document.createElement("div");
    root.id = "ald-root";
    root.innerHTML = shellHTML(S.scopeOpen ?? !S.result);
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    this._mount(result, content);
  }

  _onClose() {
    const S = _getState();
    if (S.scanning) S.cancel = true;
    this._ro?.disconnect();
    this._root = null;
    this._prevPos = null;
  }

  // ---- montagem -----------------------------------------------------------
  _mount(root, wc) {
    const S = _getState();
    this._root = root;
    const q = (s) => root.querySelector(s);
    q("#ald-opt-world").checked = !!S.options.world;
    q("#ald-opt-comp").checked = !!S.options.compendiums;
    q("#ald-opt-modpacks").checked = !!S.options.modulePacks;
    q("#ald-opt-module").checked = !!S.options.module;
    q("#ald-text").value = S.filters.text;
    q("#ald-prefix").value = S.filters.prefix;
    q("#ald-ext").value = S.filters.ext;
    q("#ald-filters").hidden = !S.filtersOpen;

    root.addEventListener("click", (ev) => this._onClick(ev));
    root.addEventListener("input", (ev) => this._onInput(ev));
    root.addEventListener("change", (ev) => this._onChange(ev));
    q("#ald-scope").addEventListener("toggle", (ev) => { S.scopeOpen = ev.target.open; });

    // Altura da lista em px (LEARNINGS #002)
    this._ro?.disconnect();
    const listWrap = q("#ald-listwrap");
    const recalc = () => {
      if (!root.isConnected) return;
      const others = [...root.children].filter((c) => c !== listWrap).reduce((s, c) => s + c.offsetHeight, 0);
      const h = Math.max(140, wc.clientHeight - others);
      listWrap.style.setProperty("height", `${h}px`, "important");
    };
    this._ro = new ResizeObserver(recalc);
    this._ro.observe(wc);
    for (const c of root.children) if (c !== listWrap) this._ro.observe(c);
    requestAnimationFrame(recalc);

    this._syncScanUI();
    this._syncMaxUI();
    if (S.result) this._renderAll();
    else this._renderEmpty();
  }

  // ---- eventos ------------------------------------------------------------
  _onClick(ev) {
    const el = ev.target.closest("[data-action]");
    if (!el || !this._root?.contains(el)) return;
    const S = _getState();
    const a = el.dataset.action;

    switch (a) {
      case "scan": return void this._startScan();
      case "cancel": S.cancel = true; return;
      case "export": return this._exportCsv();
      case "pick-module": return void this._chooseModule();
      case "maximize": return this._toggleMax();
      case "bulk": return this._openBulk();
      case "undo-last": return void this._undoLast();
      case "toggle-filters":
        S.filtersOpen = !S.filtersOpen;
        this._root.querySelector("#ald-filters").hidden = !S.filtersOpen;
        return;
      case "reset":
        S.filters = defaultFilters();
        for (const id of ["text", "prefix", "ext"]) this._root.querySelector(`#ald-${id}`).value = "";
        S.limit = 200;
        return this._renderAll();
      case "tab": S.filters.status = el.dataset.id; break;
      case "chip-kind": S.filters.kinds[el.dataset.id] = !S.filters.kinds[el.dataset.id]; break;
      case "chip-origin": S.filters.origins[el.dataset.id] = !S.filters.origins[el.dataset.id]; break;
      case "more": S.limit += 200; return this._renderList();
      case "toggle-row":
        S.expanded[el.dataset.key] = !S.expanded[el.dataset.key];
        return this._renderList();
      case "copy": ev.stopPropagation(); return void this._copy(el.dataset.path);
      case "open": ev.stopPropagation(); return void this._open(el.dataset.uuids);
      case "replace": ev.stopPropagation(); return this._openSingle(el.dataset.key);
      case "hide":
      case "unhide": {
        ev.stopPropagation();
        const g = S.index?.get(el.dataset.key);
        if (!g) return;
        S.hidden = { ...(S.hidden ?? {}) };
        if (a === "hide") S.hidden[g.norm] = Date.now(); else delete S.hidden[g.norm];
        void this._saveHidden();
        this._renderFilters();
        return this._renderList();
      }
      case "unhide-all":
        S.hidden = {};
        void this._saveHidden();
        this._renderFilters();
        return this._renderList();
      default: return;
    }
    S.limit = 200;
    this._renderFilters();
    this._renderList();
  }

  _onInput(ev) {
    const S = _getState();
    const field = { "ald-text": "text", "ald-prefix": "prefix", "ald-ext": "ext" }[ev.target.id];
    if (!field) return;
    S.filters[field] = ev.target.value;
    S.limit = 200;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => { this._renderFilters(); this._renderList(); }, 150);
  }

  async _onChange(ev) {
    const S = _getState();
    const id = ev.target.id;
    if (!["ald-opt-world", "ald-opt-comp", "ald-opt-modpacks", "ald-opt-module"].includes(id)) return;
    const r = this._root;
    S.options.world = r.querySelector("#ald-opt-world").checked;
    S.options.compendiums = r.querySelector("#ald-opt-comp").checked;
    S.options.modulePacks = r.querySelector("#ald-opt-modpacks").checked;
    S.options.module = r.querySelector("#ald-opt-module").checked;
    if (id === "ald-opt-module" && S.options.module && !S.options.moduleId) {
      await this._chooseModule();
      return;
    }
    await this._saveOptions();
    this._syncScanUI();
  }

  async _saveHidden() {
    const S = _getState();
    try { await game.settings.set(MODULE_ID, "hiddenPaths", { ...(S.hidden ?? {}) }); } catch { /* ignora */ }
  }

  async _saveOptions() {
    const S = _getState();
    try { await game.settings.set(MODULE_ID, "scanOptions", { ...S.options }); } catch { /* ignora */ }
  }

  async _chooseModule() {
    const S = _getState();
    const id = await pickModule(S.options.moduleId);
    if (id) S.options.moduleId = id;
    else if (!S.options.moduleId) S.options.module = false;
    if (this._root) this._root.querySelector("#ald-opt-module").checked = !!S.options.module;
    await this._saveOptions();
    this._syncScanUI();
  }

  // ---- maximizar ----------------------------------------------------------
  _toggleMax() {
    if (this._prevPos) {
      this.setPosition(this._prevPos);
      this._prevPos = null;
    } else {
      const p = this.position;
      this._prevPos = { left: p.left, top: p.top, width: p.width, height: p.height };
      this.setPosition({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    }
    this._syncMaxUI();
  }

  _syncMaxUI() {
    const b = this._root?.querySelector("#ald-btn-max");
    if (!b) return;
    const max = !!this._prevPos;
    b.querySelector("i").className = `fa-solid ${max ? "fa-compress" : "fa-expand"}`;
    b.querySelector("span").textContent = t(max ? "ALD.Restore" : "ALD.Maximize");
  }

  // ---- varredura ----------------------------------------------------------
  async _startScan() {
    const S = _getState();
    if (S.scanning) return;
    S.scanning = true;
    S.cancel = false;
    S.scopeOpen = false;
    const det = this._root?.querySelector("#ald-scope");
    if (det) det.open = false;
    this._syncScanUI();
    this._setProgress({ phase: "docs", done: 0, total: 0 });

    let result = null;
    try {
      result = await runScan({ ...S.options }, {
        onProgress: (p) => this._setProgress(p),
        isCancelled: () => S.cancel
      });
    } catch (e) {
      console.error(`[${MODULE_ID}]`, e);
      ui.notifications.error(fmt("ALD.ScanError", { msg: e.message }));
    }

    S.scanning = false;
    const cancelled = S.cancel;
    S.cancel = false;
    if (result) {
      S.result = result;
      S.index = new Map(result.groups.map((g) => [g.key, g]));
      S.expanded = {};
      S.limit = 200;
    } else if (cancelled) {
      ui.notifications.info(t("ALD.Cancelled"));
    }
    if (!this._root) return;
    this._syncScanUI();
    if (S.result) this._renderAll();
  }

  _syncScanUI() {
    const r = this._root;
    if (!r) return;
    const S = _getState();
    const o = S.options;
    const hasSource = !!o.world || !!o.compendiums || (!!o.module && !!o.moduleId);
    r.querySelector("#ald-btn-scan").disabled = S.scanning || !hasSource;
    r.querySelector("#ald-btn-scan").lastChild.textContent = ` ${S.result ? t("ALD.Rescan") : t("ALD.Scan")}`;
    r.querySelector("#ald-btn-cancel").hidden = !S.scanning;
    r.querySelector("#ald-btn-export").disabled = S.scanning || !S.result;
    r.querySelector("#ald-btn-bulk").disabled = S.scanning || !S.result;
    r.querySelector("#ald-btn-undo").hidden = !S.lastBatch;
    r.querySelector("#ald-btn-undo").disabled = S.scanning;
    for (const id of ["world", "comp", "module"]) r.querySelector(`#ald-opt-${id}`).disabled = S.scanning;
    r.querySelector("#ald-opt-modpacks").disabled = S.scanning || !o.compendiums;
    r.querySelector("#ald-btn-module").disabled = S.scanning || !o.module;
    const name = modulesWithPacks().find((m) => m.id === o.moduleId)?.title ?? o.moduleId;
    r.querySelector("#ald-btn-module span").textContent = o.moduleId ? name : t("ALD.ChooseModule");
    r.querySelector("#ald-scope-warn").hidden = hasSource;
    r.querySelector("#ald-scope-sum").textContent = scopeText(o);
    r.querySelector("#ald-progress").hidden = !S.scanning;
  }

  _setProgress({ phase, done, total }) {
    const r = this._root;
    if (!r) return;
    const pct = total ? Math.round((done / total) * 100) : 0;
    r.querySelector("#ald-bar-fill").style.width = `${pct}%`;
    const label = t(`ALD.Phase.${phase}`);
    r.querySelector("#ald-ptext").textContent = total
      ? `${label}: ${fmt("ALD.Of", { done, total })}`
      : `${label}...`;
  }

  // ---- renderizacao -------------------------------------------------------
  _renderAll() {
    const r = this._root;
    r.querySelector("#ald-toolbar").hidden = false;
    r.querySelector("#ald-info").hidden = false;
    this._renderInfo();
    this._renderFilters();
    this._renderList();
  }

  _renderEmpty() {
    const r = this._root;
    r.querySelector("#ald-toolbar").hidden = true;
    r.querySelector("#ald-filters").hidden = true;
    r.querySelector("#ald-info").hidden = true;
    r.querySelector("#ald-list").innerHTML = `<div class="ald-empty">${esc(t("ALD.NoScan"))}</div>`;
    r.querySelector("#ald-footer").textContent = "";
  }

  _renderInfo() {
    const S = _getState();
    const { stats, durationMs, groups, options } = S.result;
    const el = this._root.querySelector("#ald-info");
    const timing = Object.entries(stats.timings ?? {}).map(([k, v]) => `${k}: ${(v / 1000).toFixed(1)}s`).join("\n");
    el.title = timing;
    el.textContent = fmt("ALD.InfoLine", {
      scope: scopeText(options), paths: groups.length, uses: stats.refs, secs: (durationMs / 1000).toFixed(1)
    }) + (stats.warnings.length ? ` | ${fmt("ALD.ReadWarnings", { n: stats.warnings.length })}` : "");
    if (stats.warnings.length) el.title += `\n${stats.warnings.join("\n")}`;
  }

  _renderFilters() {
    const S = _getState();
    const f = S.filters;
    const { groups } = S.result;

    // abas de situacao (uma por vez)
    const live = { broken: 0, warn: 0, ok: 0, skip: 0, hidden: 0 };
    for (const g of groups) { if (isHidden(g)) live.hidden++; else live[sevOf(g)]++; }
    const tabCount = { problems: live.broken + live.warn, broken: live.broken, warn: live.warn, ok: live.ok, skip: live.skip, hidden: live.hidden };
    this._root.querySelector("#ald-tabs").innerHTML = TABS.map((tb) =>
      `<button type="button" class="ald-tab ${f.status === tb ? "on" : ""} ald-tab-${tb}" data-action="tab" data-id="${tb}">${esc(t(`ALD.Tab.${tb}`))} <em>${tabCount[tb]}</em></button>`).join("");

    // contadores dos chips: so grupos da aba atual
    const base = groups.filter((g) => statusMatch(g, f.status));
    const countKind = {};
    const countOrigin = {};
    for (const g of base) {
      const k = g.kind ?? "other";
      countKind[k] = (countKind[k] ?? 0) + 1;
      for (const o of new Set(g.refs.map((r) => r.origin))) countOrigin[o] = (countOrigin[o] ?? 0) + 1;
    }
    const chip = (action, id, label, count, on) =>
      `<button type="button" class="ald-chip ${on ? "on" : ""} ${count === 0 && !on ? "zero" : ""}" data-action="${action}" data-id="${id}">${esc(label)} <em>${count}</em></button>`;
    this._root.querySelector("#ald-chips").innerHTML = `
      <div class="ald-chiprow"><span class="ald-chiplabel">${esc(t("ALD.FKind"))}</span>${
        KINDS.map((k) => chip("chip-kind", k, t(`ALD.Kind.${k}`), countKind[k] ?? 0, !!f.kinds[k])).join("")}</div>
      <div class="ald-chiprow"><span class="ald-chiplabel">${esc(t("ALD.FOrigin"))}</span>${
        ORIGINS.map((o) => chip("chip-origin", o, t(`ALD.Origin.${o}`), countOrigin[o] ?? 0, !!f.origins[o])).join("")}</div>`;

    // extensoes e raizes sugeridas
    const extCount = {};
    for (const g of base) if (g.ext) extCount[g.ext] = (extCount[g.ext] ?? 0) + 1;
    this._root.querySelector("#ald-exts").innerHTML = Object.keys(extCount).sort()
      .map((e) => `<option value="${esc(e)}">${extCount[e]}</option>`).join("");
    const roots = {};
    for (const g of base) {
      const seg = g.norm.split("/");
      const root = ["modules", "systems", "worlds"].includes(seg[0]) && seg.length > 2 ? seg.slice(0, 2).join("/") : seg[0];
      roots[root] = (roots[root] ?? 0) + 1;
    }
    this._root.querySelector("#ald-roots").innerHTML = Object.entries(roots)
      .sort((a, b) => b[1] - a[1]).slice(0, 40).map(([r]) => `<option value="${esc(r)}"></option>`).join("");

    // numero de filtros ativos no botao "Filtros"
    const n = Object.values(f.kinds).filter(Boolean).length + Object.values(f.origins).filter(Boolean).length +
      (parseExts(f.ext).length ? 1 : 0) + (f.prefix.trim() ? 1 : 0);
    const badge = this._root.querySelector("#ald-fcount");
    badge.textContent = n ? String(n) : "";
    badge.hidden = !n;
  }

  _matches() {
    const S = _getState();
    return S.result.groups.filter((g) => passes(g, S.filters));
  }

  _renderList() {
    const S = _getState();
    const r = this._root;
    if (!r || !S.result) return;
    const matches = this._matches();
    const shown = matches.slice(0, S.limit);

    const rows = shown.map((g) => this._rowHTML(g, !!S.expanded[g.key])).join("");
    const emptyKey = S.filters.status === "hidden" ? "ALD.EmptyHidden" : "ALD.Empty";
    r.querySelector("#ald-list").innerHTML = rows || `<div class="ald-empty">${esc(t(emptyKey))}</div>`;

    r.querySelector("#ald-footer").innerHTML =
      `<span>${esc(fmt("ALD.Showing", { shown: shown.length, total: matches.length }))}</span>` +
      (matches.length > shown.length ? `<button type="button" class="ald-btn" data-action="more">${esc(t("ALD.More"))}</button>` : "") +
      (S.filters.status === "hidden" && matches.length ? `<button type="button" class="ald-btn" data-action="unhide-all"><i class="fa-solid fa-eye"></i> ${esc(t("ALD.UnhideAll"))}</button>` : "");
  }

  _rowHTML(g, expanded) {
    const sev = sevOf(g);
    const detail = detailOf(g);
    const uses = g.count === 1 ? t("ALD.Use1") : fmt("ALD.Uses", { n: g.count });
    const badge = g.isWildcard ? `<span class="ald-tag">${esc(t("ALD.Wildcard"))}</span>` : "";
    const canReplace = isReplaceable(g);
    const hidden = isHidden(g);
    let refsHTML = "";
    if (expanded) {
      const items = g.refs.slice(0, 100).map((ref) => {
        const uuids = (ref.uuids ?? []).join("|");
        return `<li>
          <span class="ald-origin">${esc(t(`ALD.Origin.${ref.origin}`))}</span>
          ${ref.owner ? `<span class="ald-owner ${esc(ref.ownerState)}" title="${esc(t("ALD.OwnerTip"))}">${esc(ref.owner)} · ${esc(t(`ALD.OwnerState.${ref.ownerState}`))}</span>` : ""}
          <span class="ald-loc">${esc(ref.location)}</span>
          <code class="ald-field">${esc(ref.field)}</code>
          ${uuids ? `<button type="button" class="ald-mini" data-action="open" data-uuids="${esc(uuids)}" title="${esc(t("ALD.Open"))}"><i class="fa-solid fa-up-right-from-square"></i></button>` : ""}
        </li>`;
      }).join("");
      const more = g.count > Math.min(g.refs.length, 100)
        ? `<li class="ald-more">${esc(fmt("ALD.MoreRefs", { n: g.count - Math.min(g.refs.length, 100) }))}</li>` : "";
      refsHTML = `<ul class="ald-refs">${items}${more}</ul>`;
    }
    return `
    <div class="ald-row ald-s-${sev}">
      <div class="ald-row-main" data-action="toggle-row" data-key="${esc(g.key)}">
        <i class="fa-solid fa-chevron-${expanded ? "down" : "right"} ald-chev"></i>
        <span class="ald-badge">${esc(t(`ALD.Sev.${sev}`))}</span>
        <i class="fa-solid ${KIND_ICON[g.kind ?? "other"]} ald-kind" title="${esc(t(`ALD.Kind.${g.kind ?? "other"}`))}"></i>
        <span class="ald-path" title="${esc(g.norm)}">${esc(g.norm)}</span>
        ${badge}
        <span class="ald-uses">${esc(uses)}</span>
        ${hidden
          ? `<button type="button" class="ald-hide" data-action="unhide" data-key="${esc(g.key)}" title="${esc(t("ALD.UnhideTip"))}"><i class="fa-solid fa-eye"></i> ${esc(t("ALD.Unhide"))}</button>`
          : `<button type="button" class="ald-hide" data-action="hide" data-key="${esc(g.key)}" title="${esc(t("ALD.HideTip"))}"><i class="fa-solid fa-eye-slash"></i> ${esc(t("ALD.Hide"))}</button>`}
        ${canReplace && !hidden ? `<button type="button" class="ald-replace" data-action="replace" data-key="${esc(g.key)}" title="${esc(t("ALD.ReplaceTip"))}"><i class="fa-solid fa-right-left"></i> ${esc(t("ALD.Replace"))}</button>` : ""}
        <button type="button" class="ald-mini" data-action="copy" data-path="${esc(g.norm)}" title="${esc(t("ALD.Copy"))}"><i class="fa-regular fa-copy"></i></button>
      </div>
      ${detail ? `<div class="ald-detail">${esc(detail)}</div>` : ""}
      ${refsHTML}
    </div>`;
  }

  // ---- trocar caminhos ----------------------------------------------------
  _openSingle(key) {
    const S = _getState();
    const g = S.index?.get(key);
    if (!g) return;
    openReplace({ mode: "single", group: g, onDone: () => this._startScan() });
  }

  _openBulk() {
    const S = _getState();
    if (!S.result) return;
    openReplace({ mode: "bulk", groups: this._matches(), onDone: () => this._startScan() });
  }

  async _undoLast() {
    const S = _getState();
    if (!S.lastBatch) return;
    const n = S.lastBatch.entries.length;
    const answer = await DialogV2.wait({
      window: { title: t("ALD.UndoLast") },
      content: `<p>${esc(fmt("ALD.UndoConfirm", { n }))}</p>`,
      buttons: [
        { action: "yes", label: t("ALD.UndoYes"), default: true },
        { action: "no", label: t("ALD.Cancel") }
      ],
      rejectClose: false
    }).catch(() => null);
    if (answer !== "yes") return;
    const res = await undoBatch(S.lastBatch);
    S.lastBatch = null;
    ui.notifications.info(fmt("ALD.Rep.UndoDone", { n: res.restored }));
    this._syncScanUI();
    this._startScan();
  }

  // ---- acoes --------------------------------------------------------------
  async _copy(text) {
    try { game.clipboard.copyPlainText(text); }
    catch { try { await navigator.clipboard.writeText(text); } catch { return; } }
    ui.notifications.info(t("ALD.Copied"));
  }

  async _open(uuidStr) {
    const list = (uuidStr ?? "").split("|").filter(Boolean).reverse();
    for (const u of list) {
      try {
        const doc = await fromUuid(u);
        if (doc?.sheet) { doc.sheet.render({ force: true }); return; }
      } catch { /* tenta o pai */ }
    }
    ui.notifications.warn(t("ALD.CantOpen"));
  }

  _exportCsv() {
    const S = _getState();
    if (!S.result) return;
    const q = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const rows = [["status", "tipo", "origem", "caminho", "local", "campo", "detalhe"].map(q).join(",")];
    for (const g of this._matches()) {
      const detail = detailOf(g);
      for (const ref of g.refs) {
        rows.push([t(`ALD.Sev.${sevOf(g)}`), t(`ALD.Kind.${g.kind ?? "other"}`), t(`ALD.Origin.${ref.origin}`),
          g.norm, ref.location, ref.field, detail].map(q).join(","));
      }
    }
    // saveDataToFile do Foundry (link fora da pagina). Um <a> anexado ao body era interceptado e abria "blob:" no Windows.
    const save = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
    save("\ufeff" + rows.join("\n"), "text/csv;charset=utf-8",
      `assets-doctor-report-${game.world.id}-${new Date().toISOString().slice(0, 10)}.csv`);
  }
}
