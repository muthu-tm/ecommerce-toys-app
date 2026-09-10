/**
 * Scaffolds a new store from `stores/_template`.
 *
 *   pnpm store:new toybox
 *
 * Copies the template, rewrites the identity fields, and prints the checklist. The
 * result is a **valid, working store** — the point is that the author can run
 * `STORE_ID=toybox pnpm dev` immediately and rebrand against something they can see,
 * rather than against a stack of validation errors.
 *
 * Refuses to overwrite an existing directory. A store config is hand-written work and
 * clobbering it is not something a scaffolding command should be able to do.
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '..', '..');
const templateDir = join(repoRoot, 'stores', '_template');

function fail(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

const storeId = process.argv[2];

if (storeId === undefined || storeId.length === 0) {
  fail('Usage: pnpm store:new <store-id>\n\nExample: pnpm store:new toybox');
}

if (!/^[a-z][a-z0-9-]*$/u.test(storeId)) {
  fail(
    `"${storeId}" is not a valid store ID.\n\nUse lowercase letters, digits and hyphens, starting with a letter — e.g. "toybox".\nA leading underscore is reserved for scaffolds.`,
  );
}

const targetDir = join(repoRoot, 'stores', storeId);

if (existsSync(targetDir)) {
  fail(`stores/${storeId} already exists. Delete it first if you really mean to start over.`);
}

if (!existsSync(templateDir)) {
  fail('stores/_template is missing. The scaffold cannot be copied.');
}

cpSync(templateDir, targetDir, { recursive: true });

// --- rewrite the identity fields ------------------------------------------------

const titleCase = storeId
  .split('-')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

// 2–8 uppercase letters, to satisfy HumanOrderIdSchema in @romp/contracts.
const orderPrefix = storeId
  .replaceAll(/[^a-z]/gu, '')
  .slice(0, 3)
  .toUpperCase()
  .padEnd(2, 'X');

const configPath = join(targetDir, 'store.config.ts');
const config = readFileSync(configPath, 'utf8')
  .replace(/(\bid:\s*)'_template'/u, `$1'${storeId}'`)
  .replace(/(\bname:\s*)'Example Store'/u, `$1'${titleCase}'`)
  .replace(/(\blegalName:\s*)'Example Store Private Limited'/u, `$1'${titleCase} Private Limited'`)
  .replace(/(\borderPrefix:\s*)'EXA'/u, `$1'${orderPrefix}'`);

writeFileSync(configPath, config, 'utf8');

const packagePath = join(targetDir, 'package.json');
const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
manifest.name = `@romp/store-${storeId}`;
manifest.description = `${titleCase} store configuration`;
writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

process.stdout.write(`
Created stores/${storeId} from the template.

It is already valid, so you can look at it before changing anything:

  pnpm install
  STORE_ID=${storeId} pnpm store:tokens
  STORE_ID=${storeId} pnpm dev

Then make it yours:

  1. stores/${storeId}/store.config.ts — brand, palette, fonts, copy, locale,
     features, commerce, warehouses, categories, age bands.
  2. stores/${storeId}/assets/ — replace the placeholder logos, mark, favicon and
     the 1200x630 OG fallback.
  3. STORE_ID=${storeId} pnpm --filter @romp/store-config test
     Fails with the exact path if anything is missing, and refuses any palette that
     falls below WCAG AA.

Then, when the brand is settled:

  4. Create the Firebase projects:
       infra/scripts/setup-projects.sh ${storeId}-dev asia-south1
       infra/scripts/setup-wif.sh ${storeId}-dev <owner>/<repo> development
     and add the aliases to .firebaserc.
  5. Seed:   STORE_ID=${storeId} pnpm seed && STORE_ID=${storeId} pnpm seed:admins
  6. Deploy: run the workflow with STORE_ID=${storeId}
  7. Domains: verify grey-clouded at Cloudflare FIRST, then enable proxying with
     SSL Full (strict). The order matters — see docs/adr/0003.

`);
