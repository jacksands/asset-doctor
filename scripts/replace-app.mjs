import { MODULE_ID, VERSION } from "./constants.mjs";
import { _getState } from "./state.mjs";
import {
  buildItems, checkItems, clearExistsCache, planDocs, applyPlan, undoBatch,
  encodeStored, decodedNorm, nearestExistingDir, isReplaceable
} from "./replace.mjs";
import { extOf, dirOf } from "./extract.mjs";
import { saveBackup, backupDir } from "./backup.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

const t = (key) => game.i18n.localize(key);
const fmt = (key, data = {}) => {
  let s = game.i18n.localize(key);
  for (const [k, v] of Object.entries(data)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

/**
 * Janela de troca de caminhos.
 *  mode "single": troca UM arquivo em todos os usos.
 *  mode "bulk":   regra (comeca com / contem / so extensao) aplicada aos itens mostrados na lista.
 */
export class ReplaceApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "ald-replace",
    window: { title: "ALD.Rep.Title", icon: "fa-solid fa-right-left", resizable: true },
    position: { width: 860, height: 660 }
  };

  /** @param {{mode:string, group?:object, groups?:object[], onDone?:Function}} data */
  constructor(data, options = {}) {
    super({
      ...options,
      position: {
        width: Math.min(860, window.innerWidth - 40),
        height: Math.min(660, window.innerHeight - 40),
        ...(options.position ?? {})
      }
    });
    this._d = data;
    this._items = [];
    this._token = 0;
    this._busy = false;
    this._cancel = false;
  }

  get title() {
    return t(this._d.mode === "single" ? "ALD.Rep.TitleSingle" : "ALD.Rep.TitleBulk");
  }

  async _renderHTML() {
    const root = document.createElement("div");
    root.id = "ald-rp-root";
    root.innerHTML = this._d.mode === "single" ? this._singleHTML() : this._bulkHTML();
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    this._mount(result, content);
  }

  _onClose() {
    this._cancel = true;
    this._token++;
    this._ro?.disconnect();
  }

  // ---- HTML ---------------------------------------------------------------
  _commonHTML() {
    const backupOn = _getState().options.backup !== false;
    return `
      <label class="rp-check"><input type="checkbox" id="rp-only-existing" checked>
        <span><b>${esc(t("ALD.Rep.OnlyExisting"))}</b><small>${esc(t("ALD.Rep.OnlyExistingHelp"))}</small></span></label>
      <label class="rp-check"><input type="checkbox" id="rp-backup" ${backupOn ? "checked" : ""}>
        <span><b>${esc(t("ALD.Rep.Backup"))}</b><small>${esc(fmt("ALD.Rep.BackupHelp", { dir: backupDir() }))}</small></span></label>
      <div class="rp-note" id="rp-status"></div>
      <div class="rp-preview" id="rp-preview"></div>
      <div class="rp-progress" id="rp-progress" hidden>
        <div class="rp-bar"><i id="rp-bar-fill"></i></div>
        <div class="rp-ptext" id="rp-ptext"></div>
      </div>`;
  }

  _footerHTML() {
    return `
      <footer class="rp-footer" id="rp-footer">
        <span id="rp-summary"></span>
        <span class="rp-spacer"></span>
        <button type="button" class="ald-btn" data-action="close">${esc(t("ALD.Rep.Close"))}</button>
        <button type="button" class="ald-btn-primary" data-action="apply" id="rp-apply" disabled><i class="fa-solid fa-check"></i> ${esc(t("ALD.Rep.Apply"))}</button>
      </footer>`;
  }

  _singleHTML() {
    const g = this._d.group;
    return `
      <div class="rp-body" id="rp-body">
        <section class="rp-block">
          <div class="rp-label">${esc(t("ALD.Rep.FileToReplace"))}</div>
          <div class="rp-path">${esc(g.norm)}</div>
          <div class="rp-hint">${esc(fmt("ALD.Rep.UsedIn", { n: g.count }))}</div>
        </section>
        <section class="rp-block">
          <label class="rp-field"><span>${esc(t("ALD.Rep.NewPath"))}</span>
            <div class="rp-inline">
              <input type="text" id="rp-to" placeholder="${esc(t("ALD.Rep.NewPathPh"))}">
              <button type="button" class="ald-btn" data-action="browse"><i class="fa-solid fa-folder-open"></i> ${esc(t("ALD.Rep.Browse"))}</button>
            </div>
            <small>${esc(t("ALD.Rep.NewPathHelp"))}</small></label>
        </section>
        ${this._commonHTML()}
      </div>
      ${this._footerHTML()}`;
  }

  _bulkHTML() {
    const n = this._d.groups.filter(isReplaceable).length;
    return `
      <div class="rp-body" id="rp-body">
        <section class="rp-block">
          <div class="rp-hint">${esc(fmt("ALD.Rep.BulkHint", { n }))}</div>
        </section>
        <section class="rp-grid">
          <label class="rp-field"><span>${esc(t("ALD.Rep.Mode"))}</span>
            <select id="rp-mode">
              <option value="prefix">${esc(t("ALD.Rep.ModePrefix"))}</option>
              <option value="contains">${esc(t("ALD.Rep.ModeContains"))}</option>
              <option value="ext">${esc(t("ALD.Rep.ModeExt"))}</option>
            </select></label>
          <label class="rp-field"><span id="rp-find-label">${esc(t("ALD.Rep.Find"))}</span>
            <div class="rp-inline">
              <input type="text" id="rp-find" placeholder="${esc(t("ALD.Rep.FindPh"))}">
              <button type="button" class="ald-btn" data-action="browse-find" id="rp-browse-find" title="${esc(t("ALD.Rep.BrowseFind"))}"><i class="fa-solid fa-folder-open"></i> ${esc(t("ALD.Rep.Browse"))}</button>
            </div></label>
          <label class="rp-field"><span id="rp-repl-label">${esc(t("ALD.Rep.ReplaceWith"))}</span>
            <div class="rp-inline">
              <input type="text" id="rp-repl" placeholder="${esc(t("ALD.Rep.ReplPh"))}">
              <button type="button" class="ald-btn" data-action="browse-repl" id="rp-browse-repl" title="${esc(t("ALD.Rep.BrowseRepl"))}"><i class="fa-solid fa-folder-open"></i> ${esc(t("ALD.Rep.Browse"))}</button>
            </div></label>
          <label class="rp-field" id="rp-newext-wrap"><span>${esc(t("ALD.Rep.AlsoExt"))}</span>
            <input type="text" id="rp-newext" placeholder="${esc(t("ALD.Rep.AlsoExtPh"))}"></label>
        </section>
        ${this._commonHTML()}
      </div>
      ${this._footerHTML()}`;
  }

  // ---- montagem -----------------------------------------------------------
  _mount(root, wc) {
    this._root = root;
    const q = (s) => root.querySelector(s);
    root.addEventListener("click", (ev) => this._onClick(ev));
    root.addEventListener("input", () => this._debounced());
    root.addEventListener("change", (ev) => {
      if (ev.target.id === "rp-only-existing") { this._renderPreview(true); return; }
      if (ev.target.id === "rp-backup") { this._saveBackupPref(); return; }
      if (ev.target.id === "rp-mode") this._syncModeUI();
      this._debounced();
    });

    // Altura da area rolavel em px (LEARNINGS #002)
    const body = q("#rp-body");
    const footer = q("#rp-footer");
    const recalc = () => {
      if (!root.isConnected) return;
      const h = Math.max(160, wc.clientHeight - footer.offsetHeight);
      body.style.setProperty("height", `${h}px`, "important");
    };
    this._ro = new ResizeObserver(recalc);
    this._ro.observe(wc);
    this._ro.observe(footer);
    requestAnimationFrame(recalc);

    this._syncModeUI();
    this._recompute();
  }

  _syncModeUI() {
    if (this._d.mode !== "bulk") return;
    const q = (s) => this._root.querySelector(s);
    const ext = q("#rp-mode").value === "ext";
    q("#rp-find-label").textContent = t(ext ? "ALD.Rep.FromExt" : "ALD.Rep.Find");
    q("#rp-repl-label").textContent = t(ext ? "ALD.Rep.ToExt" : "ALD.Rep.ReplaceWith");
    q("#rp-find").placeholder = t(ext ? "ALD.Rep.FromExtPh" : "ALD.Rep.FindPh");
    q("#rp-repl").placeholder = t(ext ? "ALD.Rep.ToExtPh" : "ALD.Rep.ReplPh");
    q("#rp-newext-wrap").hidden = ext;
    q("#rp-browse-find").hidden = ext;
    q("#rp-browse-repl").hidden = ext;
  }

  _debounced() {
    if (this._busy) return;
    clearTimeout(this._deb);
    this._deb = setTimeout(() => this._recompute(), 250);
  }

  _rule() {
    const v = (s) => this._root.querySelector(s)?.value ?? "";
    if (this._d.mode === "single") return { mode: "exact", to: v("#rp-to") };
    return { mode: v("#rp-mode"), find: v("#rp-find"), repl: v("#rp-repl"), newExt: v("#rp-newext") };
  }

  // ---- previa -------------------------------------------------------------
  async _recompute() {
    if (!this._root || this._busy) return;
    const token = ++this._token;
    const rule = this._rule();
    const groups = this._d.mode === "single" ? [this._d.group] : this._d.groups;
    const hasInput = this._d.mode === "single" ? !!rule.to.trim() : !!rule.find.trim();

    this._items = hasInput ? buildItems(groups, rule) : [];
    this._checking = this._items.length > 0;
    this._renderPreview(hasInput);
    if (!this._items.length) return;

    await checkItems(this._items, (done, total) => {
      if (token !== this._token) return;
      this._setStatus(`${t("ALD.Rep.Checking")}: ${fmt("ALD.Of", { done, total })}`);
    }, () => token !== this._token);
    if (token !== this._token) return;
    this._checking = false;
    this._setStatus("");
    this._renderPreview(true);
  }

  _setStatus(text) {
    const el = this._root?.querySelector("#rp-status");
    if (el) el.textContent = text;
  }

  _renderPreview(hasInput) {
    const r = this._root;
    const items = this._items;
    const uses = items.reduce((n, it) => n + it.group.count, 0);
    const ok = items.filter((it) => it.exists === true).length;
    const missing = items.filter((it) => it.exists === false).length;

    const rows = items.slice(0, 200).map((it) => {
      const st = it.exists === null ? ["unk", "fa-spinner fa-spin", ""] :
        it.exists ? ["ok", "fa-circle-check", t("ALD.Rep.NewExists")] : ["bad", "fa-circle-xmark", t("ALD.Rep.NewMissing")];
      return `<div class="rp-row">
        <span class="rp-old">${esc(it.group.norm)}</span>
        <span class="rp-arrow"><i class="fa-solid fa-arrow-down"></i></span>
        <span class="rp-new">${esc(it.newNorm)}</span>
        <span class="rp-meta"><span>${esc(fmt("ALD.Rep.UsedIn", { n: it.group.count }))}</span>
          <span class="rp-st ${st[0]}"><i class="fa-solid ${st[1]}"></i> ${esc(st[2])}</span></span>
      </div>`;
    }).join("");

    const empty = hasInput ? t("ALD.Rep.NoMatch") : t("ALD.Rep.TypeToPreview");
    r.querySelector("#rp-preview").innerHTML = rows || `<div class="rp-empty">${esc(empty)}</div>`;
    const more = items.length > 200 ? `<div class="rp-more">${esc(fmt("ALD.Rep.MoreRows", { n: items.length - 200 }))}</div>` : "";
    if (more) r.querySelector("#rp-preview").insertAdjacentHTML("beforeend", more);

    r.querySelector("#rp-summary").textContent = items.length
      ? fmt("ALD.Rep.Summary", { paths: items.length, uses, ok, missing: this._checking ? "..." : missing })
      : "";

    const onlyEx = r.querySelector("#rp-only-existing").checked;
    const canApply = items.length > 0 && !this._checking && (!onlyEx || ok > 0);
    r.querySelector("#rp-apply").disabled = !canApply;
  }

  // ---- eventos ------------------------------------------------------------
  _onClick(ev) {
    const el = ev.target.closest("[data-action]");
    if (!el || !this._root?.contains(el)) return;
    switch (el.dataset.action) {
      case "close": return void this.close();
      case "browse": return void this._browse();
      case "browse-find": return void this._browseField("find");
      case "browse-repl": return void this._browseField("repl");
      case "apply": return void this._apply();
      case "undo": return void this._undo();
      default: return;
    }
  }

  async _browse() {
    const g = this._d.group;
    const dir = await nearestExistingDir(g.norm);
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({
      type: "any",
      current: dir,
      callback: (path) => {
        const input = this._root?.querySelector("#rp-to");
        if (!input) return;
        input.value = path;
        this._recompute();
      }
    }).render({ force: true });
  }

  // ---- aplicar ------------------------------------------------------------
  _progress(text, done = 0, total = 0) {
    const r = this._root;
    if (!r) return;
    r.querySelector("#rp-progress").hidden = false;
    r.querySelector("#rp-bar-fill").style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
    r.querySelector("#rp-ptext").textContent = total ? `${text}: ${fmt("ALD.Of", { done, total })}` : `${text}...`;
  }

  _lock(on) {
    this._busy = on;
    const r = this._root;
    if (!r) return;
    for (const el of r.querySelectorAll("input, select, button")) {
      if (el.dataset.action === "close") continue;
      el.disabled = on;
    }
    if (!on && !this._resultShown) this._renderPreview(true);
  }

  async _apply() {
    const S = _getState();
    const r = this._root;
    const onlyEx = r.querySelector("#rp-only-existing").checked;
    const wantBackup = r.querySelector("#rp-backup").checked;
    const items = this._items.filter((it) => !onlyEx || it.exists === true);
    if (!items.length) return;

    const map = new Map();
    const chains = new Set();
    for (const it of items) {
      map.set(it.group.norm, encodeStored(it.newNorm));
      for (const c of it.group.chains) chains.add(c);
    }

    this._lock(true);
    this._cancel = false;
    try {
      this._progress(t("ALD.Rep.Preparing"));
      const plan = await planDocs(map, chains, (d, tot) => this._progress(t("ALD.Rep.Preparing"), d, tot), () => this._cancel);
      if (!plan.changes.length) {
        this._setStatus(fmt("ALD.Rep.NothingToChange", { n: plan.unresolved }));
        return;
      }

      const answer = await DialogV2.wait({
        window: { title: t("ALD.Rep.ConfirmTitle") },
        content: `<p>${esc(fmt("ALD.Rep.ConfirmText", { paths: items.length, docs: plan.changes.length, uses: plan.uses }))}</p>` +
          (wantBackup ? `<p>${esc(fmt("ALD.Rep.ConfirmBackup", { dir: backupDir() }))}</p>` : ""),
        buttons: [
          { action: "yes", label: t("ALD.Rep.ConfirmYes"), default: true },
          { action: "no", label: t("ALD.Cancel") }
        ],
        rejectClose: false
      }).catch(() => null);
      if (answer !== "yes") { this._setStatus(""); return; }

      let backupInfo = null;
      if (wantBackup) {
        this._progress(t("ALD.Rep.SavingBackup"));
        backupInfo = await saveBackup({
          module: MODULE_ID, version: VERSION, world: game.world.id, at: new Date().toISOString(),
          mapping: [...map].map(([from, to]) => ({ from, to })),
          entries: plan.changes.map((c) => ({ uuid: c.uuid, old: c.old }))
        });
        if (!backupInfo) {
          ui.notifications.error(t("ALD.Rep.BackupAbort"));
          this._setStatus(t("ALD.Rep.BackupAbort"));
          return;
        }
        if (backupInfo.where === "download") ui.notifications.warn(fmt("ALD.Rep.BackupDownloaded", { dir: backupDir() }));
      }

      this._progress(t("ALD.Rep.Applying"));
      const { failures, batch } = await applyPlan(plan, (d, tot) => this._progress(t("ALD.Rep.Applying"), d, tot), () => this._cancel);
      S.lastBatch = batch;
      clearExistsCache();
      this._showResult(plan, failures, backupInfo);
      this._d.onDone?.();
    } catch (err) {
      console.error(`[${MODULE_ID}]`, err);
      ui.notifications.error(fmt("ALD.ScanError", { msg: err.message }));
    } finally {
      this._lock(false);
      this._root?.querySelector("#rp-progress")?.setAttribute("hidden", "");
    }
  }

  async _saveBackupPref() {
    const S = _getState();
    S.options.backup = this._root?.querySelector("#rp-backup")?.checked !== false;
    try { await game.settings.set(MODULE_ID, "scanOptions", { ...S.options }); } catch { /* ignora */ }
  }

  /** Maior pasta em comum entre os itens candidatos (ponto de partida do navegador). */
  _commonDir() {
    const dirs = this._d.groups.filter(isReplaceable).map((g) => dirOf(g.norm).split("/"));
    if (!dirs.length) return "";
    let common = dirs[0];
    for (const d of dirs.slice(1)) {
      let i = 0;
      while (i < common.length && i < d.length && common[i] === d[i]) i++;
      common = common.slice(0, i);
      if (!common.length) break;
    }
    return common.join("/");
  }

  /** Navegador de pastas/arquivos para os campos Procurar e Trocar por. */
  async _browseField(which) {
    const r = this._root;
    const mode = r.querySelector("#rp-mode").value;
    const input = r.querySelector(which === "find" ? "#rp-find" : "#rp-repl");
    const base = which === "find" ? this._commonDir() : (decodedNorm(r.querySelector("#rp-find").value) || this._commonDir());
    const start = await nearestExistingDir(`${base.replace(/\/+$/, "")}/x`);
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({
      type: mode === "prefix" ? "folder" : "any",
      current: start,
      callback: (path) => {
        const p = decodedNorm(path);
        const isFile = !!extOf(p);
        input.value = mode === "prefix" && !isFile ? p.replace(/\/*$/, "/") : p;
        this._recompute();
      }
    }).render({ force: true });
  }

  _showResult(plan, failures, backupInfo) {
    const r = this._root;
    if (!r) return;
    let html = `<div class="rp-done"><b>${esc(fmt("ALD.Rep.Done", { docs: plan.changes.length - failures.length, uses: plan.uses }))}</b>`;
    if (plan.unresolved) html += `<div>${esc(fmt("ALD.Rep.Unresolved", { n: plan.unresolved }))}</div>`;
    if (failures.length) {
      html += `<div class="rp-fail">${esc(fmt("ALD.Rep.Failures", { n: failures.length }))}<ul>` +
        failures.slice(0, 20).map((f) => `<li>${esc(f.name)}: ${esc(f.message)}</li>`).join("") + `</ul></div>`;
    }
    if (backupInfo) {
      html += `<div>${esc(backupInfo.where === "data"
        ? fmt("ALD.Rep.BackupSaved", { path: backupInfo.path })
        : fmt("ALD.Rep.BackupDownloaded", { dir: backupDir() }))}</div>`;
    }
    html += `<div>${esc(t("ALD.Rep.RescanNote"))}</div></div>`;
    r.querySelector("#rp-preview").innerHTML = html;
    r.querySelector("#rp-summary").textContent = "";
    this._resultShown = true;
    r.querySelector("#rp-footer").innerHTML = `
      <span class="rp-spacer"></span>
      <button type="button" class="ald-btn" data-action="close">${esc(t("ALD.Rep.Close"))}</button>
      <button type="button" class="ald-btn" data-action="undo"><i class="fa-solid fa-rotate-left"></i> ${esc(t("ALD.Rep.Undo"))}</button>`;
  }

  async _undo() {
    const S = _getState();
    if (!S.lastBatch) return;
    this._lock(true);
    try {
      this._progress(t("ALD.Rep.Undoing"));
      const res = await undoBatch(S.lastBatch, (d, tot) => this._progress(t("ALD.Rep.Undoing"), d, tot));
      S.lastBatch = null;
      clearExistsCache();
      ui.notifications.info(fmt("ALD.Rep.UndoDone", { n: res.restored }));
      this._d.onDone?.();
      this.close();
    } catch (err) {
      console.error(`[${MODULE_ID}]`, err);
      ui.notifications.error(fmt("ALD.ScanError", { msg: err.message }));
    } finally {
      this._lock(false);
    }
  }
}

let current = null;

/** Abre a janela fechando outra que esteja aberta (so uma por vez, pois o id e fixo). */
export function openReplace(data) {
  try { current?.close(); } catch { /* ja fechada */ }
  foundry.applications.instances?.get?.("ald-replace")?.close();
  current = new ReplaceApp(data);
  current.render({ force: true });
  return current;
}
