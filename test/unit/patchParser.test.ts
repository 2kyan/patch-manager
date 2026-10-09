import * as assert from 'assert';
import { parsePatchText, stripPath } from '../../src/patchParser';
import { read } from './fixtures';

suite('patchParser', () => {
  test('parses a git format-patch with modify, add and delete', () => {
    const parsed = parsePatchText(read('patches/0001-Tune-defaults-and-add-guide.patch'));
    assert.strictEqual(parsed.subject, 'Tune defaults and add guide');
    assert.strictEqual(parsed.author, 'Tester <t@t>');
    assert.deepStrictEqual(
      parsed.files.map((f) => [f.path, f.kind, f.additions, f.deletions]),
      [
        ['docs/guide.md', 'add', 3, 0],
        ['docs/old.md', 'delete', 0, 1],
        ['lib/math/add.py', 'modify', 1, 0],
        ['src/app/main.c', 'modify', 1, 1],
      ],
    );
    assert.deepStrictEqual(parsed.files.map((f) => f.index), [0, 1, 2, 3]);
    assert.strictEqual(parsed.files[0].oldPath, undefined);
    assert.strictEqual(parsed.files[1].newPath, undefined);
  });

  test('does not strip plain diff paths in auto mode', () => {
    const parsed = parsePatchText(read('extra/fix.diff'));
    assert.deepStrictEqual(parsed.files.map((f) => f.path), ['README.md']);
    assert.strictEqual(parsed.subject, undefined);
  });

  test('honours an explicit strip level', () => {
    const text = '--- orig/src/x.c\n+++ new/src/x.c\n@@ -1 +1 @@\n-a\n+b\n';
    assert.deepStrictEqual(parsePatchText(text, 1).files.map((f) => f.path), ['src/x.c']);
    assert.deepStrictEqual(parsePatchText(text, 0).files.map((f) => f.path), ['new/src/x.c']);
  });

  test('detects renames and binary files', () => {
    const text = [
      'diff --git a/old.txt b/dir/new.txt',
      'similarity index 100%',
      'rename from old.txt',
      'rename to dir/new.txt',
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
      '',
    ].join('\n');
    const files = parsePatchText(text).files;
    assert.deepStrictEqual(files.map((f) => [f.oldPath, f.path, f.kind]), [
      ['old.txt', 'dir/new.txt', 'rename'],
      ['img.png', 'img.png', 'binary'],
    ]);
  });

  test('returns no files for text without a diff', () => {
    assert.deepStrictEqual(parsePatchText('just some notes\n').files, []);
  });

  test('stripPath never strips the file name itself', () => {
    assert.strictEqual(stripPath('a/b/c', 1), 'b/c');
    assert.strictEqual(stripPath('a/b/c', 5), 'c');
    assert.strictEqual(stripPath('a/b/c', 0), 'a/b/c');
  });
});
