import { warn } from "./constants.mjs";

const FP = () => foundry.applications.apps.FilePicker.implementation;

export const BACKUP_ROOT = "asset-doctor";
/** Pasta dos backups do mundo atual, dentro de Data. */
export const backupDir = () => `${BACKUP_ROOT}/${game.world.id}`;

/** Cria a pasta se ainda nao existir (o Foundry cria uma pasta por vez e falha se ela ja existe). */
async function ensureDir(path) {
  try { await FP().browse("data", path); return; } catch { /* nao existe: cria */ }
  try { await FP().createDirectory("data", path); } catch { /* pode ter sido criada ao mesmo tempo */ }
}

/**
 * Salva o backup em Data/asset-doctor/<mundo>/backup-<data>.json.
 * Se o envio falhar, baixa o arquivo pelo navegador. Devolve { where, path } ou null se nada funcionou.
 */
export async function saveBackup(data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `backup-${stamp}.json`;
  const text = JSON.stringify(data, null, 2);

  try {
    await ensureDir(BACKUP_ROOT);
    await ensureDir(backupDir());
    const file = new File([text], name, { type: "application/json" });
    const res = await FP().upload("data", backupDir(), file, {}, { notify: false });
    if (!res || res.status === "error" || res.error) throw new Error(res?.message ?? "upload failed");
    return { where: "data", path: (res.path ?? `${backupDir()}/${name}`).replace(/^\/+/, "") };
  } catch (err) {
    warn("nao foi possivel salvar o backup em Data, baixando pelo navegador", err);
  }

  try {
    const save = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
    save(text, "application/json", `assets-doctor-backup-${game.world.id}-${stamp}.json`);
    return { where: "download", path: name };
  } catch (err) {
    warn("nao foi possivel baixar o backup", err);
    return null;
  }
}
