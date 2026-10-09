import * as vscode from 'vscode';
import type { StripLevel } from './patchParser';

export const SECTION = 'patchManager';

export interface PatchManagerConfig {
  include: string;
  exclude: string;
  patchesFolder: string;
  folderOnly: boolean;
  fuzzFactor: number;
  stripLevel: StripLevel;
  baseDir: string;
}

export function getConfig(scope?: vscode.ConfigurationScope): PatchManagerConfig {
  const c = vscode.workspace.getConfiguration(SECTION, scope);
  const strip = c.get<string | number>('stripLevel', 'auto');
  const stripNum = typeof strip === 'number' ? strip : Number.parseInt(strip, 10);
  return {
    include: c.get('include', '**/*.{patch,diff}'),
    exclude: c.get('exclude', '**/{node_modules,.git}/**'),
    patchesFolder: c.get('patchesFolder', 'patches').replace(/^\/+|\/+$/g, ''),
    folderOnly: c.get('folderOnly', false),
    fuzzFactor: Math.max(0, c.get('fuzzFactor', 2)),
    stripLevel: Number.isInteger(stripNum) && stripNum >= 0 ? stripNum : 'auto',
    baseDir: c.get('baseDir', ''),
  };
}

/** The glob used to find patch files, honouring folder-only mode. */
export function patchGlob(config: PatchManagerConfig): string {
  if (config.folderOnly && config.patchesFolder) {
    return `${config.patchesFolder}/${config.include.replace(/^(\*\*\/)+/, '**/')}`;
  }
  return config.include;
}
