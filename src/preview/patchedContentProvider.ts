import * as vscode from 'vscode';
import type { PatchStore } from '../patchStore';

export const PREVIEW_SCHEME = 'patch-preview';

export type PreviewSide = 'old' | 'new';

interface PreviewQuery {
  patch: string;
  index: number;
  side: PreviewSide;
}

/**
 * Builds a read-only URI for one side of a patched file. The path carries the
 * target file name so the editor picks the right language.
 */
export function previewUri(patch: vscode.Uri, index: number, side: PreviewSide, targetPath: string): vscode.Uri {
  const query: PreviewQuery = { patch: patch.toString(), index, side };
  return vscode.Uri.from({
    scheme: PREVIEW_SCHEME,
    path: `/${side}/${targetPath}`,
    query: JSON.stringify(query),
  });
}

/** Serves the before/after text of patched files without touching the disk. */
export class PatchedContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly store: PatchStore) {
    // Open previews may depend on any patch or target file, so refresh all of them.
    this.subscription = store.onDidChange(() => {
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === PREVIEW_SCHEME) {
          this.changeEmitter.fire(doc.uri);
        }
      }
    });
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    let query: PreviewQuery;
    try {
      query = JSON.parse(uri.query) as PreviewQuery;
    } catch {
      return '';
    }
    const entry = await this.store.getPatch(vscode.Uri.parse(query.patch));
    const file = entry?.parsed.files[query.index];
    if (!entry || !file) {
      return '';
    }
    const preview = await this.store.preview(entry, file);
    return query.side === 'old' ? preview.oldText : preview.newText;
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}
