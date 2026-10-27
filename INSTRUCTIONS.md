# Assets Doctor

Assets Doctor finds broken asset links in your Foundry world (images, tokens, tiles, sounds, journal pictures and more) and helps you fix them in a few clicks. You can replace one file everywhere at once, or fix hundreds of paths in bulk, with a preview, a backup and an undo button.

Made for Foundry VTT v14. GM only.

## Open it

- Open the sidebar, go to the **Settings** tab (the gear) and click the **Assets Doctor** button at the end of the button list.
- Or go to **Game Settings > Configure Settings > Module Settings > Assets Doctor** and click **Open checker**.
- Or run this in a macro: `game.modules.get("asset-doctor").api.open()`

## Quick start

1. Click **Scan**. A progress bar shows what it is doing.
2. Look at the **Problems** tab. Each row is one file path that has trouble, with how many times it is used.
3. Click **Replace** on a row, type or browse to the new location, and apply.
4. The list refreshes by itself. Anything you fixed disappears from Problems.

## What to check

Click the **What to check** panel to choose where to look. It closes by itself after a scan so the list has more room.

- **World assets and files only** (default): scenes (including V14 Levels), actors, items, playlists, journals (including pictures inside the text), roll tables, macros, cards and users of this world.
- **Verify compendiums**: also opens the compendiums of this world. This is slower.
- **Include module and system compendiums**: much slower. Only use it when you need it.
- **Verify module assets**: opens a module browser. Pick one active module that has compendiums and Assets Doctor checks only its compendiums. Handy while you are building a module.

You can turn on more than one. Your choices are remembered.

## Reading the list

The tabs show one situation at a time:

- **Problems**: Broken and Attention together. This is where you start.
- **Broken**: the file or folder does not exist, or a wildcard (`folder/*`) matches nothing, or it only matches the wrong kind of file (for example a token pointing to a folder of sounds).
- **Attention**: it works on your computer but is not clean. Examples: `Map.PNG` on disk but `map.png` in the data (breaks on Linux servers), a sound field pointing to an image, or a wildcard folder with mixed file types.
- **OK**: the file exists.
- **Ignored**: things Assets Doctor skips on purpose. External web links, Foundry core files, example values some modules save (like `path/image.png`), and data that belongs to modules that are turned off or not installed.
- **Hidden**: items you hid yourself (see below).

Click a row to see every place that uses the file. The arrow button opens that document. The copy button copies the path. A small tag such as `barbrawl · turned off` tells you which module saved that data.

### Why do I see links from a module I turned off?

Foundry keeps the data modules save inside your tokens, actors and scenes, even after you turn the module off. Assets Doctor reads all of it, then moves data that only belongs to turned-off or missing modules to **Ignored**. Some modules also keep copies of other modules' data (Mass Edit presets, for example). In that case the owner is the module the data is really for.

### Search and filters

- The search box filters by file, document or scene name.
- **Filters** opens more: media type, where it is used (scene, token, tile, journal pin, playlist...), **Inside this folder or module** (for example `modules/alien-stuff`) and **Extension** (for example `png, webp`).
- Click a chip to show only that kind. Click again to remove it. With no chip selected, nothing is filtered.
- The bulk replace button works on exactly what the list shows, so filter first.

## Replace one file everywhere

Click **Replace** on a row. The same broken path is replaced in every place that uses it.

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

## Backups and undo

Before changing anything, Assets Doctor can save a backup of the old values.

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
- **A message says my browser uses old files.** Reload with Ctrl+F5 (or clear the browser cache).
- **The scan is slow.** Turn off the compendium options. Compendiums are the slow part.
- **Something looks wrong after a replacement.** Click **Undo last replacement**, or use the backup file in `Data/asset-doctor/<world name>/`.

## Links

- Source and bug reports: [github.com/jacksands/asset-doctor](https://github.com/jacksands/asset-doctor)
- Made by Jack_Sands for Foundry VTT v14. Ideas studied from Asset Auditor, Scene Packer, Pack My World and Snoot.
