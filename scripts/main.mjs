// ============================================================
// MODULE: Assets Doctor
// ID:     asset-link-doctor
// Foundry VTT V14
// ============================================================
import { MODULE_ID, VERSION, log } from "./constants.mjs";
import { _setStateRef } from "./state.mjs";
import { AssetLinkDoctorApp, defaultFilters } from "./app.mjs";
import { runScan } from "./scan.mjs";

// Estado unico, compartilhado entre os arquivos via _setStateRef/_getState
export const STATE = {
  options: { world: true, compendiums: false, modulePacks: false, module: false, moduleId: "" },
  scanning: false,
  cancel: false,
  result: null,
  index: null,
  expanded: {},
  limit: 200,
  filters: defaultFilters(),
  filtersOpen: false,
  scopeOpen: undefined,
  lastBatch: null
};
_setStateRef(STATE);

// ============================================================
// Viewer de instrucoes (ApplicationV2)
// ============================================================
class InstructionsViewer extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-instructions`,
    window: { title: "ALD.Instructions.Title", resizable: true },
    position: { width: 620, height: 520 }
  };

  async _renderHTML() {
    const md = await fetch(`modules/${MODULE_ID}/INSTRUCTIONS.md`).then((r) => r.text()).catch(() => "Arquivo não encontrado.");
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = esc(md)
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/\n/g, "<br>");
    const div = document.createElement("div");
    div.className = "ald-instructions";
    div.innerHTML = html;
    return div;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }
}

function openScanner() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("ALD.NotGM"));
    return null;
  }
  const existing = foundry.applications.instances?.get?.("ald-app");
  const app = existing ?? new AssetLinkDoctorApp();
  app.render({ force: true });
  return app;
}

// ============================================================
// Botao em "Configuracoes e Preferencias" (barra lateral), como o "Assets Filepaths" do Asset Auditor
// ============================================================
const BUTTON_ID = "ald-settings-btn";

function insertSettingsButton() {
  if (!game.user?.isGM) return;
  if (document.getElementById(BUTTON_ID)) return;
  const section = document.querySelector("#settings .settings");
  if (!section) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = BUTTON_ID;
  btn.className = "ald-settings-btn";
  btn.title = game.i18n.localize("ALD.SettingsButtonTip");
  btn.innerHTML = `<i class="fa-solid fa-link-slash"></i> ${game.i18n.localize("ALD.SettingsButton")}`;
  btn.addEventListener("click", () => openScanner());
  section.appendChild(btn);
}

// A barra lateral e redesenhada varias vezes: reinsere o botao quando sumir.
Hooks.on("renderSidebar", () => insertSettingsButton());
Hooks.on("renderSettings", () => insertSettingsButton());

// ============================================================
// init
// ============================================================
Hooks.once("init", () => {
  log("init");

  game.settings.register(MODULE_ID, "scanOptions", {
    scope: "user",
    config: false,
    type: Object,
    default: { world: true, compendiums: false, modulePacks: false, module: false, moduleId: "" }
  });

  game.settings.registerMenu(MODULE_ID, "scanner", {
    name: "ALD.Menu.Name",
    label: "ALD.Menu.Label",
    hint: "ALD.Menu.Hint",
    icon: "fa-solid fa-link-slash",
    type: AssetLinkDoctorApp,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "instructions", {
    name: "ALD.Instructions.Name",
    label: "ALD.Instructions.Label",
    hint: "ALD.Instructions.Hint",
    icon: "fa-solid fa-circle-info",
    type: InstructionsViewer,
    restricted: false
  });
});

// ============================================================
// ready
// ============================================================
Hooks.once("ready", () => {
  try {
    // So aceita as chaves atuais (versoes antigas salvavam includeSettings/includeModulePacks)
    const saved = game.settings.get(MODULE_ID, "scanOptions") ?? {};
    for (const k of ["world", "compendiums", "modulePacks", "module"]) if (typeof saved[k] === "boolean") STATE.options[k] = saved[k];
    if (typeof saved.moduleId === "string") STATE.options.moduleId = saved.moduleId;
  } catch (e) {
    console.warn(`[${MODULE_ID}] nao foi possivel ler as opcoes salvas`, e);
  }

  // Navegador com arquivos antigos em cache: o manifesto (sempre novo) nao bate com o codigo carregado
  const manifestVersion = game.modules.get(MODULE_ID)?.version;
  if (manifestVersion && manifestVersion !== VERSION && game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("ALD.StaleCache"), { permanent: true });
  }

  game.modules.get(MODULE_ID).api = {
    version: VERSION,
    /** Abre a janela (somente GM). */
    open: openScanner,
    /** Roda a varredura sem janela e devolve o resultado. */
    scan: (options = {}) => runScan({ ...STATE.options, ...options }, {
      onProgress: () => {},
      isCancelled: () => false
    })
  };
  insertSettingsButton();
  log("ready");
});
