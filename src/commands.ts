import * as path from 'path';
import * as vscode from 'vscode';
import { SECTION } from './config';
import type { PatchStore } from './patchStore';
import { previewUri } from './preview/patchedContentProvider';
import type { FileNode, PatchTreeNode } from './tree/nodes';
import type { PatchTreeProvider } from './tree/patchTreeProvider';

const TITLE_SUFFIX = {
  clean: '',
  binary: '',
  fuzzy: ' — fuzzy',
  applied: ' — already applied',
  hunksOnly: ' — hunks only, does not apply cleanly',
} as const;

async function openDiff(store: PatchStore, node: FileNode | undefined): Promise<void> {
  if (node?.type !== 'file') {
    return;
  }
  const { entry, file } = node;
  const preview = await store.preview(entry, file);
  const target = store.targetUri(entry, file);
  const source = store.sourceUri(entry, file);
  const oldVirtual = previewUri(entry.uri, file.index, 'old', file.oldPath ?? file.path);
  const newVirtual = previewUri(entry.uri, file.index, 'new', file.path);

  // Use the real file on whichever side matches the workspace, so the user
  // can navigate and edit it; the other side is the in-memory preview.
  let left = oldVirtual;
  let right = newVirtual;
  if ((preview.status === 'clean' || preview.status === 'fuzzy') && file.kind === 'modify' && (await store.exists(source))) {
    left = source;
  } else if (preview.status === 'applied' && file.kind !== 'delete' && (await store.exists(target))) {
    right = target;
  }

  const patchName = path.basename(entry.uri.path);
  const title = `${path.posix.basename(file.path)} (${patchName})${TITLE_SUFFIX[preview.status]}`;
  await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
  if (preview.status === 'hunksOnly' && preview.note) {
    void vscode.window.setStatusBarMessage(`${file.path}: ${preview.note}`, 5000);
  }
}

export function registerCommands(store: PatchStore, tree: PatchTreeProvider): vscode.Disposable[] {
  const setFolderOnly = (value: boolean) =>
    vscode.workspace.getConfiguration(SECTION).update('folderOnly', value, vscode.ConfigurationTarget.Workspace);

  return [
    vscode.commands.registerCommand('patchManager.refresh', async () => {
      await store.reload();
      tree.refresh();
    }),
    vscode.commands.registerCommand('patchManager.openDiff', (node?: FileNode) => openDiff(store, node)),
    vscode.commands.registerCommand('patchManager.openPatchFile', async (node?: PatchTreeNode) => {
      if (node) {
        await vscode.window.showTextDocument(node.entry.uri, { preview: true });
      }
    }),
    vscode.commands.registerCommand('patchManager.openTargetFile', async (node?: PatchTreeNode) => {
      if (node?.type !== 'file') {
        return;
      }
      const uri = store.targetUri(node.entry, node.file);
      if (await store.exists(uri)) {
        await vscode.window.showTextDocument(uri, { preview: true });
      } else {
        void vscode.window.showWarningMessage(`${vscode.workspace.asRelativePath(uri)} does not exist in the workspace.`);
      }
    }),
    vscode.commands.registerCommand('patchManager.revealInExplorer', async (node?: PatchTreeNode) => {
      if (!node) {
        return;
      }
      const uri = node.type === 'file' ? store.targetUri(node.entry, node.file) : node.entry.uri;
      await vscode.commands.executeCommand('revealInExplorer', uri);
    }),
    vscode.commands.registerCommand('patchManager.showFolderOnly', () => setFolderOnly(true)),
    vscode.commands.registerCommand('patchManager.showAll', () => setFolderOnly(false)),
  ];
}
