const t = (key) => game.i18n.localize(key);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const PACK_TYPES = new Set(["Actor", "Item", "Scene", "JournalEntry", "Playlist", "RollTable", "Macro", "Cards", "Adventure"]);

/** Modulos ativos que tem compendios carregados (so esses podem ser verificados). */
export function modulesWithPacks() {
  const out = [];
  for (const m of game.modules.values()) {
    if (!m.active) continue;
    const n = game.packs.contents.filter((p) =>
      p.metadata.packageType === "module" && p.metadata.packageName === m.id && PACK_TYPES.has(p.documentName)).length;
    if (n > 0) out.push({ id: m.id, title: m.title ?? m.id, packs: n });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Janela para escolher um modulo. Devolve o id escolhido, ou null se cancelar. */
export async function pickModule(currentId = "") {
  const mods = modulesWithPacks();
  if (!mods.length) {
    ui.notifications.warn(t("ALD.Pick.None"));
    return null;
  }

  let selected = mods.some((m) => m.id === currentId) ? currentId : "";
  const rows = mods.map((m) => `
    <button type="button" class="ald-pick-item ${m.id === selected ? "on" : ""}" data-id="${esc(m.id)}"
            data-search="${esc((m.title + " " + m.id).toLowerCase())}">
      <b>${esc(m.title)}</b>
      <span>${esc(m.id)}</span>
      <em>${esc(game.i18n.localize("ALD.Pick.Packs").replace("{n}", m.packs))}</em>
    </button>`).join("");

  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    id: "ald-module-picker",
    window: { title: t("ALD.Pick.Title"), resizable: true },
    position: { width: 520, height: 560 },
    content: `
      <div id="ald-picker-root">
        <p class="ald-picker-help">${esc(t("ALD.Pick.Help"))}</p>
        <input type="search" id="ald-picker-search" placeholder="${esc(t("ALD.Pick.Search"))}">
        <div class="ald-picker-list" id="ald-picker-list">${rows}</div>
      </div>`,
    buttons: [
      { action: "ok", label: t("ALD.Pick.Choose"), default: true, callback: () => selected },
      { action: "cancel", label: t("ALD.Cancel"), callback: () => null }
    ],
    render: (_event, dialog) => {
      const el = dialog.element;
      const list = el.querySelector("#ald-picker-list");
      const search = el.querySelector("#ald-picker-search");

      list.addEventListener("click", (ev) => {
        const item = ev.target.closest(".ald-pick-item");
        if (!item) return;
        selected = item.dataset.id;
        for (const b of list.querySelectorAll(".ald-pick-item")) b.classList.toggle("on", b === item);
      });
      list.addEventListener("dblclick", (ev) => {
        if (ev.target.closest(".ald-pick-item")) el.querySelector('button[data-action="ok"]')?.click();
      });
      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        for (const b of list.querySelectorAll(".ald-pick-item")) b.hidden = !!q && !b.dataset.search.includes(q);
      });
      search.focus();
    },
    rejectClose: false
  }).catch(() => null);

  return result || null;
}
