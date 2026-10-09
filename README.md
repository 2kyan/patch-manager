# Patch Manager

Browse the patch files in your workspace and preview what they change — without applying them.

## Features

- **Patches view** (activity bar → *Patches*): every `*.patch` / `*.diff` in the workspace, each expanding into the
  project's folder structure down to the files it touches. Single-child folders are compacted (`lib/math`).
- **Click a file** to open a diff editor: the current workspace file on the left, the in-memory patched result on the
  right. Nothing is written to disk.
- **Status per file**
  - *(no badge)* applies cleanly
  - `fuzzy` — applies only after tolerating drifted context (`patchManager.fuzzFactor`)
  - ✓ `applied` — the workspace already contains the change; the diff shows original → current file
  - ⚠ `hunks only` — cannot be applied; the diff shows the hunks' before/after text only
- Understands `git format-patch` / `git diff` output (adds, deletes, renames, binary) and plain `diff -u`.
- Live refresh when patches or the files they target change.

## Settings

| Setting | Default | |
|---|---|---|
| `patchManager.include` | `**/*.{patch,diff}` | Glob for patch files |
| `patchManager.exclude` | `**/{node_modules,.git}/**` | Glob to skip |
| `patchManager.folderOnly` | `false` | Only show patches under `patchesFolder` (toggle with the filter button) |
| `patchManager.patchesFolder` | `patches` | Folder used by folder-only mode |
| `patchManager.fuzzFactor` | `2` | Mismatching context lines tolerated in previews |
| `patchManager.stripLevel` | `auto` | Like `patch -pN`; `auto` strips git `a/` `b/` prefixes |
| `patchManager.baseDir` | `""` | Directory patch paths are relative to |

## Development

```sh
npm install
npm run compile          # type-check + bundle to dist/
npm test                 # unit tests (parser, tree, apply engine)
npm run test:integration # runs the extension in VS Code against test/fixtures/workspace
npx @vscode/vsce package # build a .vsix
```

Press F5 to launch an Extension Development Host on the fixture workspace.
