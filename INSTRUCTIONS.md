# Assets Doctor

Assets Doctor finds broken asset links in your Foundry world (images, tokens, tiles, sounds, journal pictures and more) and helps you fix them in a few clicks. You can replace one file everywhere at once, or fix hundreds of paths in bulk, with a preview, a backup and an undo button.

Made for Foundry VTT v14. GM only. The window follows your Foundry language (English and Brazilian Portuguese).

This is a **beta**. Before big changes, make Foundry's own backup of the world (see **Backups and undo**).

## Open it

- Open the sidebar, go to the **Settings** tab (the gear) and click the **Assets Doctor** button at the end of the button list.
- Or go to **Game Settings > Configure Settings > Module Settings > Assets Doctor** and click **Open checker**.
- Or run this in a macro: `game.modules.get("asset-doctor").api.open()`

For macro authors, `game.modules.get("asset-doctor").api.scan({ world: true })` runs a scan without the window and returns the result.

## Quick start

1. Click **Scan**. A progress bar shows what it is doing, and **Cancel** stops it. Use **Maximize** to give the list the whole screen.
2. Look at the **Problems** tab. Each row is one file path that has trouble, with how many times it is used.
3. Click **Replace** on a row, type or browse to the new location, and apply.
4. The list refreshes by itself. Anything you fixed disappears from Problems.

## What to check

Click the **What to check** panel to choose where to look. It closes by itself after a scan so the list has more room.

- **World assets and files only** (default): scenes (including V14 Levels), actors, items, playlists, journals (including pictures inside the text), roll tables, macros, cards and users of this world.
- **Verify compendiums**: also opens the compendiums of this world. This is slower.
- **Include module and system compendiums**: much slower. Only use it when you need it.
- **Verify module assets**: opens a module browser. Pick one active module that has compendiums and Assets Doctor checks only its compendiums. Handy while you are building a module.

It also checks the search folders of Token Variant Art (shown as the **Search folder** type), when that module is installed.

You can turn on more than one. Your choices are remembered.

## Reading the list

The tabs show one situation at a time:

- **Problems**: Broken and Attention together. This is where you start.
- **Broken**: the file or folder does not exist, or a wildcard (`folder/*`) matches nothing, or it only matches the wrong kind of file (for example a token pointing to a folder of sounds).
- **Attention**: it works on your computer but is not clean. Examples: `Map.PNG` on disk but `map.png` in the data (breaks on Linux servers), a sound field pointing to an image, or a wildcard folder with mixed file types.
- **OK**: the file exists.
- **Ignored**: things Assets Doctor skips on purpose. External web links, Foundry core files, example values some modules save (like `path/image.png`), and data that belongs to modules that are turned off or not installed.
- **Hidden**: items you hid yourself (see below).

The list shows 200 rows at a time. Click **Show more** for the next ones. Click a row to see every place that uses the file. The arrow button opens that document. The copy button copies the path. A small tag such as `barbrawl · turned off` tells you which module saved that data. A **wildcard** tag marks paths like `folder/*`.

### Why do I see links from a module I turned off?

Foundry keeps the data modules save inside your tokens, actors and scenes, even after you turn the module off. Assets Doctor reads all of it, then moves data that only belongs to turned-off or missing modules to **Ignored**. Some modules also keep copies of other modules' data (Mass Edit presets, for example). In that case the owner is the module the data is really for.

### Search and filters

- The search box filters by file, document or scene name.
- **Filters** opens more: media type, where it is used (scene, token, tile, journal pin, playlist...), **Inside this folder or module** (for example `modules/alien-stuff`) and **Extension** (for example `png, webp`).
- Click a chip to show only that kind. Click again to remove it. With no chip selected, nothing is filtered.
- The bulk replace button works on exactly what the list shows, so filter first.

## Replace one file everywhere

Click **Replace** on a row. The same broken path is replaced in every place that uses it, including pictures inside journal text and data saved by other modules.

1. Type or paste the new path. Spaces or `%20` both work.
2. Or click **Browse**. It opens at the closest folder that still exists.
3. The window tells you if the new file exists.
4. Click **Apply replacement** and confirm.

## Replace in bulk

Click **Replace in bulk** at the top. It changes every item currently in the list.

Pick how to match:

- **Path starts with**: swap a folder. Example: find `REPOSITORIO/SONS/SAL_SOUND/` and replace with `REPOSITORIO/SAL_SOUNDBOARD/`.
- **Path contains**: swap any piece of the path.
- **Extension only**: change `mp3` to `ogg`, for example.

For the first two you can also type a new extension to switch all files at once.

The **Browse** buttons next to **Find** and **Replace with** let you pick the folder instead of typing it. Find starts at the folder your items share, and Replace starts where Find ended.

The preview shows each old path, the new path, and whether the new file exists. By default, only paths whose new file exists are changed. This stops you from swapping one broken link for another.

## Copy assets to a folder

Use this for a final backup of everything your world uses, or to collect the files for a module.

0. **Make Foundry's own world backup first** if you plan to update the paths. The window reminds you at the top (close the world, open Setup, right-click the world, Backup).
1. **Scan first.** Turn on **Verify compendiums** if you want the compendium files too. The copy uses the last scan.
2. Click **Copy assets** at the top.
3. Pick the **Destination folder** (use **Browse**). For a module, create the module in Foundry first, then pick `modules/<your-module>/assets`.
4. Pick the layout. **Keep the original folders** is recommended. You can also cut the start of the original paths (for example `REPOSITORIO/`).
5. Tick what to copy: images, videos, sounds, other files. The copy uses the last scan, not the filters of the list. Items you hid are skipped.
6. Click **Analyze**. It shows how many files and how much space each type needs, and lists what will not be copied. Nothing is copied yet.
7. Click **Start copy**. A bar shows the progress and you can cancel. If you run it again later, it skips files that are already there with the same size. Files that another module renamed or converted on upload are not recognized, so they are sent again.

