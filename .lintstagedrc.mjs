import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/**
 * Workspace globs from pnpm-workspace.yaml, expressed as the directory prefixes
 * under which each linted package lives. A file's owning package is the nearest
 * ancestor directory that has its own `eslint.config.mjs`.
 */
const WORKSPACE_DIRS = ['apps', 'packages', 'stores', 'infra'];

/**
 * Find the package root that owns a file: walk up from the file's directory to
 * the repo root, returning the first directory that contains an
 * `eslint.config.mjs`. Returns null when no package config is found (the file is
 * then skipped for ESLint — Prettier still formats it).
 */
function packageRootFor(absFile) {
  let dir = path.dirname(absFile);
  while (dir.startsWith(ROOT) && dir !== ROOT) {
    if (existsSync(path.join(dir, 'eslint.config.mjs'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * ESLint here uses per-package flat configs (see packages/config/eslint/base.mjs):
 * each `eslint.config.mjs` resolves paths and type-aware `projectService` relative
 * to its own directory, so ESLint must be invoked from inside the package. lint-staged
 * runs from the repo root, so we group the staged files by owning package and emit one
 * `eslint` invocation per package, each `cd`-ed into that package with the files passed
 * as paths relative to it.
 */
function eslintByPackage(files) {
  const byPackage = new Map();
  for (const absFile of files) {
    const pkgRoot = packageRootFor(absFile);
    if (!pkgRoot) continue;
    const list = byPackage.get(pkgRoot) ?? [];
    list.push(path.relative(pkgRoot, absFile));
    byPackage.set(pkgRoot, list);
  }

  return [...byPackage.entries()].map(([pkgRoot, relFiles]) => {
    const rel = path.relative(ROOT, pkgRoot);
    const quoted = relFiles.map((f) => JSON.stringify(f)).join(' ');
    return `pnpm --dir ${JSON.stringify(rel)} exec eslint --fix --max-warnings=0 ${quoted}`;
  });
}

export default {
  '*.{ts,tsx,mts}': [eslintByPackage, 'prettier --write'],
  '*.{js,mjs,cjs}': ['prettier --write'],
  '*.{json,md,yml,yaml,css}': ['prettier --write'],
};
