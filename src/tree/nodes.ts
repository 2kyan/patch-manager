import type { FileDiff } from '../patchParser';
import type { PatchEntry } from '../patchStore';
import type { DirEntry } from './treeBuilder';

export interface PatchNode {
  type: 'patch';
  entry: PatchEntry;
}

export interface FolderNode {
  type: 'folder';
  entry: PatchEntry;
  dir: DirEntry<FileDiff>;
}

export interface FileNode {
  type: 'file';
  entry: PatchEntry;
  file: FileDiff;
}

export type PatchTreeNode = PatchNode | FolderNode | FileNode;

/** `contextValue`s used by `when` clauses in package.json menus. */
export const ContextValue = {
  patch: 'patchFile',
  folder: 'patchFolder',
  file: 'patchedFile',
} as const;
