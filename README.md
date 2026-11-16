# Assets Doctor

![Foundry VTT v14](https://img.shields.io/badge/Foundry%20VTT-v14-orange) ![Status: beta](https://img.shields.io/badge/status-beta-yellow)

Find broken asset links in your Foundry VTT world and fix them in a few clicks.

Assets Doctor scans your world (and, if you want, your compendiums) for images, tokens, tiles, sounds, journal pictures and more that point to files that no longer exist. Then it helps you repair them: replace one file everywhere at once, fix hundreds of paths in bulk, or copy everything your world uses into a new folder, for example to build a module.

> This is a beta. It writes to your world data when you apply a change. Make Foundry's own world backup first (Setup, right-click the world, Backup).

## Why

Moving or renaming a folder in your asset library breaks every link that pointed to it. Foundry will not tell you, and checking by hand is tedious. Assets Doctor reads the data of your documents, checks every path against the real files, and lists what is broken, where it is used and, when possible, what the file was probably renamed to.

## Features

**Find problems**
- Reads scenes (including V14 Levels), actors, items, playlists, journals (pictures inside the text too), roll tables, macros, cards and users. It also reads data saved by other modules.
- Checks each folder once instead of testing every file, with a progress bar and a Cancel button.
- Understands wildcards (`folder/*`) and checks that they match the right kind of file (images for a token, sounds for a playlist).
- Tells apart **Broken**, **Attention** (for example different upper and lower case), **OK**, **Ignored** and **Hidden**.
- Detects which module saved each piece of data. Data of modules that are turned off or not installed goes to **Ignored**, so the list stays clean.
- Optionally checks compendiums, and the compendiums of a single module (handy when building one).
- Filters by media type, where the file is used, folder or module, and extension. Exports the list as CSV.

**Fix problems**
- **Replace one file everywhere**: one click replaces a broken path in every place that uses it, with a Browse button.
- **Replace in bulk**: swap a folder, swap part of a path, or change only the extension, on exactly what the list shows. Browse buttons help you pick folders.
- Preview of old and new paths, and a check that the new file exists before anything changes.
- A backup before every change, an **Undo** button, and **Restore backup...** to bring the old values back from a backup file, even after reloading Foundry.
- **Hide for now**: take an item out of the list to deal with it later.

**Copy assets to a folder**
- Copies every file your world uses into a folder you choose (for example `modules/my-module/assets`), sorted into `images/`, `videos/`, `sounds/` and `other/`.
- Keeps the original folders (or puts files straight into the type folders), with an analysis step that shows how many files and how much space before anything is copied.
- Optionally updates the world's paths to the copies.
- Lists what was copied, and above all what was **not** copied and why. What needs your attention (missing files, failures) comes first, and what was skipped on purpose (core files, external links, hidden items) comes after. The CSV report also says where each file is used (playlist, token, scene...).

## Install

In Foundry, go to **Add-on Modules**, click **Install Module** and paste this manifest URL:

```
https://raw.githubusercontent.com/jacksands/asset-doctor/refs/heads/main/module.json
```

Manual install: download the repository, put its contents in a folder named `asset-doctor` inside `Data/modules`, and enable the module in your world. If you use GitHub's **Download ZIP**, rename the extracted folder from `asset-doctor-main` to `asset-doctor`.

Requires Foundry VTT v14. Tested on v14.369 with the Daggerheart system.

## Quick start

1. Open the sidebar, go to the **Settings** tab and click **Assets Doctor** (GM only).
2. Click **Scan**.
3. Open the **Problems** tab. Click **Replace** on a row, type or browse to the new location, and apply.

The full guide is in [INSTRUCTIONS.md](INSTRUCTIONS.md). It is also available inside Foundry: **Game Settings > Configure Settings > Module Settings > Assets Doctor > Open instructions**.

## How it works

- **Scan**: walks the data of each document and picks every string that looks like a file path (known media extensions and wildcards), including paths inside HTML text. It lists each folder once through Foundry's file picker and compares names. Wildcards are expanded by Foundry itself.
- **Owners**: paths found inside `flags` are matched to the module that saved them. When a module keeps a copy of another module's data (Mass Edit presets, for example), the owner is the module the data is really for.
- **Replace**: rewrites the matching strings in the documents through normal document updates, and keeps the old values for undo.
- **Copy**: downloads each file from your own server and uploads it to the destination with Foundry's file picker, then checks the size. The path stored in the world is the one the server returns, even if something renamed the file.

Nothing leaves your server. Assets Doctor makes no requests to outside sites.

## Safety

- Nothing changes until you confirm. Bulk replace shows a preview first.
- By default only paths whose new file exists are changed.
- The module backup (`Data/asset-doctor/<world name>/backup-<date>.json`) keeps the old values of what it changes. It powers **Undo** and **Restore backup...**. It is **not** a copy of the whole world. For that, use Foundry's own backup from Setup.
- The module never deletes or moves files. Foundry does not allow modules to do that.

## Compatibility notes

- **Media Optimizer** and **FilePicker+** can convert or rename files while they upload, so a copy may not match the original. Assets Doctor warns you when they are active. Turn them off for exact copies, or accept the converted files.
- **Token Variant Art**: its search folders are checked. Its data in tokens is read like any other module data.
- Copying files from other modules and systems is off by default, because art from other packages can have license limits.

## For macro authors

```js
const api = game.modules.get("asset-doctor").api;
api.open();                        // open the window (GM only)
const result = await api.scan({ world: true, compendiums: false });
console.log(api.version);
```

## Known limitations

- Every file passes through your browser during a copy, so big videos are slow and use memory.
- Paths in module settings are not replaced, and neither are external web links, Foundry core files and bare file names with no folder.
- Wildcards in a copy are only updated when the original folders are kept and the new pattern still matches the copied files.
- Undo works until you reload Foundry. After that, use **Restore backup...** with the backup file. It restores the old values of the fields that were changed, so later changes to those same fields are lost.

## Project layout

```
module.json
INSTRUCTIONS.md        in-module guide
lang/                  English and Brazilian Portuguese
styles/module.css      all selectors scoped to the module windows
scripts/
  main.mjs             entry: settings, menus, API, Settings tab button
  constants.mjs        ids, extensions, status table
  state.mjs            shared state reference
  scan.mjs             scan orchestration, progress and cancel
  extract.mjs          path detection and document walker
  verify.mjs           folder listing, wildcards, status
  replace.mjs          replace engine, undo
  replace-app.mjs      replace window
  copy.mjs             copy engine, report
  copy-app.mjs         copy window
  backup.mjs           module backup into Data
  restore.mjs          reads a backup file for Restore backup
  module-picker.mjs    module browser
  app.mjs              main window
```

## Reporting issues

Please open an issue at [github.com/jacksands/asset-doctor/issues](https://github.com/jacksands/asset-doctor/issues). If you can, attach the CSV exported from the window and the Foundry and module versions.

## Credits

Made by [Jack_Sands](https://github.com/jacksands) for Foundry VTT v14. Ideas studied from Asset Auditor, Scene Packer, Pack My World and Snoot.
