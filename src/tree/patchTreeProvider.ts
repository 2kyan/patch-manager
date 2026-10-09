import * as path from 'path';
import * as vscode from 'vscode';
import type { FileDiff } from '../patchParser';
import type { Preview } from '../preview/applyEngine';
import type { PatchEntry, PatchStore } from '../patchStore';
import { fileItemUri, folderItemUri } from './decorations';
import { ContextValue, type FileNode, type PatchTreeNode } from './nodes';
import { buildTree, type DirEntry } from './treeBuilder';

const KIND_LABEL: Record<FileDiff['kind'], string> = {
  modify: '',
  add: 'added',
  delete: 'deleted',
  rename: 'renamed',
  copy: 'copied',
  binary: 'binary',
};

export class PatchTreeProvider implements vscode.TreeDataProvider<PatchTreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<PatchTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscription: vscode.Disposable;
  private readonly trees = new WeakMap<object, DirEntry<FileDiff>>();

  constructor(private readonly store: PatchStore) {
    this.subscription = store.onDidChange(() => this.changeEmitter.fire(undefined));
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  async getChildren(node?: PatchTreeNode): Promise<PatchTreeNode[]> {
    if (!node) {
      const patches = await this.store.getPatches();
      return patches.map((entry) => ({ type: 'patch', entry }));
    }
    if (node.type === 'file') {
      return [];
    }
    const dir = node.type === 'patch' ? this.treeOf(node.entry.parsed) : node.dir;
    return [
      ...dir.dirs.map((d): PatchTreeNode => ({ type: 'folder', entry: node.entry, dir: d })),
      ...dir.files.map((f): PatchTreeNode => ({ type: 'file', entry: node.entry, file: f.item })),
    ];
  }

  async getTreeItem(node: PatchTreeNode): Promise<vscode.TreeItem> {
    switch (node.type) {
      case 'patch':
        return this.patchItem(node.entry);
      case 'folder': {
        const item = new vscode.TreeItem(node.dir.name, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `${node.entry.uri.toString()}/${node.dir.path}/`;
        // Folder/File theme icons resolve against resourceUri via the file icon theme.
        item.iconPath = vscode.ThemeIcon.Folder;
        item.resourceUri = folderItemUri(node.dir.path);
        item.contextValue = ContextValue.folder;
        return item;
      }
      case 'file':
        return this.fileItem(node, await this.store.preview(node.entry, node.file));
    }
  }

  private treeOf(parsed: { files: FileDiff[] }): DirEntry<FileDiff> {
    let tree = this.trees.get(parsed);
    if (!tree) {
      tree = buildTree(parsed.files, (f) => f.path);
      this.trees.set(parsed, tree);
    }
    return tree;
  }

  private async patchItem(entry: PatchEntry): Promise<vscode.TreeItem> {
    const { parsed } = entry;
    const item = new vscode.TreeItem(path.basename(entry.uri.path), vscode.TreeItemCollapsibleState.Collapsed);
    item.id = entry.uri.toString();
    item.resourceUri = entry.uri;
    item.contextValue = ContextValue.patch;

    const rel = path.dirname(vscode.workspace.asRelativePath(entry.uri, (vscode.workspace.workspaceFolders?.length ?? 0) > 1));
    const statuses = await Promise.all(parsed.files.map((f) => this.store.preview(entry, f).then((p) => p.status)));
    const failing = statuses.filter((s) => s === 'hunksOnly').length;
    const applied = statuses.length > 0 && statuses.every((s) => s === 'applied');

    const parts = [rel === '.' ? '' : rel, `${parsed.files.length} file${parsed.files.length === 1 ? '' : 's'}`];
    if (failing) {
      parts.push(`${failing} not applicable`);
    } else if (applied) {
      parts.push('applied');
    }
    item.description = parts.filter(Boolean).join(' · ');

    item.iconPath = parsed.error || failing
      ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'))
      : applied
        ? new vscode.ThemeIcon('check-all', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('diff');

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${path.basename(entry.uri.path)}**\n\n`);
    if (parsed.subject) {
      tooltip.appendText(parsed.subject);
      tooltip.appendMarkdown('\n\n');
    }
    if (parsed.author) {
      tooltip.appendText(`Author: ${parsed.author}`);
      tooltip.appendMarkdown('\n\n');
    }
    if (parsed.error) {
      tooltip.appendText(`Parse error: ${parsed.error}`);
      tooltip.appendMarkdown('\n\n');
    }
    const adds = parsed.files.reduce((n, f) => n + f.additions, 0);
    const dels = parsed.files.reduce((n, f) => n + f.deletions, 0);
    tooltip.appendText(`${parsed.files.length} file(s), +${adds} −${dels}`);
    if (failing) {
      tooltip.appendText(`, ${failing} not applicable to the workspace`);
    }
    item.tooltip = tooltip;
    return item;
  }

  private fileItem(node: FileNode, preview: Preview): vscode.TreeItem {
    const { file, entry } = node;
    const item = new vscode.TreeItem(path.posix.basename(file.path), vscode.TreeItemCollapsibleState.None);
    item.id = `${entry.uri.toString()}#${file.index}`;
    item.resourceUri = fileItemUri(entry, file);
    item.contextValue = ContextValue.file;
    item.iconPath = vscode.ThemeIcon.File;

    const parts: string[] = [];
    if (KIND_LABEL[file.kind]) {
      parts.push(KIND_LABEL[file.kind]);
    }
    if (file.kind !== 'binary') {
      parts.push(`+${file.additions} −${file.deletions}`);
    }
    if (preview.status === 'applied') {
      parts.push('applied');
    } else if (preview.status === 'hunksOnly') {
      parts.push('hunks only');
    } else if (preview.status === 'fuzzy') {
      parts.push('fuzzy');
    }
    item.description = parts.join(' · ');

    const lines = [file.path];
    if (file.oldPath && file.newPath && file.oldPath !== file.newPath) {
      lines.push(`${KIND_LABEL[file.kind]} from ${file.oldPath}`);
    }
    if (preview.note) {
      lines.push(preview.note);
    }
    item.tooltip = lines.join('\n');
    item.command = { command: 'patchManager.openDiff', title: 'Show Patched Diff', arguments: [node] };
    return item;
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}
