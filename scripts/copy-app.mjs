import { MODULE_ID, getVersion, PUBLIC_DIRS } from "./constants.mjs";
import { _getState } from "./state.mjs";
import {
  decodedNorm, encodeStored, planDocs, applyPlan, undoBatch, nearestExistingDir, clearExistsCache
} from "./replace.mjs";
import {
  classifyGroups, expandWildcards, assignDestinations, readSizes, summarize, skippedByReason,
  copyAll, buildRelinkMapping, checkWildcards, buildReport, reportCsv, originCounts, formatBytes, KIND_ORDER, TYPE_FOLDER
} from "./copy.mjs";
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
const LIST_CAP = 200;

export const defaultCopyPrefs = () => ({
  dest: "", keepFolders: true, strip: "",
  types: { image: true, video: true, audio: true, other: true },
  includePackages: false, acceptResized: false, relink: false
});

/**
 * Janela "Copiar assets": copia os arquivos usados pelo mundo para uma pasta escolhida,
 * separados por tipo, e (opcionalmente) atualiza os caminhos do mundo.
 */
export class CopyApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "ald-copy",
    window: { title: "ALD.Copy.Title", icon: "fa-solid fa-box-archive", resizable: true },
    position: { width: 900, height: 700 }
  };

  /** @param {{groups:object[], scanOptions:object, onDone?:Function}} data */
  constructor(data, options = {}) {
    super({
      ...options,
      position: {
        width: Math.min(900, window.innerWidth - 40),
        height: Math.min(700, window.innerHeight - 40),
        ...(options.position ?? {})
      }
    });
    this._d = data;
    this._stage = "setup";
    this._cancel = false;
    this._busy = false;
    this._plan = null;
    this._result = null;
  }

  async _renderHTML() {
    const root = document.createElement("div");
    root.id = "ald-cp-root";
    root.innerHTML = this._shellHTML();
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    this._mount(result, content);
  }

  _onClose() {
    this._cancel = true;
    this._ro?.disconnect();
  }

  // ---- HTML ---------------------------------------------------------------
  _prefs() {
    const S = _getState();
    S.options.copy = { ...defaultCopyPrefs(), ...(S.options.copy ?? {}) };
    S.options.copy.types = { ...defaultCopyPrefs().types, ...(S.options.copy.types ?? {}) };
    return S.options.copy;
  }

  _scopeText() {
    const o = this._d.scanOptions ?? {};
    const parts = [];
    if (o.world) parts.push(t("ALD.OptWorld"));
    if (o.compendiums) parts.push(t("ALD.OptComp"));
    if (o.module && o.moduleId) parts.push(`${t("ALD.OptModule")}: ${o.moduleId}`);
    return parts.join(" | ") || "-";
  }

  /** Modulos ativos que costumam converter ou renomear arquivos no envio. */
  _uploadChangers() {
    return ["media-optimizer", "filepicker-plus"]
      .filter((id) => game.modules.get(id)?.active)
      .map((id) => game.modules.get(id).title ?? id);
  }

  _shellHTML() {
    const p = this._prefs();
    const changers = this._uploadChangers();
    const typeBox = (k, label) => `
      <label class="rp-check"><input type="checkbox" id="cp-t-${k}" ${p.types[k] ? "checked" : ""}>
        <span><b>${esc(label)}</b><small>${esc(`${TYPE_FOLDER[k]}/`)}</small></span></label>`;
    return `
    <div class="rp-body" id="cp-body">
      <section id="cp-setup">
        <div class="cp-backup-tip" id="cp-backup-tip">
          <i class="fa-solid fa-shield-halved"></i>
          <div><b>${esc(t("ALD.Copy.BackupTipTitle"))}</b>
            <p>${esc(t("ALD.Copy.BackupTipText"))}</p></div>
        </div>
        <div class="rp-hint">${esc(fmt("ALD.Copy.BasedOn", { scope: this._scopeText(), n: this._d.groups.length }))}</div>
        ${changers.length ? `<div class="cp-warn">${esc(fmt("ALD.Copy.OptimizerWarn", { list: changers.join(", ") }))}</div>` : ""}
        <label class="rp-field"><span>${esc(t("ALD.Copy.Dest"))}</span>
          <div class="rp-inline">
            <input type="text" id="cp-dest" value="${esc(p.dest)}" placeholder="${esc(t("ALD.Copy.DestPh"))}">
            <button type="button" class="ald-btn" data-action="browse-dest"><i class="fa-solid fa-folder-open"></i> ${esc(t("ALD.Rep.Browse"))}</button>
          </div>
          <small>${esc(t("ALD.Copy.DestHelp"))}</small></label>
        <div class="rp-grid">
          <label class="rp-field"><span>${esc(t("ALD.Copy.Layout"))}</span>
            <select id="cp-layout">
              <option value="keep" ${p.keepFolders ? "selected" : ""}>${esc(t("ALD.Copy.LayoutKeep"))}</option>
              <option value="flat" ${p.keepFolders ? "" : "selected"}>${esc(t("ALD.Copy.LayoutFlat"))}</option>
            </select>
            <small>${esc(t("ALD.Copy.LayoutHelp"))}</small></label>
          <label class="rp-field" id="cp-strip-wrap"><span>${esc(t("ALD.Copy.Strip"))}</span>
            <input type="text" id="cp-strip" value="${esc(p.strip)}" placeholder="${esc(t("ALD.Copy.StripPh"))}">
            <small>${esc(t("ALD.Copy.StripHelp"))}</small></label>
        </div>
        <div class="rp-label">${esc(t("ALD.Copy.WhatToCopy"))}</div>
        <div class="cp-types">
          ${typeBox("image", t("ALD.Copy.TypeImage"))}${typeBox("video", t("ALD.Copy.TypeVideo"))}
          ${typeBox("audio", t("ALD.Copy.TypeAudio"))}${typeBox("other", t("ALD.Copy.TypeOther"))}
        </div>
        <label class="rp-check"><input type="checkbox" id="cp-packages" ${p.includePackages ? "checked" : ""}>
          <span><b>${esc(t("ALD.Copy.IncludePackages"))}</b><small>${esc(t("ALD.Copy.IncludePackagesHelp"))}</small></span></label>
        <label class="rp-check"><input type="checkbox" id="cp-resized" ${p.acceptResized ? "checked" : ""}>
          <span><b>${esc(t("ALD.Copy.AcceptResized"))}</b><small>${esc(t("ALD.Copy.AcceptResizedHelp"))}</small></span></label>
        <label class="rp-check"><input type="checkbox" id="cp-relink" ${p.relink ? "checked" : ""}>
          <span><b>${esc(t("ALD.Copy.Relink"))}</b><small>${esc(t("ALD.Copy.RelinkHelp"))}</small></span></label>
        <label class="rp-check" id="cp-backup-wrap"><input type="checkbox" id="cp-backup" ${_getState().options.backup !== false ? "checked" : ""}>
          <span><b>${esc(t("ALD.Rep.Backup"))}</b><small>${esc(fmt("ALD.Rep.BackupHelp", { dir: backupDir() }))}</small></span></label>
      </section>
      <section id="cp-plan" hidden></section>
      <section id="cp-progress" hidden>
        <div class="rp-bar"><i id="cp-bar-fill"></i></div>
        <div class="rp-ptext" id="cp-ptext"></div>
      </section>
      <section id="cp-result" hidden></section>
      <div class="rp-note" id="cp-status"></div>
    </div>
    <footer class="rp-footer" id="cp-footer"></footer>`;
  }

  // ---- montagem -----------------------------------------------------------
  _mount(root, wc) {
    this._root = root;
    root.addEventListener("click", (ev) => this._onClick(ev));
    root.addEventListener("input", () => this._onInput());
    root.addEventListener("change", () => this._onInput());

    // Altura da area rolavel em px (LEARNINGS #002)
    const body = root.querySelector("#cp-body");
    const footer = root.querySelector("#cp-footer");
    const recalc = () => {
      if (!root.isConnected) return;
      const h = Math.max(160, wc.clientHeight - footer.offsetHeight);
      body.style.setProperty("height", `${h}px`, "important");
    };
    this._ro = new ResizeObserver(recalc);
    this._ro.observe(wc);
    this._ro.observe(footer);
    requestAnimationFrame(recalc);

    this._syncSetupUI();
    this._renderFooter();
  }

  _q(sel) { return this._root?.querySelector(sel); }

  _syncSetupUI() {
    const keep = this._q("#cp-layout").value === "keep";
    this._q("#cp-strip-wrap").hidden = !keep;
    this._q("#cp-backup-wrap").hidden = !this._q("#cp-relink").checked;
    this._q("#cp-backup-tip").classList.toggle("urgent", this._q("#cp-relink").checked);
  }

  /** Le as escolhas da tela (e guarda para a proxima vez). */
  _readOpts() {
    const p = this._prefs();
    p.dest = decodedNorm(this._q("#cp-dest").value).replace(/\/+$/, "");
    p.keepFolders = this._q("#cp-layout").value === "keep";
    p.strip = this._q("#cp-strip").value.trim();
    for (const k of KIND_ORDER) p.types[k] = this._q(`#cp-t-${k}`).checked;
    p.includePackages = this._q("#cp-packages").checked;
    p.acceptResized = this._q("#cp-resized").checked;
    p.relink = this._q("#cp-relink").checked;
    const S = _getState();
    S.options.backup = this._q("#cp-backup").checked;
    return p;
  }

  async _savePrefs() {
    const S = _getState();
    try { await game.settings.set(MODULE_ID, "scanOptions", { ...S.options }); } catch { /* ignora */ }
  }

  _onInput() {
    if (this._stage !== "setup" || this._busy) return;
    this._syncSetupUI();
    this._readOpts();
    clearTimeout(this._deb);
    this._deb = setTimeout(() => this._savePrefs(), 400);
  }

  // ---- rodape por etapa ---------------------------------------------------
  _renderFooter() {
    const f = this._q("#cp-footer");
    const S = _getState();
    const btn = (action, icon, label, primary = false, disabled = false) =>
      `<button type="button" class="${primary ? "ald-btn-primary" : "ald-btn"}" data-action="${action}" ${disabled ? "disabled" : ""}><i class="fa-solid ${icon}"></i> ${esc(label)}</button>`;
    let html = '<span id="cp-summary"></span><span class="rp-spacer"></span>';
    if (this._stage === "setup") html += btn("close", "fa-xmark", t("ALD.Rep.Close")) + btn("analyze", "fa-magnifying-glass", t("ALD.Copy.Analyze"), true);
    else if (this._stage === "plan") html += btn("close", "fa-xmark", t("ALD.Rep.Close")) + btn("back", "fa-arrow-left", t("ALD.Copy.Back")) +
      btn("start", "fa-play", t("ALD.Copy.Start"), true, !this._plan?.items.length);
    else if (this._stage === "copying") html += btn("cancel", "fa-ban", t("ALD.Cancel"));
    else html += btn("close", "fa-xmark", t("ALD.Rep.Close")) + btn("export", "fa-file-csv", t("ALD.Copy.ExportReport")) +
      (this._result?.relinked && S.lastBatch ? btn("undo-paths", "fa-rotate-left", t("ALD.Copy.UndoPaths")) : "");
    f.innerHTML = html;
    if (this._plan && this._stage === "plan") {
      const n = this._plan.items.length;
      const bytes = this._plan.items.reduce((s, it) => s + (it.size ?? 0), 0);
      this._q("#cp-summary").textContent = n ? fmt("ALD.Copy.PlanSummary", { files: n, size: formatBytes(bytes) }) : "";
    }
  }

  _show(stage) {
    this._stage = stage;
    this._q("#cp-setup").hidden = stage !== "setup";
    this._q("#cp-plan").hidden = stage !== "plan";
    this._q("#cp-progress").hidden = stage !== "copying" && !this._busy;
    this._q("#cp-result").hidden = stage !== "result";
    this._renderFooter();
    this._q("#cp-body").scrollTop = 0;
  }

  // ---- eventos ------------------------------------------------------------
  _onClick(ev) {
    const el = ev.target.closest("[data-action]");
    if (!el || !this._root?.contains(el)) return;
    switch (el.dataset.action) {
      case "close": return void this.close();
      case "browse-dest": return void this._browseDest();
      case "analyze": return void this._analyze();
      case "back": return this._backToSetup();
      case "start": return void this._start();
      case "cancel": this._cancel = true; this._setStatus(t("ALD.Copy.Cancelling")); return;
      case "export": return this._exportReport();
      case "undo-paths": return void this._undoPaths();
      default: return;
    }
  }

  async _browseDest() {
    const cur = decodedNorm(this._q("#cp-dest").value);
    const start = await nearestExistingDir(`${cur.replace(/\/+$/, "") || "modules"}/x`);
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({
      type: "folder",
      current: start,
      callback: (path) => {
        this._q("#cp-dest").value = decodedNorm(path).replace(/\/+$/, "");
        this._onInput();
      }
    }).render({ force: true });
  }

  _setStatus(text) { const el = this._q("#cp-status"); if (el) el.textContent = text; }

  _progress(label, done = 0, total = 0, extra = "") {
    this._q("#cp-progress").hidden = false;
    this._q("#cp-bar-fill").style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
    this._q("#cp-ptext").textContent = (total ? `${label}: ${fmt("ALD.Of", { done, total })}` : `${label}...`) + (extra ? ` | ${extra}` : "");
  }

  _lock(on) {
    this._busy = on;
    for (const el of this._root?.querySelectorAll("input, select, button") ?? []) {
      if (el.dataset.action === "close" || el.dataset.action === "cancel") continue;
      el.disabled = on;
    }
    if (!on) this._renderFooter();
  }

  _checkDest(dest) {
    if (!dest) return t("ALD.Copy.NeedDest");
    const first = dest.split("/")[0].toLowerCase();
    if (/^https?:/i.test(dest) || dest.split("/").includes("..") || PUBLIC_DIRS.has(first)) return t("ALD.Copy.DestInvalid");
    return null;
  }

  // ---- 1. analisar --------------------------------------------------------
  async _analyze() {
    const o = this._readOpts();
    await this._savePrefs();
    const problem = this._checkDest(o.dest);
    if (problem) { this._setStatus(problem); return; }
    if (!KIND_ORDER.some((k) => o.types[k])) { this._setStatus(t("ALD.Copy.NoTypes")); return; }

    this._setStatus("");
    this._cancel = false;
    this._lock(true);
    try {
      this._progress(t("ALD.Copy.Analyzing"));
      const { items, wild, skipped } = classifyGroups(this._d.groups, { ...o, hidden: _getState().hidden });
      await expandWildcards(wild, items, skipped, (d, tot) => this._progress(t("ALD.Copy.Wildcards"), d, tot), () => this._cancel);
      const all = assignDestinations(items, o);
      await readSizes(all, (d, tot) => this._progress(t("ALD.Copy.ReadingSizes"), d, tot), () => this._cancel);
      if (this._cancel) { this._setStatus(""); return; }
      this._plan = { items: all, skipped, opts: { ...o, types: { ...o.types } }, summary: summarize(all) };
      this._q("#cp-plan").innerHTML = this._planHTML();
      this._show("plan");
    } catch (err) {
      console.error(`[${MODULE_ID}]`, err);
      ui.notifications.error(fmt("ALD.ScanError", { msg: err.message }));
    } finally {
      this._q("#cp-progress").hidden = true;
      this._lock(false);
    }
  }

  _planHTML() {
    const { items, skipped, summary, opts } = this._plan;
    const rows = KIND_ORDER.filter((k) => opts.types[k]).map((k) => {
      const s = summary[k];
      const size = s.unknown ? `${formatBytes(s.bytes)} + ${fmt("ALD.Copy.UnknownSize", { n: s.unknown })}` : formatBytes(s.bytes);
      return `<tr><td>${esc(t(`ALD.Kind.${k}`))}</td><td>${s.files}</td><td>${esc(size)}</td><td class="cp-dir">${esc(`${opts.dest}/${TYPE_FOLDER[k]}/`)}</td></tr>`;
    }).join("");
    let html = `<div class="rp-label">${esc(t("ALD.Copy.PlanTitle"))}</div>
      <table class="cp-table"><thead><tr><th>${esc(t("ALD.Copy.ColType"))}</th><th>${esc(t("ALD.Copy.ColFiles"))}</th><th>${esc(t("ALD.Copy.ColSize"))}</th><th>${esc(t("ALD.Copy.ColTo"))}</th></tr></thead><tbody>${rows}</tbody></table>`;
    html += items.length
      ? `<div class="rp-hint">${esc(t("ALD.Copy.PlanNote"))}</div>`
      : `<div class="rp-empty">${esc(t("ALD.Copy.NothingToCopy"))}</div>`;
    if (skipped.length) {
      html += `<div class="rp-label cp-gap">${esc(fmt("ALD.Copy.WillNotCopy", { n: skipped.length }))}</div>${this._reasonsHTML(skipped.map((s) => ({ reason: s.reason, src: s.path, uses: s.uses })))}`;
    }
    return html;
  }

  /** Lista agrupada por motivo (usada no plano e no resultado). */
  _reasonsHTML(rows) {
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.reason)) groups.set(r.reason, []);
      groups.get(r.reason).push(r);
    }
    return [...groups].sort((a, b) => b[1].length - a[1].length).map(([reason, list]) => {
      const lis = list.slice(0, LIST_CAP).map((r) =>
        `<li><span class="cp-path">${esc(r.src)}</span>${r.uses !== "" && r.uses != null ? `<span class="cp-uses">${esc(fmt("ALD.Rep.UsedIn", { n: r.uses }))}</span>` : ""}${r.error ? `<span class="cp-err">${esc(r.error)}</span>` : ""}</li>`).join("");
      const more = list.length > LIST_CAP ? `<li class="cp-more">${esc(fmt("ALD.Copy.MoreInCsv", { n: list.length - LIST_CAP }))}</li>` : "";
      return `<details class="cp-reason"><summary><b>${esc(t(`ALD.Copy.Reason.${reason}`))}</b> <em>${list.length}</em></summary><ul class="cp-list">${lis}${more}</ul></details>`;
    }).join("");
  }

  _backToSetup() {
    this._plan = null;
    this._setStatus("");
    this._show("setup");
  }

  // ---- 2. copiar ----------------------------------------------------------
  async _start() {
    if (!this._plan?.items.length) return;
    const S = _getState();
    const { items, skipped, opts } = this._plan;
    this._cancel = false;
    this._setStatus("");
    this._show("copying");
    this._lock(true);
    this._q("#cp-progress").hidden = false;
    let relink = null;
    try {
      await copyAll(items, (d, tot) => {
        const bytes = items.filter((i) => i.status === "copied" || i.status === "already").reduce((s, i) => s + (i.size ?? 0), 0);
        this._progress(t("ALD.Copy.Copying"), d, tot, formatBytes(bytes));
      }, () => this._cancel, { acceptResized: !!opts.acceptResized });
      clearExistsCache();

      if (opts.relink && !this._cancel) relink = await this._relink(items, opts);

      const notRelinked = relink?.notRelinked ?? [];
      const rows = buildReport(items, skipped, notRelinked);
      this._result = { rows, relink, relinked: !!relink?.applied, cancelled: this._cancel };
      this._q("#cp-result").innerHTML = this._resultHTML();
      this._lock(false);
      this._show("result");
      if (relink?.applied) this._d.onDone?.();
    } catch (err) {
      console.error(`[${MODULE_ID}]`, err);
      ui.notifications.error(fmt("ALD.ScanError", { msg: err.message }));
      this._lock(false);
      this._show("plan");
    } finally {
      this._q("#cp-progress").hidden = true;
      this._lock(false);
    }
  }

  // ---- 3. atualizar os caminhos do mundo ---------------------------------
  async _relink(items, opts) {
    const S = _getState();
    this._progress(t("ALD.Copy.CheckingWildcards"));
    const wildChecks = await checkWildcards(items, opts);
    const { map, chains, notRelinked } = buildRelinkMapping(items, this._d.groups, opts, wildChecks);
    if (!map.size) return { notRelinked, applied: false, reason: "nothing" };

    this._progress(t("ALD.Rep.Preparing"));
    const stored = new Map([...map].map(([from, to]) => [from, encodeStored(to)]));
    const plan = await planDocs(stored, chains, (d, tot) => this._progress(t("ALD.Rep.Preparing"), d, tot), () => this._cancel);
    if (!plan.changes.length) return { notRelinked, applied: false, reason: "nodocs", unresolved: plan.unresolved };

    const wantBackup = S.options.backup !== false;
    const answer = await DialogV2.wait({
      window: { title: t("ALD.Copy.RelinkConfirmTitle") },
      content: `<p>${esc(fmt("ALD.Copy.RelinkConfirm", { paths: map.size, docs: plan.changes.length, uses: plan.uses }))}</p>` +
        (wantBackup ? `<p>${esc(fmt("ALD.Rep.ConfirmBackup", { dir: backupDir() }))}</p>` : ""),
      buttons: [
        { action: "yes", label: t("ALD.Copy.RelinkYes"), default: true },
        { action: "no", label: t("ALD.Copy.RelinkNo") }
      ],
      rejectClose: false
    }).catch(() => null);
    if (answer !== "yes") return { notRelinked, applied: false, reason: "declined" };

    let backupInfo = null;
    if (wantBackup) {
      this._progress(t("ALD.Rep.SavingBackup"));
      backupInfo = await saveBackup({
        module: MODULE_ID, version: getVersion(), world: game.world.id, at: new Date().toISOString(), kind: "copy-assets",
        mapping: [...stored].map(([from, to]) => ({ from, to })),
        entries: plan.changes.map((c) => ({ uuid: c.uuid, old: c.old }))
      });
      if (!backupInfo) {
        ui.notifications.error(t("ALD.Rep.BackupAbort"));
        return { notRelinked, applied: false, reason: "backup" };
      }
    }

    this._progress(t("ALD.Rep.Applying"));
    const { failures, batch } = await applyPlan(plan, (d, tot) => this._progress(t("ALD.Rep.Applying"), d, tot), () => false);
    S.lastBatch = batch;
    return { notRelinked, applied: true, docs: plan.changes.length - failures.length, uses: plan.uses, failures, backupInfo, unresolved: plan.unresolved };
  }

  // ---- 4. resultado -------------------------------------------------------
  _resultHTML() {
    const { rows, relink, cancelled } = this._result;
    const count = (s) => rows.filter((r) => r.status === s).length;
    const copied = count("copied");
    const already = count("already there");
    const notCopied = rows.filter((r) => r.status === "not copied");
    const bytes = this._plan.items.filter((i) => i.status === "copied").reduce((s, i) => s + (i.size ?? 0), 0);

    let html = `<div class="rp-done"><b>${esc(fmt("ALD.Copy.Done", { copied, size: formatBytes(bytes), already, notCopied: notCopied.length }))}</b>`;
    if (cancelled) html += `<div>${esc(t("ALD.Copy.WasCancelled"))}</div>`;
    const sizeFails = notCopied.filter((r) => String(r.error ?? "").startsWith("size mismatch")).length;
    if (sizeFails) html += `<div class="cp-warn">${esc(fmt("ALD.Copy.ResizedHint", { n: sizeFails }))}</div>`;
    html += `<div>${esc(fmt("ALD.Copy.DoneWhere", { dest: this._plan.opts.dest }))}</div>`;
    const counts = [...originCounts(this._plan.items)].sort((x, y) => y[1] - x[1]);
    if (counts.length) html += `<div>${esc(fmt("ALD.Copy.UsedBy", { list: counts.map(([o, n]) => `${t(`ALD.Origin.${o}`)} ${n}`).join(", ") }))}</div>`;
    if (relink) {
      if (relink.applied) {
        html += `<div>${esc(fmt("ALD.Copy.RelinkDone", { docs: relink.docs, uses: relink.uses }))}</div>`;
        if (relink.backupInfo) html += `<div>${esc(relink.backupInfo.where === "data" ? fmt("ALD.Rep.BackupSaved", { path: relink.backupInfo.path }) : fmt("ALD.Rep.BackupDownloaded", { dir: backupDir() }))}</div>`;
        if (relink.failures?.length) html += `<div class="rp-fail">${esc(fmt("ALD.Rep.Failures", { n: relink.failures.length }))}<ul>${relink.failures.slice(0, 10).map((f) => `<li>${esc(f.name)}: ${esc(f.message)}</li>`).join("")}</ul></div>`;
      } else {
        html += `<div>${esc(t(`ALD.Copy.RelinkNot.${relink.reason}`))}</div>`;
      }
    }
    html += `</div>`;

    html += `<div class="rp-label cp-gap">${esc(fmt("ALD.Copy.NotCopiedTitle", { n: notCopied.length }))}</div>`;
    html += notCopied.length ? this._reasonsHTML(notCopied) : `<div class="rp-empty">${esc(t("ALD.Copy.AllCopied"))}</div>`;

    const notUpdated = rows.filter((r) => r.status === "path not updated");
    if (notUpdated.length) {
      html += `<div class="rp-label cp-gap">${esc(fmt("ALD.Copy.NotUpdatedTitle", { n: notUpdated.length }))}</div>${this._reasonsHTML(notUpdated.map((r) => ({ ...r, reason: `relink_${r.reason}` })))}`;
    }

    const done = rows.filter((r) => r.status === "copied" || r.status === "already there");
    const lis = done.slice(0, LIST_CAP).map((r) => `<li><span class="cp-path">${esc(r.src)}</span><span class="cp-arrow">&rarr;</span><span class="cp-path">${esc(r.dest)}</span></li>`).join("");
    html += `<details class="cp-reason cp-gap"><summary><b>${esc(t("ALD.Copy.CopiedTitle"))}</b> <em>${done.length}</em></summary><ul class="cp-list">${lis}${done.length > LIST_CAP ? `<li class="cp-more">${esc(fmt("ALD.Copy.MoreInCsv", { n: done.length - LIST_CAP }))}</li>` : ""}</ul></details>`;
    return html;
  }

  _exportReport() {
    if (!this._result) return;
    const label = (r) => t(`ALD.Copy.Reason.${r}`) === `ALD.Copy.Reason.${r}` ? t(`ALD.Copy.Reason.relink_${r}`) : t(`ALD.Copy.Reason.${r}`);
    const csv = reportCsv(this._result.rows, label, (o) => t(`ALD.Origin.${o}`));
    const save = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
    save(csv, "text/csv;charset=utf-8", `assets-doctor-copy-report-${game.world.id}-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  async _undoPaths() {
    const S = _getState();
    if (!S.lastBatch) return;
    const answer = await DialogV2.wait({
      window: { title: t("ALD.UndoLast") },
      content: `<p>${esc(fmt("ALD.UndoConfirm", { n: S.lastBatch.entries.length }))}</p><p>${esc(t("ALD.Copy.UndoNote"))}</p>`,
      buttons: [{ action: "yes", label: t("ALD.UndoYes"), default: true }, { action: "no", label: t("ALD.Cancel") }],
      rejectClose: false
    }).catch(() => null);
    if (answer !== "yes") return;
    const res = await undoBatch(S.lastBatch);
    S.lastBatch = null;
    ui.notifications.info(fmt("ALD.Rep.UndoDone", { n: res.restored }));
    this._result.relinked = false;
    this._renderFooter();
    this._d.onDone?.();
  }
}

let current = null;

/** Abre a janela de copia (uma por vez, pois o id e fixo). */
export function openCopy(data) {
  try { current?.close(); } catch { /* ja fechada */ }
  foundry.applications.instances?.get?.("ald-copy")?.close();
  current = new CopyApp(data);
  current.render({ force: true });
  return current;
}
