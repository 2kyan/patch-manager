import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { PatchStore } from './patchStore';
import { PatchedContentProvider, PREVIEW_SCHEME } from './preview/patchedContentProvider';
import { PatchDecorationProvider } from './tree/decorations';
import { PatchTreeProvider } from './tree/patchTreeProvider';

export interface PatchManagerApi {
  store: PatchStore;
  tree: PatchTreeProvider;
  decorations: PatchDecorationProvider;
}

export function activate(context: vscode.ExtensionContext): PatchManagerApi {
  const store = new PatchStore();
  const tree = new PatchTreeProvider(store);
  const content = new PatchedContentProvider(store);
  const decorations = new PatchDecorationProvider(store);

  context.subscriptions.push(
    store,
    tree,
    content,
    decorations,
    vscode.window.registerFileDecorationProvider(decorations),
    vscode.window.createTreeView('patchManager.patches', { treeDataProvider: tree, showCollapseAll: true }),
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, content),
    ...registerCommands(store, tree),
  );

  return { store, tree, decorations };
}

export function deactivate(): void {}
