import { parsePatch, type StructuredPatch } from 'diff';

export type StripLevel = number | 'auto';

export type FileDiffKind = 'modify' | 'add' | 'delete' | 'rename' | 'copy' | 'binary';

export interface FileDiff {
  /** Position of this file within the patch. */
  index: number;
  /** Path before the change, after stripping; undefined for added files. */
  oldPath?: string;
  /** Path after the change, after stripping; undefined for deleted files. */
  newPath?: string;
  /** Path the change targets in the workspace (new path, else old path). */
  path: string;
  kind: FileDiffKind;
  additions: number;
  deletions: number;
  structured: StructuredPatch;
}

export interface ParsedPatch {
  files: FileDiff[];
  /** `Subject:` from a `git format-patch` mail header, without the `[PATCH]` tag. */
  subject?: string;
  /** `From:` from a `git format-patch` mail header. */
  author?: string;
  /** Set when the text could not be parsed. */
  error?: string;
}

const DEV_NULL = '/dev/null';

export function stripPath(path: string, level: number): string {
  if (level <= 0) {
    return path;
  }
  const parts = path.split('/').filter((p) => p.length > 0);
  return parts.slice(Math.min(level, parts.length - 1)).join('/');
}

function isGitPrefixed(sp: StructuredPatch): boolean {
  const okOld = sp.oldFileName === undefined || sp.oldFileName === DEV_NULL || sp.oldFileName.startsWith('a/');
  const okNew = sp.newFileName === undefined || sp.newFileName === DEV_NULL || sp.newFileName.startsWith('b/');
  return okOld && okNew;
}

function resolveName(name: string | undefined, level: number): string | undefined {
  if (name === undefined || name === DEV_NULL) {
    return undefined;
  }
  return stripPath(name, level);
}

function classify(sp: StructuredPatch, oldPath?: string, newPath?: string): FileDiffKind {
  if (sp.isBinary) {
    return 'binary';
  }
  if (sp.isCreate || (oldPath === undefined && newPath !== undefined)) {
    return 'add';
  }
  if (sp.isDelete || (newPath === undefined && oldPath !== undefined)) {
    return 'delete';
  }
  if (sp.isCopy) {
    return 'copy';
  }
  if (sp.isRename || (oldPath !== undefined && newPath !== undefined && oldPath !== newPath)) {
    return 'rename';
  }
  return 'modify';
}

function readMailHeader(text: string): { subject?: string; author?: string } {
  // Only look at the header block of a format-patch mail (before the first blank line).
  if (!text.startsWith('From ')) {
    return {};
  }
  const end = text.search(/\r?\n\r?\n/);
  const header = (end >= 0 ? text.slice(0, end) : text).replace(/\r?\n[ \t]+/g, ' ');
  const subject = /^Subject:\s*(.*)$/m.exec(header)?.[1]?.replace(/^\[PATCH[^\]]*\]\s*/, '');
  const author = /^From:\s*(.*)$/m.exec(header)?.[1];
  return { subject: subject || undefined, author: author || undefined };
}

/**
 * Remove `git format-patch` mail signatures (`-- ` followed by the git
 * version). jsdiff would otherwise read `-- ` as a deleted line of the last hunk.
 */
function stripMailSignatures(text: string): string {
  return text.replace(/^-- \r?\n\d[\w.\-]*[ \t]*(\r?\n|$)/gm, '');
}

export function parsePatchText(text: string, stripLevel: StripLevel = 'auto'): ParsedPatch {
  const header = readMailHeader(text);
  let structured: StructuredPatch[];
  try {
    structured = parsePatch(stripMailSignatures(text));
  } catch (e) {
    return { files: [], ...header, error: e instanceof Error ? e.message : String(e) };
  }

  const files: FileDiff[] = [];
  for (const sp of structured) {
    // parsePatch yields one empty entry for text with no diff in it.
    if (sp.oldFileName === undefined && sp.newFileName === undefined && sp.hunks.length === 0) {
      continue;
    }
    const level = stripLevel === 'auto' ? (sp.isGit || isGitPrefixed(sp) ? 1 : 0) : stripLevel;
    const oldPath = resolveName(sp.oldFileName, level);
    const newPath = resolveName(sp.newFileName, level);
    const path = newPath ?? oldPath;
    if (path === undefined) {
      continue;
    }
    let additions = 0;
    let deletions = 0;
    for (const hunk of sp.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) {
          additions++;
        } else if (line.startsWith('-')) {
          deletions++;
        }
      }
    }
    files.push({
      index: files.length,
      oldPath,
      newPath,
      path,
      kind: classify(sp, oldPath, newPath),
      additions,
      deletions,
      structured: sp,
    });
  }

  return { files, ...header };
}
