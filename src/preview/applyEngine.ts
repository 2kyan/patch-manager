import { applyPatch, reversePatch, type StructuredPatch } from 'diff';
import type { FileDiff } from '../patchParser';

export type PreviewStatus =
  /** Applies exactly at the recorded positions/context. */
  | 'clean'
  /** Applies only after allowing offset and/or mismatching context lines. */
  | 'fuzzy'
  /** The workspace file already contains the change (reverse patch applies). */
  | 'applied'
  /** Could not be applied; preview shows the hunks on their own. */
  | 'hunksOnly'
  /** Binary change; no textual preview. */
  | 'binary';

export interface Preview {
  status: PreviewStatus;
  oldText: string;
  newText: string;
  /** Short human-readable explanation for tooltips and titles. */
  note?: string;
}

const options = { autoConvertLineEndings: true } as const;

function tryApply(source: string, patch: StructuredPatch, fuzzFactor: number): string | undefined {
  const result = applyPatch(source, patch, { ...options, fuzzFactor });
  return result === false ? undefined : result;
}

/** Hunk-only before/after text, with an `@@` separator line so hunks line up in a diff view. */
export function hunkTexts(patch: StructuredPatch): { oldText: string; newText: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const hunk of patch.hunks) {
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    oldLines.push(header);
    newLines.push(header);
    for (const line of hunk.lines) {
      const op = line[0];
      const content = line.slice(1);
      if (op === ' ') {
        oldLines.push(content);
        newLines.push(content);
      } else if (op === '-') {
        oldLines.push(content);
      } else if (op === '+') {
        newLines.push(content);
      }
      // '\' ("No newline at end of file") markers carry no content.
    }
  }
  return { oldText: oldLines.join('\n') + '\n', newText: newLines.join('\n') + '\n' };
}

/**
 * Compute the before/after text for one file of a patch, entirely in memory.
 * `source` is the current workspace content of the targeted file, or
 * undefined when that file does not exist.
 */
export function computePreview(file: FileDiff, source: string | undefined, fuzzFactor: number): Preview {
  const patch = file.structured;

  if (file.kind === 'binary') {
    const text = 'Binary file — no textual preview.\n';
    return { status: 'binary', oldText: text, newText: text, note: 'binary file' };
  }

  // Pure renames/copies/mode changes have no hunks: the content is unchanged.
  if (patch.hunks.length === 0) {
    const text = source ?? '';
    return { status: 'clean', oldText: text, newText: text, note: file.kind === 'modify' ? 'no content change' : undefined };
  }

  if (file.kind === 'add') {
    const created = tryApply('', patch, 0);
    if (source !== undefined) {
      if (created !== undefined && created === source) {
        return { status: 'applied', oldText: '', newText: source, note: 'file already exists with this content' };
      }
      return { status: 'hunksOnly', ...hunkTexts(patch), note: 'file to be added already exists' };
    }
    return created !== undefined
      ? { status: 'clean', oldText: '', newText: created }
      : { status: 'hunksOnly', ...hunkTexts(patch), note: 'patch is malformed' };
  }

  if (file.kind === 'delete') {
    if (source === undefined) {
      const original = tryApply('', reversePatch(patch), 0);
      return original !== undefined
        ? { status: 'applied', oldText: original, newText: '', note: 'file already deleted' }
        : { status: 'hunksOnly', ...hunkTexts(patch), note: 'patch is malformed' };
    }
    return tryApply(source, patch, 0) === ''
      ? { status: 'clean', oldText: source, newText: '' }
      : { status: 'hunksOnly', ...hunkTexts(patch), note: 'file to be deleted has different content' };
  }

  if (source === undefined) {
    return { status: 'hunksOnly', ...hunkTexts(patch), note: 'target file not found' };
  }

  // Check for an already-applied patch first: a hunk that only adds lines
  // (e.g. at end of file) would otherwise apply a second time.
  const original = tryApply(source, reversePatch(patch), 0);
  if (original !== undefined) {
    return { status: 'applied', oldText: original, newText: source, note: 'already applied to workspace file' };
  }
  const exact = tryApply(source, patch, 0);
  if (exact !== undefined) {
    return { status: 'clean', oldText: source, newText: exact };
  }
  const fuzzy = fuzzFactor > 0 ? tryApply(source, patch, fuzzFactor) : undefined;
  if (fuzzy !== undefined) {
    return { status: 'fuzzy', oldText: source, newText: fuzzy, note: `applied with fuzz (up to ${fuzzFactor} mismatching lines)` };
  }
  return { status: 'hunksOnly', ...hunkTexts(patch), note: 'does not apply cleanly — showing hunks only' };
}
