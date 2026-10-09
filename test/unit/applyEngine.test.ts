import * as assert from 'assert';
import { parsePatchText } from '../../src/patchParser';
import { computePreview } from '../../src/preview/applyEngine';
import { read, readOptional } from './fixtures';

function previewAll(patch: string, fuzz = 2) {
  return parsePatchText(read(patch)).files.map((f) => ({ file: f, preview: computePreview(f, readOptional(f.oldPath ?? f.path), fuzz) }));
}

suite('applyEngine', () => {
  test('clean patch: modify, add and delete preview correctly', () => {
    const results = previewAll('patches/0001-Tune-defaults-and-add-guide.patch');
    assert.deepStrictEqual(results.map((r) => r.preview.status), ['clean', 'clean', 'clean', 'clean']);

    const [guide, old, , main] = results;
    assert.strictEqual(guide.preview.oldText, '');
    assert.strictEqual(guide.preview.newText, '# Guide\n\nNew guide.\n');
    assert.strictEqual(old.preview.oldText, 'old notes\n');
    assert.strictEqual(old.preview.newText, '');
    assert.strictEqual(main.preview.oldText, read('src/app/main.c'));
    assert.ok(main.preview.newText.includes('int b = 40;'));
    assert.ok(!main.preview.newText.includes('int b = 2;'));
  });

  test('drifted context applies only with fuzz', () => {
    const [fuzzy] = previewAll('patches/0002-Comment-sub.patch', 2);
    assert.strictEqual(fuzzy.preview.status, 'fuzzy');
    assert.ok(fuzzy.preview.newText.includes('return a - b; // subtract'));
    assert.ok(fuzzy.preview.newText.includes('/* v2 */'));

    const [strict] = previewAll('patches/0002-Comment-sub.patch', 0);
    assert.strictEqual(strict.preview.status, 'hunksOnly');
  });

  test('non-applicable patch falls back to hunks only', () => {
    const [broken] = previewAll('patches/0003-Rename-output.patch');
    assert.strictEqual(broken.preview.status, 'hunksOnly');
    assert.ok(broken.preview.oldText.startsWith('@@ -5,6 +5,6 @@\n'));
    assert.ok(broken.preview.oldText.includes('printf("SUM=%d\\n"'));
    assert.ok(broken.preview.newText.includes('printf("total=%d\\n"'));
  });

  test('already-applied patch is detected and reversed for the old side', () => {
    const [readme] = previewAll('extra/fix.diff');
    assert.strictEqual(readme.preview.status, 'applied');
    assert.strictEqual(readme.preview.oldText, '# Demo\n\nSample project.\n');
    assert.strictEqual(readme.preview.newText, read('README.md'));
  });

  test('missing target file falls back to hunks only', () => {
    const [main] = parsePatchText(read('patches/0003-Rename-output.patch')).files;
    assert.strictEqual(computePreview(main, undefined, 2).status, 'hunksOnly');
  });

  suite('renames', () => {
    const rename = (hunk: string[]) =>
      parsePatchText(
        ['diff --git a/old.txt b/new.txt', 'similarity index 80%', 'rename from old.txt', 'rename to new.txt', ...hunk, ''].join('\n'),
      ).files[0];
    const edited = rename(['--- a/old.txt', '+++ b/new.txt', '@@ -1,2 +1,2 @@', ' a', '-b', '+c']);

    test('applies to the old file while it exists', () => {
      const preview = computePreview(edited, 'a\nb\n', 0, undefined);
      assert.strictEqual(preview.status, 'clean');
      assert.strictEqual(preview.newText, 'a\nc\n');
    });

    test('is detected as applied from the new file once the old one is gone', () => {
      assert.deepStrictEqual(computePreview(edited, undefined, 0, 'a\nc\n'), {
        status: 'applied',
        oldText: 'a\nb\n',
        newText: 'a\nc\n',
        note: 'rename already applied',
      });
    });

    test('a pure rename is applied when only the new file exists', () => {
      const pure = rename([]);
      assert.strictEqual(computePreview(pure, undefined, 0, 'x\n').status, 'applied');
    });

    test('an unrelated new file does not count as applied', () => {
      assert.strictEqual(computePreview(edited, undefined, 0, 'other\n').status, 'hunksOnly');
      assert.strictEqual(computePreview(edited, undefined, 0, undefined).status, 'hunksOnly');
    });
  });
});
