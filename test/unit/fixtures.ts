import * as fs from 'fs';
import * as path from 'path';

// Compiled to out/test/unit, so walk back to the source fixtures.
export const WORKSPACE = path.resolve(__dirname, '../../../test/fixtures/workspace');

export function read(rel: string): string {
  return fs.readFileSync(path.join(WORKSPACE, rel), 'utf8');
}

export function readOptional(rel: string): string | undefined {
  const file = path.join(WORKSPACE, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}
