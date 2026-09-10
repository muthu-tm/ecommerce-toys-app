/**
 * Conditional class names.
 *
 * Deliberately not `clsx` or `tailwind-merge`. This is a dozen lines, and the
 * conflict-resolution `tailwind-merge` provides is not wanted here: a component that
 * needs a caller to be able to override its padding should expose a prop, not rely on a
 * runtime class-precedence library to guess. Making that impossible keeps the component
 * API honest.
 */
export type ClassValue = string | number | false | null | undefined | ClassValue[];

export function cn(...values: readonly ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (value === null || value === undefined || value === false || value === '') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    out.push(String(value));
  };

  for (const value of values) walk(value);

  // Deduplicate while keeping the last occurrence's position stable. Repeated classes
  // are harmless in CSS but make rendered markup hard to read in a test failure.
  return [...new Set(out.join(' ').split(/\s+/u).filter(Boolean))].join(' ');
}
