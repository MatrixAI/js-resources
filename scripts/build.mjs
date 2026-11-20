#!/usr/bin/env node

import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv.includes('--no-clean')) {
  rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
}
execFileSync(
  process.execPath,
  [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-p', './tsconfig.build.json'],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
