export interface DirEntry<T> {
  /** Display name; may span several segments (`a/b`) once compacted. */
  name: string;
  /** Full path from the root, `''` for the root itself. */
  path: string;
  dirs: DirEntry<T>[];
  files: FileEntry<T>[];
}

export interface FileEntry<T> {
  name: string;
  path: string;
  item: T;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

/**
 * Arrange items into a folder hierarchy following their `/`-separated paths.
 * With `compact`, chains of folders holding a single sub-folder are merged
 * (`src` → `main` → `java` becomes `src/main/java`), as the Explorer does.
 */
export function buildTree<T>(items: readonly T[], pathOf: (item: T) => string, compact = true): DirEntry<T> {
  const root: DirEntry<T> = { name: '', path: '', dirs: [], files: [] };
  const dirIndex = new Map<string, DirEntry<T>>([['', root]]);

  for (const item of items) {
    const segments = pathOf(item).split('/').filter((s) => s.length > 0);
    if (segments.length === 0) {
      continue;
    }
    let dir = root;
    for (const segment of segments.slice(0, -1)) {
      const path = dir.path ? `${dir.path}/${segment}` : segment;
      let next = dirIndex.get(path);
      if (!next) {
        next = { name: segment, path, dirs: [], files: [] };
        dirIndex.set(path, next);
        dir.dirs.push(next);
      }
      dir = next;
    }
    dir.files.push({ name: segments[segments.length - 1], path: segments.join('/'), item });
  }

  const finish = (dir: DirEntry<T>): DirEntry<T> => {
    if (compact) {
      while (dir.path !== '' && dir.files.length === 0 && dir.dirs.length === 1) {
        const only = dir.dirs[0];
        dir = { name: `${dir.name}/${only.name}`, path: only.path, dirs: only.dirs, files: only.files };
      }
    }
    dir.dirs = dir.dirs.map(finish).sort(byName);
    dir.files.sort(byName);
    return dir;
  };
  return finish(root);
}