Other options on this window:

- **Include files from other modules and systems**: off by default (see below).
- **Accept files that another module changed during upload**: off by default. If Media Optimizer or FilePicker+ is active, the window shows a warning about it.
- **Also update the world's paths to the copies**: off by default (see below).

Wildcards (`folder/*`) are expanded into their real files, which are copied together into the same type folder.

Copies go into `images/`, `videos/`, `sounds/` and `other/` inside the destination, with their original names. Each copy is checked by size.

### What is not copied

Everything that is skipped is listed, grouped by reason, and **Not copied** comes first. The same list is in the CSV report (**Export report**), which also has a **used_in** column telling where each file is used (playlist, token, scene...). The result also shows how many copied files are used in each place, so you can check that, for example, the music of your playlists was included.

- Files that are missing (there is nothing to copy).
- External web links and Foundry core files.
- Files from other modules and systems. Off by default, because art from other packages can have license limits. You can turn it on.
- Data that belongs to modules that are turned off, items you hid, and example values.
- Types you did not tick, and files already inside the destination.
- Files that failed. Foundry can refuse some file types on upload. Other modules (for example Media Optimizer or FilePicker+) can also convert images or rename files while they upload. A copy whose size differs from the original is reported as failed, and its path in the world is not changed. Turn that module off and run again, or tick **Accept files that another module changed during upload** and run again. The original is never touched.

### Update the world paths too (optional)

Off by default. When it is on, after the copy Assets Doctor shows a confirmation, saves a backup and then points the world's paths to the copies. This is what you need to build a module from the world. Then export your content to compendiums so they carry the module paths.

- Files that failed to copy keep their old paths.
- Wildcards (`folder/*`) are updated only when you kept the original folders and the new pattern still finds every copied file. If the upload renamed the files (for example to lowercase with hyphens), the wildcard keeps its old path and is listed under **Copied, but path not updated**.
- Paths are updated to the names that were really uploaded, even when something renamed the files.
- **Undo path update** restores the old paths. The copied files stay in the destination.

### Good to know

- Nothing is deleted. Foundry does not let modules delete files. The **Copied** list shows which originals now have a copy so you can clean up by hand. Be careful: other worlds may use the same originals.
- Every file passes through your browser, so big videos are slow and use memory. Keep Foundry open, avoid editing the world and have no players connected while it runs.

## Backups and undo

Before changing anything, Assets Doctor can save a backup of the old values.

A backup is **not** a copy of the whole world. It stores, for each document that will change, the old values of the fields that change. That is what **Undo** uses.

For a full safety copy of the world (with all the old paths), use Foundry's own backup before big changes: close the world, open **Setup**, right-click the world and choose **Backup**. Foundry only offers this from Setup, and a module cannot start it from inside a running world.

- Backups are saved in your Foundry Data folder: `Data/asset-doctor/<world name>/backup-<date>.json`.
- The backup checkbox is remembered. Uncheck it if you do not want backups.
- If saving into Data fails, the backup is downloaded by your browser instead. If neither works, nothing is changed.
- **Undo last replacement** (top bar) puts the old values back. It is available until you reload Foundry. After that, the backup file keeps the old values safe.

## Hide for now

Not ready to fix something? Click **Hide** on its row. It leaves the list and the counts, and bulk replace skips it. It is not deleted.

To bring it back, open the **Hidden** tab and click **Show again** (or **Show all again**). Hidden items are remembered between sessions for your user in this world.

## Export

**Export CSV** saves what the list shows right now (with your filters) so you can open it in a spreadsheet.

## Good to know

- Assets Doctor writes to your world data when you apply a replacement. It also works in compendiums that are unlocked. A locked compendium shows an error in the result. Unlock it and try again.
- It never moves or deletes files. Foundry does not allow modules to do that. Old files stay where they are.
- Paths are saved URL style (`%20` for spaces), like Foundry's own file picker does.
- It does not replace web links (`http...`), Foundry core files, bare file names with no folder, or the search folders list of Token Variant Art (that one is a module setting).
- Text anywhere that ends in a known media extension counts as a path. A rare false alarm is possible. Use **Hide** for those.

## Troubleshooting

- **I do not see the button.** It is for GMs only. Reload Foundry with Ctrl+F5. You can also open it from the module settings.
- **The window looks old after an update.** Reload Foundry with Ctrl+F5 (or clear the browser cache).
- **The scan is slow.** Turn off the compendium options. Compendiums are the slow part.
- **Copy says "size mismatch", or some paths were not updated.** Another module changed the file during upload. Media Optimizer, for example, converts PNG and JPG to WebP, and it can rename files. Assets Doctor warns you when such modules are active. For exact copies, turn them off and reload. To keep the converted files instead, tick **Accept files that another module changed during upload**: the world paths then point to the converted files.
- **Something looks wrong after a replacement.** Click **Undo last replacement**, or use the backup file in `Data/asset-doctor/<world name>/`.

## Links

- Source and bug reports: [github.com/jacksands/asset-doctor](https://github.com/jacksands/asset-doctor)
- Made by Jack_Sands for Foundry VTT v14. Ideas studied from Asset Auditor, Scene Packer, Pack My World and Snoot.
