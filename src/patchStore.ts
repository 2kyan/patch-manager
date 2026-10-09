import * as vscode from 'vscode';
import { getConfig, patchGlob, SECTION } from './config';
import { parsePatchText, type FileDiff, type ParsedPatch } from './patchParser';
import { computePreview, type Preview } from './preview/applyEngine';

export interface PatchEntry {
  uri: vscode.Uri;
  folder: vscode.WorkspaceFolder;
  parsed: ParsedPatch;
}

const decoder = new TextDecoder();

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  // Prefer the editor buffer so unsaved edits are reflected.
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) {
    return open.getText();
  }
  try {
    return decoder.decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/**
 * Finds, parses and watches the patch files in the workspace, and computes
 * (and caches) the in-memory preview of each patched file.
 */
export class PatchStore implements vscode.Disposable {
  private readonly entries = new Map<string, PatchEntry>();
  private readonly previews = new Map<string, Promise<Preview>>();
  /** Workspace file URI → keys of previews that depend on it. */
  private readonly targets = new Map<string, Set<string>>();
  private watchers: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private pending: ReturnType<typeof setTimeout> | undefined;
  private loading: Promise<void> | undefined;
  /** A reload waiting for the current load to finish. */
  private queued: Promise<void> | undefined;

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fired when patches are added/removed/changed or a targeted file changes. */
  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.disposables.push(
      this.changeEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SECTION)) {
          void this.reload();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reload()),
      vscode.workspace.onDidChangeTextDocument((e) => this.onFileChanged(e.document.uri)),
    );
  }

  /** All known patches, sorted by workspace-relative path. */
  async getPatches(): Promise<PatchEntry[]> {
    if (!this.loading) {
      this.loading = this.load();
    }
    await this.loading;
    return [...this.entries.values()].sort((a, b) =>
      vscode.workspace.asRelativePath(a.uri).localeCompare(vscode.workspace.asRelativePath(b.uri)),
    );
  }

  async getPatch(uri: vscode.Uri): Promise<PatchEntry | undefined> {
    await this.getPatches();
    const known = this.entries.get(uri.toString());
    if (known) {
      return known;
    }
    // A patch outside the configured globs (e.g. opened via a stale preview URI).
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? this.parse(uri, folder) : undefined;
  }

  reload(): Promise<void> {
    // Loads must not overlap: each replaces the shared watchers and entries
    // across `await`s. Queue behind the running load, and let reloads requested
    // while one is already queued share it.
    if (!this.queued) {
      const queued = (this.loading ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => {
          this.queued = undefined;
          return this.load();
        });
      this.queued = queued;
      this.loading = queued;
    }
    return this.queued;
  }

  /** Workspace URI of the file a patch entry targets. */
  targetUri(entry: PatchEntry, file: FileDiff, side: 'old' | 'new' = 'new'): vscode.Uri {
    const baseDir = getConfig(entry.folder).baseDir;
    const base = baseDir ? vscode.Uri.joinPath(entry.folder.uri, baseDir) : entry.folder.uri;
    const path = side === 'old' ? (file.oldPath ?? file.path) : file.path;
    return vscode.Uri.joinPath(base, ...path.split('/'));
  }

  /** The file whose current content the preview is computed from. */
  sourceUri(entry: PatchEntry, file: FileDiff): vscode.Uri {
    // Renamed/copied files are patched starting from the old name.
    return this.targetUri(entry, file, file.kind === 'rename' || file.kind === 'copy' ? 'old' : 'new');
  }

  async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString());
    }
  }

  preview(entry: PatchEntry, file: FileDiff): Promise<Preview> {
    const key = `${entry.uri.toString()}#${file.index}`;
    let result = this.previews.get(key);
    if (!result) {
      const source = this.sourceUri(entry, file);
      const fuzz = getConfig(entry.folder).fuzzFactor;
      this.track(source, key);
      if (file.kind === 'rename') {
        // An applied rename is recognised by the new file, so it is a dependency too.
        const target = this.targetUri(entry, file);
        this.track(target, key);
        result = Promise.all([readText(source), readText(target)]).then(([text, renamed]) =>
          computePreview(file, text, fuzz, renamed),
        );
      } else {
        result = readText(source).then((text) => computePreview(file, text, fuzz));
      }
      this.previews.set(key, result);
    }
    return result;
  }

  /** Record that the preview `key` depends on the content of `uri`. */
  private track(uri: vscode.Uri, key: string): void {
    let dependents = this.targets.get(uri.toString());
    if (!dependents) {
      dependents = new Set();
      this.targets.set(uri.toString(), dependents);
    }
    dependents.add(key);
  }

  private async load(): Promise<void> {
    for (const w of this.watchers) {
      w.dispose();
    }
    this.watchers = [];
    this.entries.clear();
    this.previews.clear();
    this.targets.clear();

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const config = getConfig(folder);
      const include = new vscode.RelativePattern(folder, patchGlob(config));
      const exclude = config.exclude ? new vscode.RelativePattern(folder, config.exclude) : null;
      const uris = await vscode.workspace.findFiles(include, exclude);
      await Promise.all(uris.map((uri) => this.parse(uri, folder)));

      const patchWatcher = vscode.workspace.createFileSystemWatcher(include);
      const onPatch = (uri: vscode.Uri) => {
        this.entries.delete(uri.toString());
        this.dropPreviews((key) => key.startsWith(`${uri.toString()}#`));
        this.scheduleChange();
      };
      patchWatcher.onDidCreate(onPatch);
      patchWatcher.onDidChange(onPatch);
      patchWatcher.onDidDelete(onPatch);

      // Targets may live anywhere in the folder; filter events against known targets.
      const fileWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
      const onFile = (uri: vscode.Uri) => this.onFileChanged(uri);
      fileWatcher.onDidCreate(onFile);
      fileWatcher.onDidChange(onFile);
      fileWatcher.onDidDelete(onFile);

      this.watchers.push(patchWatcher, fileWatcher);
    }
    this.changeEmitter.fire();
  }

  private async parse(uri: vscode.Uri, folder: vscode.WorkspaceFolder): Promise<PatchEntry | undefined> {
    const text = await readText(uri);
    if (text === undefined) {
      return undefined;
    }
    const entry: PatchEntry = { uri, folder, parsed: parsePatchText(text, getConfig(folder).stripLevel) };
    this.entries.set(uri.toString(), entry);
    return entry;
  }

  private onFileChanged(uri: vscode.Uri): void {
    const key = uri.toString();
    if (this.entries.has(key)) {
      // A patch file changed: drop it so it is re-parsed before listeners are notified.
      this.entries.delete(key);
      this.dropPreviews((k) => k.startsWith(`${key}#`));
      this.scheduleChange();
      return;
    }
    const dependents = this.targets.get(key);
    if (dependents) {
      this.dropPreviews((k) => dependents.has(k));
      this.targets.delete(key);
      this.scheduleChange();
    }
  }

  private dropPreviews(match: (key: string) => boolean): void {
    for (const key of [...this.previews.keys()]) {
      if (match(key)) {
        this.previews.delete(key);
      }
    }
  }

  private scheduleChange(): void {
    if (this.pending) {
      clearTimeout(this.pending);
    }
    this.pending = setTimeout(() => {
      this.pending = undefined;
      // Re-parse patches dropped by the watchers before notifying listeners.
      void this.reparseMissing().then(() => this.changeEmitter.fire());
    }, 200);
  }

  private async reparseMissing(): Promise<void> {
    await this.loading;
    const found: { uri: vscode.Uri; folder: vscode.WorkspaceFolder }[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const config = getConfig(folder);
      const exclude = config.exclude ? new vscode.RelativePattern(folder, config.exclude) : null;
      for (const uri of await vscode.workspace.findFiles(new vscode.RelativePattern(folder, patchGlob(config)), exclude)) {
        found.push({ uri, folder });
      }
    }
    const present = new Set(found.map((f) => f.uri.toString()));
    for (const key of [...this.entries.keys()]) {
      if (!present.has(key)) {
        this.entries.delete(key);
      }
    }
    await Promise.all(found.filter((f) => !this.entries.has(f.uri.toString())).map((f) => this.parse(f.uri, f.folder)));
  }

  dispose(): void {
    if (this.pending) {
      clearTimeout(this.pending);
    }
    for (const d of [...this.watchers, ...this.disposables]) {
      d.dispose();
    }
  }
}
