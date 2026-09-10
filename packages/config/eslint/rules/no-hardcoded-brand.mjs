// @ts-check
/**
 * ESLint rule: no hardcoded brand values.
 *
 * The white-label contract is that creating a store needs zero changes under `apps/`.
 * Good intentions decay, so this is the mechanical half of keeping that true: it fails
 * any colour literal, and any occurrence of a configured brand name, in application
 * code.
 *
 * Colours must come from the emitted tokens — `var(--store-color-primary)` or the
 * matching Tailwind class — and brand strings from the store config. Both reach
 * components from one source, so there is never a reason for a literal.
 *
 * What this rule can and cannot do: it catches hex and functional colour literals and
 * whole-word brand-name matches. It cannot catch a brand name assembled from fragments,
 * or a colour written as a CSS keyword inside an unrelated string. The second-store CI
 * matrix is the backstop — a hardcoded brand shows up as one store's name appearing in
 * another store's output.
 */

/**
 * Hex colours, anchored to the whole string so an anchor like `#main` or a JSON-Schema
 * pointer like `#/components/schemas/Money` is not flagged.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;

/** Functional colour notation anywhere in a string. */
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\(/iu;

/**
 * Hex colours inside a longer string, e.g. a CSS declaration in a template literal.
 * Requires a boundary before the `#`, so a path fragment is not a match.
 */
const EMBEDDED_HEX_COLOR = /(?:^|[\s:;,('"[])#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/iu;

/**
 * @param {string} value
 * @returns {string}
 */
function truncate(value) {
  const collapsed = value.replaceAll(/\s+/gu, ' ').trim();
  return collapsed.length > 60 ? `${collapsed.slice(0, 57)}…` : collapsed;
}

/**
 * Case-insensitive whole-word match.
 *
 * Word-bounded so a brand name like "Romp" does not flag "prompt" or "romping". A rule
 * that fires on substrings inside ordinary words gets disabled within a week.
 *
 * @param {string} haystack
 * @param {string} needle
 * @returns {boolean}
 */
function containsWord(haystack, needle) {
  const escaped = needle.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  return new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${escaped}(?:[^\p{L}\p{N}]|$)`, 'iu').test(
    haystack,
  );
}

/** @type {import('eslint').Rule.RuleModule} */
export const noHardcodedBrand = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow colour literals and configured brand names in application code; use store-config tokens instead.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          brandNames: { type: 'array', items: { type: 'string' } },
          allowedIdentifiers: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      colorLiteral:
        'Hardcoded colour "{{value}}". Use a theme token — `var(--store-color-…)` or the matching Tailwind class — so a rebrand does not need a code change.',
      functionalColor:
        'Hardcoded colour in "{{value}}". Use a theme token instead of a literal colour function.',
      brandName:
        'Hardcoded brand name "{{value}}". Read it from the store config, or a second store will ship this store\'s name.',
    },
  },

  create(context) {
    const options = /** @type {{ brandNames?: string[], allowedIdentifiers?: string[] }} */ (
      context.options[0] ?? {}
    );
    const brandNames = options.brandNames ?? [];
    const allowedIdentifiers = new Set(options.allowedIdentifiers ?? []);

    /**
     * Whether this node sits somewhere a literal is legitimate — an explicitly allowed
     * property name or variable.
     *
     * @param {import('estree').Node & { parent?: unknown }} node
     * @returns {boolean}
     */
    function isExempt(node) {
      let current = /** @type {any} */ (node).parent;
      while (current !== undefined && current !== null) {
        if (current.type === 'Property' && current.key) {
          const key =
            current.key.type === 'Identifier' ? current.key.name : String(current.key.value);
          if (allowedIdentifiers.has(key)) return true;
        }
        if (
          current.type === 'VariableDeclarator' &&
          current.id?.type === 'Identifier' &&
          allowedIdentifiers.has(current.id.name)
        ) {
          return true;
        }
        current = current.parent;
      }
      return false;
    }

    /**
     * @param {import('estree').Node} node
     * @param {string | undefined} raw
     */
    function checkString(node, raw) {
      if (typeof raw !== 'string' || raw.length === 0) return;
      if (isExempt(node)) return;

      if (HEX_COLOR.test(raw.trim()) || EMBEDDED_HEX_COLOR.test(raw)) {
        context.report({
          node: /** @type {any} */ (node),
          messageId: 'colorLiteral',
          data: { value: truncate(raw) },
        });
        return;
      }

      if (FUNCTIONAL_COLOR.test(raw)) {
        context.report({
          node: /** @type {any} */ (node),
          messageId: 'functionalColor',
          data: { value: truncate(raw) },
        });
        return;
      }

      for (const brand of brandNames) {
        if (brand.length > 0 && containsWord(raw, brand)) {
          context.report({
            node: /** @type {any} */ (node),
            messageId: 'brandName',
            data: { value: brand },
          });
          return;
        }
      }
    }

    /**
     * Whether this string literal is a module specifier.
     *
     * Import and export paths are not user-facing copy, and the workspace's own packages
     * are legitimately named after the platform — `@romp/ui` is infrastructure, not
     * something a second store rebrands. Without this exemption the rule fires on every
     * internal import, and the only way anyone would keep working is to disable it.
     *
     * @param {any} node
     * @returns {boolean}
     */
    function isModuleSpecifier(node) {
      const parent = node.parent;
      if (parent === undefined || parent === null) return false;

      return (
        ((parent.type === 'ImportDeclaration' ||
          parent.type === 'ExportNamedDeclaration' ||
          parent.type === 'ExportAllDeclaration' ||
          parent.type === 'ImportExpression') &&
          parent.source === node) ||
        // `require('…')`, dynamic `import('…')`, and the test-double mock calls
        // `vi.mock('…')` / `vi.doMock('…')`. The first argument to a mock is a module
        // specifier — a workspace package path like `@romp/data` — not user-facing copy,
        // so it is exempt for the same reason an import path is.
        (parent.type === 'CallExpression' &&
          parent.arguments[0] === node &&
          ((parent.callee.type === 'Identifier' && parent.callee.name === 'require') ||
            parent.callee.type === 'Import' ||
            (parent.callee.type === 'MemberExpression' &&
              parent.callee.property.type === 'Identifier' &&
              (parent.callee.property.name === 'mock' ||
                parent.callee.property.name === 'doMock' ||
                parent.callee.property.name === 'unmock' ||
                parent.callee.property.name === 'doUnmock'))))
      );
    }

    return {
      /** @param {import('estree').Literal} node */
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (isModuleSpecifier(node)) return;
        checkString(node, node.value);
      },
      /** @param {import('estree').TemplateElement} node */
      TemplateElement(node) {
        checkString(node, node.value.cooked ?? node.value.raw);
      },
      // JSX text, e.g. `<h1>ROMP</h1>`.
      /** @param {{ value: string }} node */
      JSXText(node) {
        checkString(/** @type {any} */ (node), node.value);
      },
    };
  },
};

export default noHardcodedBrand;
