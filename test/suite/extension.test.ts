import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import type { PatchManagerApi } from '../../src/extension';
import type { FileNode, PatchTreeNode } from '../../src/tree/nodes';

async function api(): Promise<PatchManagerApi> {
  const ext = vscode.extensions.getExtension<PatchManagerApi>('2kyan.patch-manager');
  assert.ok(ext, 'extension not found');
  return ext.activate();
}

async function labels(tree: PatchManagerApi['tree'], nodes: PatchTreeNode[]): Promise<string[]> {
  const items = await Promise.all(nodes.map((n) => tree.getTreeItem(n)));
  return items.map((i) => String(i.label));
}

async function findFile(tree: PatchManagerApi['tree'], patch: string, filePath: string): Promise<FileNode> {
  const roots = await tree.getChildren();
  const root = roots.find((n) => n.type === 'patch' && n.entry.uri.path.endsWith(patch));
  assert.ok(root, `patch ${patch} not found`);
  const file = root.entry.parsed.files.find((f) => f.path === filePath);
  assert.ok(file, `${filePath} not in ${patch}`);
  return { type: 'file', entry: root.entry, file };
}

suite('Patch Manager', () => {
  const workspace = vscode.workspace.workspaceFolders![0].uri;

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.workspace.getConfiguration('patchManager').update('folderOnly', undefined, vscode.ConfigurationTarget.Global);
  });

  test('lists every patch file in the workspace', async () => {
    const { tree } = await api();
    assert.deepStrictEqual(await labels(tree, await tree.getChildren()), [
      'fix.diff',
      '0001-Tune-defaults-and-add-guide.patch',
      '0002-Comment-sub.patch',
      '0003-Rename-output.patch',
      '0004-Add-cxx-engine.patch',
    ]);
  });

  test('mirrors the project folder structure under each patch', async () => {
    const { tree } = await api();
    const [, first] = await tree.getChildren();
    const level1 = await tree.getChildren(first);
    assert.deepStrictEqual(await labels(tree, level1), ['docs', 'lib/math', 'src/app']);
    const docs = await tree.getChildren(level1[0]);
    assert.deepStrictEqual(await labels(tree, docs), ['guide.md', 'old.md']);
    const guide = await tree.getTreeItem(docs[0]);
    assert.strictEqual(guide.contextValue, 'patchedFile');
    assert.strictEqual(guide.command?.command, 'patchManager.openDiff');
  });

  test('uses the file icon theme, keyed by the target file name', async () => {
    const { tree } = await api();
    const item = await tree.getTreeItem(await findFile(tree, '0004-Add-cxx-engine.patch', 'src/engine/core.cxx'));
    assert.strictEqual(item.iconPath, vscode.ThemeIcon.File);
    assert.strictEqual(item.resourceUri?.scheme, 'patch-manager-item');
    assert.strictEqual(item.resourceUri?.path, '/src/engine/core.cxx');
  });

  test('badges files with their change kind or apply status', async () => {
    const { tree, decorations } = await api();
    const badge = async (patch: string, file: string) => {
      const item = await tree.getTreeItem(await findFile(tree, patch, file));
      return (await decorations.provideFileDecoration(item.resourceUri!))?.badge;
    };
    assert.strictEqual(await badge('0004-Add-cxx-engine.patch', 'src/engine/core.cxx'), 'A');
    assert.strictEqual(await badge('0001-Tune-defaults-and-add-guide.patch', 'src/app/main.c'), 'M');
    assert.strictEqual(await badge('0002-Comment-sub.patch', 'src/app/util.c'), '~');
    assert.strictEqual(await badge('fix.diff', 'README.md'), '✓');
    assert.strictEqual(await badge('0003-Rename-output.patch', 'src/app/main.c'), '!');
  });

  test('opens a diff of the workspace file against the patched preview without touching disk', async () => {
    const { tree } = await api();
    const target = vscode.Uri.joinPath(workspace, 'src/app/main.c');
    const before = fs.readFileSync(target.fsPath, 'utf8');

    await vscode.commands.executeCommand('patchManager.openDiff', await findFile(tree, '0001-Tune-defaults-and-add-guide.patch', 'src/app/main.c'));

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputTextDiff, 'expected a diff editor');
    assert.strictEqual(input.original.toString(), target.toString());
    assert.strictEqual(input.modified.scheme, 'patch-preview');
    const modified = await vscode.workspace.openTextDocument(input.modified);
    assert.ok(modified.getText().includes('int b = 40;'));
    assert.strictEqual(fs.readFileSync(target.fsPath, 'utf8'), before);
  });

  test('overlapping reloads leave a single set of watchers', async () => {
    const { store } = await api();
    await Promise.all([store.reload(), store.reload(), store.reload()]);
    // One patch watcher and one file watcher per workspace folder.
    assert.strictEqual(store['watchers'].length, 2 * vscode.workspace.workspaceFolders!.length);
  });

  test('badges an already-applied rename as applied', async () => {
    const { tree, decorations, store } = await api();
    const patch = vscode.Uri.joinPath(workspace, 'extra/rename.diff');
    const renamed = vscode.Uri.joinPath(workspace, 'extra/renamed.txt');
    fs.writeFileSync(
      patch.fsPath,
      [
        'diff --git a/extra/original.txt b/extra/renamed.txt',
        'similarity index 80%',
        'rename from extra/original.txt',
        'rename to extra/renamed.txt',
        '--- a/extra/original.txt',
        '+++ b/extra/renamed.txt',
        '@@ -1,2 +1,2 @@',
        ' a',
        '-b',
        '+c',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(renamed.fsPath, 'a\nc\n');
    try {
      await store.reload();
      const item = await tree.getTreeItem(await findFile(tree, 'rename.diff', 'extra/renamed.txt'));
      assert.strictEqual((await decorations.provideFileDecoration(item.resourceUri!))?.badge, '✓');
    } finally {
      fs.rmSync(patch.fsPath, { force: true });
      fs.rmSync(renamed.fsPath, { force: true });
      await store.reload();
    }
  });

  test('folder-only mode restricts the list to the patches folder', async () => {
    const { tree, store } = await api();
    await vscode.workspace.getConfiguration('patchManager').update('folderOnly', true, vscode.ConfigurationTarget.Global);
    await store.reload();
    assert.deepStrictEqual(await labels(tree, await tree.getChildren()), [
      '0001-Tune-defaults-and-add-guide.patch',
      '0002-Comment-sub.patch',
      '0003-Rename-output.patch',
      '0004-Add-cxx-engine.patch',
    ]);
  });
});
