import { defineConfig } from '@vscode/test-cli';
import { existsSync } from 'fs';

// Reuse a locally installed VS Code when available instead of downloading one.
const local = process.env.VSCODE_TEST_PATH ?? '/usr/share/code/code';

export default defineConfig({
  files: 'out/test/suite/**/*.test.js',
  workspaceFolder: 'test/fixtures/workspace',
  ...(existsSync(local) ? { useInstallation: { fromPath: local } } : {}),
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'tdd', timeout: 20000 },
});
