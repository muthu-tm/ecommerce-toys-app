import { describe, expect, it } from 'vitest';

import { CHECKOUT_SETTINGS_ID, PUBLIC_PRODUCT_STATUS, PUBLIC_REVIEW_STATUS } from '@romp/contracts';
import { COLLECTIONS, SUBCOLLECTIONS } from '@romp/data';

import { readRules } from '../helpers/emulator';

/**
 * The seam between the rules file and the TypeScript that has to agree with it.
 *
 * Security rules are their own language. They cannot import `COLLECTIONS`, so every
 * collection name and every status literal in `firestore.rules` is a hand-copied
 * string, and a rename on the TypeScript side leaves the rules file silently pointing
 * at a collection that no longer exists — which does not error. It denies access to a
 * collection nobody uses while leaving the real one covered only by the catch-all.
 *
 * These tests are the only thing standing between a rename and that outcome. They are
 * textual assertions, which is unusual and is the point: the rules file is text, and
 * text is what has to be checked.
 */

const rules = readRules('firestore.rules');
const storageRules = readRules('storage.rules');

/** Collections whose access is granted through a wildcard subtree match. */
const WILDCARD_MATCHED = new Set<string>([COLLECTIONS.analytics]);

describe('every collection has a rule', () => {
  for (const collection of Object.values(COLLECTIONS)) {
    it(`firestore.rules has a match block for ${collection}`, () => {
      // A collection with no block of its own falls to the catch-all, which denies
      // everything — so the storefront breaks rather than leaks. That is the safe
      // direction, but it is still a bug, and it is one that only shows up on the page
      // that needed the read.
      const pattern = WILDCARD_MATCHED.has(collection)
        ? new RegExp(`match /${collection}/\\{document=\\*\\*\\}`)
        : new RegExp(`match /${collection}/\\{[A-Za-z]+\\}`);

      expect(rules).toMatch(pattern);
    });
  }

  it('has a match block for every subcollection', () => {
    expect(rules).toMatch(new RegExp(`match /${SUBCOLLECTIONS.variants}/\\{[A-Za-z]+\\}`));
    expect(rules).toMatch(new RegExp(`match /${SUBCOLLECTIONS.addresses}/\\{[A-Za-z]+\\}`));
    expect(rules).toMatch(new RegExp(`match /${SUBCOLLECTIONS.wishlist}/\\{[A-Za-z]+\\}`));
    // `orders/{id}/events` shares its name with the store-wide spine; both are matched,
    // in different scopes, with different audiences.
    expect(rules).toMatch(new RegExp(`match /${SUBCOLLECTIONS.orderEvents}/\\{[A-Za-z]+\\}`));
  });

  it('ends with a catch-all deny', () => {
    // Behaviourally redundant — Firestore denies an unmatched path already — but it
    // means the next collection someone adds is refused by a statement they have to
    // walk past rather than by an absence they never considered.
    expect(rules).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });
});

describe('status literals agree with the contracts', () => {
  it('gates public product reads on the status the storefront queries', () => {
    // If these drift, the catalogue either goes dark or exposes drafts, depending on
    // which side changed.
    expect(PUBLIC_PRODUCT_STATUS).toBe('active');
    expect(rules).toContain(`resource.data.status == '${PUBLIC_PRODUCT_STATUS}'`);
  });

  it('gates public review reads on the published status', () => {
    expect(PUBLIC_REVIEW_STATUS).toBe('published');
    expect(rules).toContain(`resource.data.status == '${PUBLIC_REVIEW_STATUS}'`);
  });

  it('names the one publicly readable settings document', () => {
    expect(rules).toContain(`settingsId == '${CHECKOUT_SETTINGS_ID}'`);
  });
});

describe('the client write surface is what the docs claim', () => {
  it('permits exactly two update rules, both on notifications', () => {
    // `DATA_MODEL.md § client write surface` and `SECURITY.md § write matrix` both state
    // that the client write surface is notification read state and nothing else. This is
    // the assertion that keeps that claim true: counting the `allow update` statements
    // in the file catches a third one being added anywhere.
    const updateRules = rules.match(/allow update:/g) ?? [];

    expect(updateRules).toHaveLength(2);
  });

  it('grants no create or set permission to any client', () => {
    // Every `allow create` in the file must be a denial.
    const createRules = rules.match(/allow create[^;]*;/g) ?? [];

    for (const rule of createRules) {
      expect(rule).toContain('if false');
    }
  });

  it('grants no delete permission to any client', () => {
    const deleteRules = rules.match(/allow delete[^;]*;/g) ?? [];

    for (const rule of deleteRules) {
      expect(rule).toContain('if false');
    }
  });

  it('holds each notification update to a single field', () => {
    expect(rules).toContain("onlyChanged(['readAt'])");
    expect(rules).toContain("onlyChanged(['readBy'])");
  });

  it('pins the read timestamp to server time in both cases', () => {
    // Without this a client chooses when it read something, which makes the field a
    // claim rather than a fact.
    expect(rules).toContain('request.resource.data.readAt == request.time');
    expect(rules).toContain('request.resource.data.readBy[uid()] == request.time');
  });

  it('scopes the staff read-state write to the caller own key', () => {
    // The nested diff. Without it, one admin can mark a notification read for another
    // and hide work from the person it was meant for.
    expect(rules).toContain('affectedKeys().hasOnly([uid()])');
  });
});

describe('roles come from custom claims, never from a document', () => {
  it('reads the role from the auth token', () => {
    expect(rules).toContain("request.auth.token.get('role', '')");
  });

  it('never calls get() on a users document to decide a role', () => {
    // A role stored where a client can write is a role a client can grant itself, and
    // one stored where a client can read still costs a document read per evaluation.
    expect(rules).not.toMatch(/get\([^)]*documents\/users\//);
  });

  it('treats staff as an allowlist of two roles', () => {
    expect(rules).toContain("role() == 'staff' || role() == 'owner'");
  });
});

describe('storage rules', () => {
  it('bounds every upload by size', () => {
    expect(storageRules).toContain('request.resource.size <= 5 * 1024 * 1024');
  });

  it('excludes SVG from the allowed image types', () => {
    // SVG is a script container, and these files render on the admin origin.
    expect(storageRules).toContain('image/(jpeg|png|webp|avif)');
    expect(storageRules).not.toContain('image/svg');
  });

  it('never allows a payment proof to be deleted', () => {
    // It is the evidence behind a verification decision.
    expect(storageRules).toMatch(/allow delete: if false;/);
  });

  it('ends with a catch-all deny', () => {
    expect(storageRules).toMatch(/match \/\{allPaths=\*\*\} \{\s*allow read, write: if false;/);
  });
});
