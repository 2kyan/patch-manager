import * as vscode from 'vscode';
import type { FileDiff } from '../patchParser';
import type { PreviewStatus } from '../preview/applyEngine';
import type { PatchEntry, PatchStore } from '../patchStore';

/**
 * Scheme for tree item `resourceUri`s. The path mirrors the workspace path so
 * the file icon theme picks the icon by file name/language (e.g. `.cxx` → C++),
 * while keeping Explorer/git decorations of the real file out of this view.
 */
export const ITEM_SCHEME = 'patch-manager-item';

interface ItemQuery {
  patch: string;
  index: number;
}

export function folderItemUri(dirPath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: ITEM_SCHEME, path: `/${dirPath}` });
}

export function fileItemUri(entry: PatchEntry, file: FileDiff): vscode.Uri {
  const query: ItemQuery = { patch: entry.uri.toString(), index: file.index };
  return vscode.Uri.from({ scheme: ITEM_SCHEME, path: `/${file.path}`, query: JSON.stringify(query) });
}

const KIND_BADGE: Record<FileDiff['kind'], { badge: string; color?: string }> = {
  modify: { badge: 'M', color: 'gitDecoration.modifiedResourceForeground' },
  add: { badge: 'A', color: 'gitDecoration.addedResourceForeground' },
  delete: { badge: 'D', color: 'gitDecoration.deletedResourceForeground' },
  rename: { badge: 'R', color: 'gitDecoration.renamedResourceForeground' },
  copy: { badge: 'C', color: 'gitDecoration.addedResourceForeground' },
  binary: { badge: 'B' },
};

const STATUS_BADGE: Partial<Record<PreviewStatus, { badge: string; color: string; tooltip: string }>> = {
  fuzzy: { badge: '~', color: 'list.warningForeground', tooltip: 'Applies with fuzz' },
  applied: { badge: '✓', color: 'testing.iconPassed', tooltip: 'Already applied' },
  hunksOnly: { badge: '!', color: 'list.errorForeground', tooltip: 'Does not apply' },
};

/** Badge and colour for patched files: the apply status if notable, else the change kind. */
export class PatchDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.changeEmitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly store: PatchStore) {
    this.subscription = store.onDidChange(() => this.changeEmitter.fire(undefined));
  }

  async provideFileDecoration(uri: vscode.Uri): Promise<vscode.FileDecoration | undefined> {
    if (uri.scheme !== ITEM_SCHEME || !uri.query) {
      return undefined;
    }
    let query: ItemQuery;
    try {
      query = JSON.parse(uri.query) as ItemQuery;
    } catch {
      return undefined;
    }
    const entry = await this.store.getPatch(vscode.Uri.parse(query.patch));
    const file = entry?.parsed.files[query.index];
    if (!entry || !file) {
      return undefined;
    }
    const preview = await this.store.preview(entry, file);
    const status = STATUS_BADGE[preview.status];
    if (status) {
      return new vscode.FileDecoration(status.badge, status.tooltip, new vscode.ThemeColor(status.color));
    }
    const kind = KIND_BADGE[file.kind];
    return new vscode.FileDecoration(kind.badge, undefined, kind.color ? new vscode.ThemeColor(kind.color) : undefined);
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}
