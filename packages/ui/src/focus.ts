/**
 * The shared focus treatment.
 *
 * One constant, used by every interactive primitive, because a focus ring that varies
 * per component is a focus ring somebody will forget. The colour comes from
 * `focusRing` in store config, which the contrast gate holds to 3:1 against every
 * surface — so it cannot be configured into invisibility.
 *
 * `focus-visible` rather than `focus`: a mouse click should not leave a ring behind,
 * but a keyboard user must always see where they are. The offset keeps the ring clear
 * of the element's own border.
 */
export const FOCUS_RING =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

/**
 * Selector for everything tabbable inside a container.
 *
 * Used by the dialog's focus trap. `[tabindex="-1"]` is deliberately excluded — it is
 * programmatically focusable but not tabbable, so including it would trap Tab on
 * elements a keyboard user cannot otherwise reach.
 */
export const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Tabbable elements in DOM order, skipping anything hidden. */
export function tabbableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)].filter(
    (element) =>
      // `offsetParent` is null for `display: none`, and jsdom reports 0 for every
      // dimension, so the aria/hidden attributes carry the check in tests.
      element.getAttribute('aria-hidden') !== 'true' && !element.hasAttribute('hidden'),
  );
}
