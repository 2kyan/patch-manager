# Plan

## Current Plan — v0.1: browse & preview patches

Goal: VS Code extension that lists workspace patch files as a tree (patch → project folders → patched files) and
shows an in-memory diff (original vs patched) on click, without applying anything.

Decisions: discovery via configurable glob plus a "patches folder only" toggle; non-clean patches are fuzz-applied,
falling back to a hunk-only diff with a warning icon.

- [x] Scaffold (TypeScript, esbuild, `diff`/jsdiff), own git repo
- [x] `patchParser` — git/format-patch/plain diffs, strip levels, add/delete/rename/binary, mail subject/author
- [x] `treeBuilder` + `PatchTreeProvider` + `PatchStore` with file watchers
- [x] `applyEngine` (clean / fuzzy / already-applied / hunks-only) + `patch-preview:` content provider + `openDiff`
- [x] Settings, folder-only toggle, refresh, context menu (open patch, open file, reveal)
- [x] Unit tests (14) and VS Code integration tests (5), README, `vsce package`

## Future (to discuss)

- Generate a patch from `git diff` (via the `vscode.git` extension API)
- Apply / revert a whole patch
- Apply / revert a single file from a patch
