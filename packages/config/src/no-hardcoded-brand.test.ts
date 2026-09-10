import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';

import { noHardcodedBrand } from '../eslint/rules/no-hardcoded-brand.mjs';

/**
 * `RuleTester` looks for a global test framework. Vitest runs with `globals: false`, so
 * the hooks are wired in explicitly. These statics are not in ESLint's published types,
 * hence the narrow cast.
 */
const tester = RuleTester as unknown as {
  afterAll: typeof afterAll;
  describe: typeof describe;
  it: typeof it;
  itOnly: typeof it.only;
};
tester.afterAll = afterAll;
tester.describe = describe;
tester.it = it;
tester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const options = [{ brandNames: ['ROMP', 'ROMP Retail Private Limited'] }];

ruleTester.run('no-hardcoded-brand', noHardcodedBrand, {
  valid: [
    // Tokens, which is the whole point of the rule. Note the namespace is `--store-`,
    // not the brand name — otherwise every token reference would trip this rule.
    { code: 'const style = { color: "var(--store-color-primary)" };', options },
    { code: 'const cls = "bg-primary text-primary-on";', options },
    { code: 'const name = config.brand.name;', options },

    // Not colours, despite containing a hash.
    { code: 'const anchor = "#main-content";', options },
    { code: 'const ref = "#/components/schemas/Money";', options },
    { code: 'const hash = "#";', options },

    // Word-bounded brand matching: a rule that fires inside ordinary words gets
    // disabled within a week.
    { code: 'const verb = "prompt the user";', options },
    { code: 'const gerund = "romping around";', options },

    // Explicitly allowed identifiers, for the rare legitimate literal.
    {
      code: 'const brandFallbackColor = "#d8fd4f";',
      options: [{ brandNames: ['ROMP'], allowedIdentifiers: ['brandFallbackColor'] }],
    },
    {
      code: 'const theme = { fallbackColor: "#d8fd4f" };',
      options: [{ brandNames: ['ROMP'], allowedIdentifiers: ['fallbackColor'] }],
    },

    // No brand names configured means only colours are checked.
    { code: 'const label = "ROMP";', options: [{ brandNames: [] }] },

    // Module specifiers are paths, not copy. The workspace's own packages are named after
    // the platform, and flagging every internal import is how a rule gets disabled.
    { code: 'import { Button } from "@romp/ui";', options },
    { code: 'export { Button } from "@romp/ui";', options },
    { code: 'export * from "@romp/ui";', options },
    { code: 'const m = await import("@romp/ui");', options },
    { code: 'const m = require("@romp/ui");', options },
    // A mock target is a module specifier too, not user-facing copy.
    { code: 'vi.mock("@romp/data");', options },
    { code: 'vi.doMock("@romp/data", () => ({}));', options },
    // A colour-looking path is not a colour either.
    { code: 'import x from "./#fff";', options },

    // Non-string literals are irrelevant.
    { code: 'const count = 42;', options },
    { code: 'const flag = true;', options },
  ],

  invalid: [
    {
      code: 'const style = { color: "#d8fd4f" };',
      options,
      errors: [{ messageId: 'colorLiteral' }],
    },
    {
      code: 'const style = { color: "#FFF" };',
      options,
      errors: [{ messageId: 'colorLiteral' }],
    },
    {
      // Eight-digit hex with alpha.
      code: 'const style = { color: "#d8fd4f80" };',
      options,
      errors: [{ messageId: 'colorLiteral' }],
    },
    {
      // Tailwind arbitrary value, the most likely way this gets bypassed.
      code: 'const cls = "bg-[#d8fd4f] text-white";',
      options,
      errors: [{ messageId: 'colorLiteral' }],
    },
    {
      code: 'const style = { color: "rgb(216 253 79)" };',
      options,
      errors: [{ messageId: 'functionalColor' }],
    },
    {
      code: 'const style = { background: "rgba(0,0,0,0.5)" };',
      options,
      errors: [{ messageId: 'functionalColor' }],
    },
    {
      code: 'const style = { color: "oklch(0.7 0.2 120)" };',
      options,
      errors: [{ messageId: 'functionalColor' }],
    },
    {
      // Inside a template literal, e.g. an inline CSS block.
      code: 'const css = `.a { color: #d8fd4f; }`;',
      options,
      errors: [{ messageId: 'colorLiteral' }],
    },
    {
      code: 'const title = "ROMP";',
      options,
      errors: [{ messageId: 'brandName' }],
    },
    {
      code: 'const title = "Welcome to ROMP, the toy store";',
      options,
      errors: [{ messageId: 'brandName' }],
    },
    {
      // Case-insensitive: a lowercase spelling is still the brand.
      code: 'const title = "welcome to romp";',
      options,
      errors: [{ messageId: 'brandName' }],
    },
    {
      code: 'const legal = "ROMP Retail Private Limited";',
      options,
      // The shorter name matches first; either report is correct.
      errors: [{ messageId: 'brandName' }],
    },
    {
      code: 'const alt = `Logo for ROMP`;',
      options,
      errors: [{ messageId: 'brandName' }],
    },
  ],
});
