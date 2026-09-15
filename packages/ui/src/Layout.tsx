import type { ElementType, HTMLAttributes, ReactNode } from 'react';

import { cn } from './cn';

/**
 * Layout primitives.
 *
 * These carry no colour and no brand — only spacing and composition, the mechanical
 * scaffolding a screen is built from. Concentrating them here means a page reads as
 * intent ("a section with a heading and these children") rather than a wall of flex
 * utilities repeated at every call site, and a spacing decision is changed in one place.
 */

/** Vertical rhythm between stacked blocks. */
export type StackGap = 'sm' | 'md' | 'lg' | 'xl';

const STACK_GAP: Readonly<Record<StackGap, string>> = Object.freeze({
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-8',
  xl: 'gap-16',
});

export interface StackProps extends Omit<HTMLAttributes<HTMLElement>, 'className'> {
  readonly as?: ElementType;
  readonly gap?: StackGap;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A vertical flex column with a tokenised gap.
 *
 * The single most repeated pattern in the app is `flex flex-col gap-N`. This names it, so
 * a screen expresses "these blocks, stacked, with this rhythm" without re-deriving the
 * utilities each time.
 */
export function Stack({ as: Element = 'div', gap = 'md', className, children, ...rest }: StackProps) {
  return (
    <Element className={cn('flex flex-col', STACK_GAP[gap], className)} {...rest}>
      {children}
    </Element>
  );
}

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'className' | 'title'> {
  /** The section heading. Omit for an unlabelled grouping. */
  readonly title?: ReactNode;
  /** Optional supporting line under the title. */
  readonly description?: ReactNode;
  /** Action(s) aligned to the end of the header row — a "See all" link, a button. */
  readonly action?: ReactNode;
  /** Heading level, so the document outline stays correct. Defaults to h2. */
  readonly headingLevel?: 2 | 3;
  readonly gap?: StackGap;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A titled content section.
 *
 * The heading and its optional action share a baseline-aligned row; the body follows in a
 * `Stack`. The heading level is a prop because a section nested inside another must not
 * emit a second `h2` — a correct outline is an accessibility requirement, not a nicety.
 * When no title is given, the section is a plain grouping with no heading in the tree.
 */
export function Section({
  title,
  description,
  action,
  headingLevel = 2,
  gap = 'md',
  className,
  children,
  ...rest
}: SectionProps) {
  const Heading = (headingLevel === 3 ? 'h3' : 'h2') as ElementType;

  return (
    <section className={cn('flex flex-col', STACK_GAP[gap], className)} {...rest}>
      {title === undefined ? null : (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="flex flex-col gap-1">
            <Heading className="font-display text-2xl text-text-primary">{title}</Heading>
            {description === undefined ? null : (
              <p className="font-body text-sm text-text-secondary">{description}</p>
            )}
          </div>
          {action === undefined ? null : <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export interface PageHeaderProps {
  /** The page title — the single h1 for the page. */
  readonly title: ReactNode;
  /** Small eyebrow label above the title. */
  readonly eyebrow?: ReactNode;
  /** Supporting line under the title. */
  readonly description?: ReactNode;
  /** Primary/secondary actions aligned to the end on wide viewports. */
  readonly actions?: ReactNode;
  readonly className?: string;
}

/**
 * The header block at the top of a page: title, optional eyebrow and description, and
 * actions. On a phone the actions wrap below the title; from `sm` up they sit on the same
 * row, end-aligned. The title is an `h1` — a page has exactly one, and this owns it.
 */
export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        {eyebrow === undefined ? null : (
          <p className="font-body text-sm font-bold tracking-wide text-accent uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-3xl text-text-primary sm:text-4xl">{title}</h1>
        {description === undefined ? null : (
          <p className="max-w-2xl font-body text-text-secondary">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}
