import * as assert from 'assert';
import { buildTree, type DirEntry } from '../../src/tree/treeBuilder';

function render<T>(dir: DirEntry<T>, indent = ''): string[] {
  return [
    ...dir.dirs.flatMap((d) => [`${indent}${d.name}/`, ...render(d, indent + '  ')]),
    ...dir.files.map((f) => `${indent}${f.name}`),
  ];
}

suite('treeBuilder', () => {
  const paths = ['src/app/main.c', 'src/app/util.c', 'lib/math/add.py', 'README.md', 'src/z.c'];

  test('mirrors the project layout, folders first, sorted', () => {
    const tree = buildTree(paths, (p) => p, false);
    assert.deepStrictEqual(render(tree), [
      'lib/', '  math/', '    add.py',
      'src/', '  app/', '    main.c', '    util.c', '  z.c',
      'README.md',
    ]);
  });

  test('compacts single-child folder chains', () => {
    const tree = buildTree(paths, (p) => p);
    assert.deepStrictEqual(render(tree), [
      'lib/math/', '  add.py',
      'src/', '  app/', '    main.c', '    util.c', '  z.c',
      'README.md',
    ]);
    assert.strictEqual(tree.dirs[0].path, 'lib/math');
  });

  test('keeps full item paths on leaves', () => {
    const tree = buildTree(['a/b/c.txt'], (p) => p);
    assert.strictEqual(tree.dirs[0].name, 'a/b');
    assert.deepStrictEqual(tree.dirs[0].files[0], { name: 'c.txt', path: 'a/b/c.txt', item: 'a/b/c.txt' });
  });
});
