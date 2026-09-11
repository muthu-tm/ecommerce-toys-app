import { describe, expect, it } from 'vitest';

import { ContrastError } from './contrast';
import { StoreConfigError, resolveStoreId, validateStoreConfig } from './loader';

/**
 * A minimal valid config, used as the baseline for mutation.
 *
 * Built from the shipped ROMP values so it stays realistic, but declared here rather
 * than imported so a change to ROMP's copy does not ripple through these tests.
 */
function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const notification = { title: 'Title {orderRef}', body: 'Body {orderRef}' };
  const notificationTypes = [
    'order_placed',
    'new_order',
    'payment_under_review',
    'payment_proof_submitted',
    'payment_verified',
    'payment_rejected',
    'order_expired',
    'order_packed',
    'order_shipped',
    'order_delivered',
    'order_cancelled',
    'refund_issued',
    'review_pending',
    'review_published',
    'low_stock',
    'out_of_stock',
    'sweeper_anomaly',
    'password_changed',
    'address_added',
  ];

  return {
    brand: {
      id: 'fixture',
      name: 'Fixture',
      legalName: 'Fixture Private Limited',
      tagline: 'A tagline',
      orderPrefix: 'FIX',
      logos: {
        dark: 'assets/logo-dark.svg',
        light: 'assets/logo-light.svg',
        mark: 'assets/mark.svg',
        favicon: 'assets/favicon.svg',
      },
      ogFallback: 'assets/og-fallback.png',
    },
    theme: {
      colors: {
        page: '#131417',
        surface: '#161719',
        surfaceAlt: '#191a1d',
        surfaceDeep: '#0e0e10',
        primary: '#d8fd4f',
        primaryOn: '#0e0e10',
        accent: '#ff6f5e',
        accentOn: '#3d0f08',
        textPrimary: '#f5f6f7',
        textSecondary: '#c2c6cf',
        textMuted: '#8b919d',
        border: '#2a2c31',
        borderStrong: '#6b727c',
        focusRing: '#d8fd4f',
        success: '#5ee9a0',
        warning: '#ffc857',
        danger: '#ff6b6b',
      },
      radii: { sm: '8px', md: '14px', lg: '22px', pill: '999px' },
      shadows: { card: '0 1px 2px rgb(0 0 0 / 0.4)', overlay: '0 24px 64px rgb(0 0 0 / 0.55)' },
      fonts: {
        display: {
          family: 'Archivo Black',
          weights: [400],
          source: 'google',
          fallback: ['sans-serif'],
        },
        body: { family: 'Archivo', weights: [400], source: 'google', fallback: ['sans-serif'] },
      },
      motion: { intensity: 'full', durationMs: 220, easing: 'ease-out' },
    },
    locale: {
      currency: 'INR',
      locale: 'en-IN',
      timezone: 'Asia/Kolkata',
      defaultPhoneRegion: 'IN',
      gstRateBasisPoints: 1800,
    },
    content: {
      home: {
        hero: {
          eyebrow: 'E',
          headline: 'H',
          subcopy: 'S',
          primaryCta: { label: 'A', href: '/a' },
          secondaryCta: { label: 'B', href: '/b' },
        },
        promo: { headline: 'H', subcopy: 'S', cta: { label: 'C', href: '/c' } },
        trustBadges: [{ title: 'T', description: 'D' }],
        ageSectionTitle: 'Age',
        featuredTitle: 'Featured',
        categorySectionTitle: 'Categories',
      },
      product: {
        breadcrumbHome: 'Home',
        addToCart: 'Add',
        outOfStock: 'Out',
        selectVariant: 'Choose',
        inTheBoxTitle: 'Box',
        skillsTitle: 'Skills',
        safetyTitle: 'Safety',
        smallPartsWarning: 'Small parts.',
        bisCertifiedLabel: 'Certified',
        bpaFreeLabel: 'BPA-free',
        ratingCountLabel: '{count} reviews',
        reviews: {
          title: 'Reviews',
          countLabel: '{count} reviews',
          emptyLabel: 'No reviews yet.',
          verifiedLabel: 'Verified',
          writeCta: 'Write a review',
          signInPrompt: 'Sign in to review.',
          ratingLabel: 'Rating',
          titleLabel: 'Title',
          bodyLabel: 'Review',
          submitLabel: 'Post',
          pendingNotice: 'Awaiting moderation.',
        },
      },
      ageBands: [{ value: '0-2', label: '0–2', note: 'Note' }],
      categories: [
        { name: 'One', slug: 'one', showInFilters: true, showInNav: true, sortOrder: 10 },
      ],
      footer: {
        columns: [{ title: 'Shop', links: [{ label: 'All', href: '/c/all' }] }],
        legalLine: '© Fixture',
      },
      policies: { returns: 'R', shipping: 'S', privacy: 'P', terms: 'T' },
      notifications: Object.fromEntries(notificationTypes.map((type) => [type, notification])),
      emptyStates: {
        noResults: { title: 'T', body: 'B' },
        emptyCart: { title: 'T', body: 'B' },
        emptyWishlist: { title: 'T', body: 'B' },
        emptyOrders: { title: 'T', body: 'B' },
        emptyNotifications: { title: 'T', body: 'B' },
      },
    },
    contact: {
      whatsappNumber: '+919845021174',
      whatsappGreeting: 'Hi about {orderRef}.',
      supportHours: 'Mon–Sat',
    },
    features: {
      reviews: true,
      wishlist: true,
      giftWrap: true,
      expressDelivery: true,
      deliveryEstimate: true,
    },
    commerce: {
      upi: { vpa: 'fixture@okhdfcbank', payeeName: 'Fixture' },
      reservationTtlMinutes: 30,
      giftWrapFeeMinor: 9900,
      expressFeeMinor: 14900,
      standardShippingFeeMinor: 5900,
      freeShippingThresholdMinor: 149900,
      lowStockThreshold: 5,
      maxQtyPerLine: 20,
    },
    warehouses: [
      {
        code: 'blr',
        name: 'Bengaluru',
        city: 'Bengaluru',
        pincode: '560001',
        priority: 10,
        active: true,
        servicePincodePrefixes: ['56'],
      },
    ],
    ...overrides,
  };
}

/** Asset checking is off in these tests: the fixture store has no directory on disk. */
const noAssets = { checkAssets: false } as const;

/**
 * Sets a dotted path on the fixture.
 *
 * Cheaper to read than a chain of casts at every mutation site, and it throws if the
 * path does not exist — so a test that silently stops exercising what it claims to,
 * because a field was renamed, fails instead.
 */
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const leaf = keys.pop();
  if (leaf === undefined) throw new Error('setPath needs a non-empty path');

  let node: Record<string, unknown> = target;
  for (const key of keys) {
    const next = node[key];
    if (typeof next !== 'object' || next === null) {
      throw new Error(`setPath: "${key}" is not an object in the fixture`);
    }
    node = next as Record<string, unknown>;
  }
  node[leaf] = value;
}

/** Removes a dotted path from the fixture. */
function deletePath(target: Record<string, unknown>, path: string): void {
  const keys = path.split('.');
  const leaf = keys.pop();
  if (leaf === undefined) throw new Error('deletePath needs a non-empty path');

  let node: Record<string, unknown> = target;
  for (const key of keys) {
    const next = node[key];
    if (typeof next !== 'object' || next === null) {
      throw new Error(`deletePath: "${key}" is not an object in the fixture`);
    }
    node = next as Record<string, unknown>;
  }
  if (!(leaf in node)) throw new Error(`deletePath: "${path}" is not in the fixture`);
  // Reflect rather than `delete node[leaf]`, which the dynamic-delete rule rejects.
  Reflect.deleteProperty(node, leaf);
}

describe('resolveStoreId', () => {
  it('defaults to romp so a plain `pnpm dev` works', () => {
    expect(resolveStoreId()).toBe('romp');
  });

  it('accepts an existing store', () => {
    expect(resolveStoreId('romp')).toBe('romp');
  });

  it('refuses a store that does not exist, rather than falling back', () => {
    // A typo in a deploy workflow input must not quietly ship the wrong brand.
    expect(() => resolveStoreId('nonexistent')).toThrow(/No store directory/);
  });

  it('refuses a malformed ID', () => {
    expect(() => resolveStoreId('Toybox')).toThrow(/not a valid store ID/);
    expect(() => resolveStoreId('1toybox')).toThrow(/not a valid store ID/);
  });

  it('refuses a scaffold as a deployable store', () => {
    expect(() => resolveStoreId('_template')).toThrow(/scaffold, not a deployable store/);
  });

  it('permits a scaffold when explicitly validating one', () => {
    expect(resolveStoreId('_template', { allowScaffold: true })).toBe('_template');
  });

  it('suggests store:new when the directory is missing', () => {
    expect(() => resolveStoreId('toybox')).toThrow(/pnpm store:new toybox/);
  });
});

describe('validateStoreConfig', () => {
  it('accepts a well-formed config', () => {
    const config = validateStoreConfig('fixture', validConfig(), noAssets);

    expect(config.brand.name).toBe('Fixture');
    expect(config.warehouses).toHaveLength(1);
  });

  it('reports the exact path of a missing value', () => {
    // This is what makes a failure actionable rather than a hunt.
    const broken = validConfig();
    deletePath(broken, 'brand.tagline');

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/brand\.tagline/);
  });

  it('reports a nested path', () => {
    const broken = validConfig();
    setPath(broken, 'theme.colors.primary', 'lime');

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(
      /theme\.colors\.primary/,
    );
  });

  it('refuses a config whose brand.id does not match its directory', () => {
    // A mismatch means the config being edited is not the config being built.
    expect(() => validateStoreConfig('toybox', validConfig(), noAssets)).toThrow(
      /brand\.id is "fixture" but the directory is stores\/toybox/,
    );
  });

  it('enforces the contrast gate', () => {
    const broken = validConfig();
    setPath(broken, 'theme.colors.textPrimary', '#20222a');

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(ContrastError);
  });

  it('rejects a decimal money value', () => {
    // Fees are integer paise, like every other amount (ADR-0004).
    const broken = validConfig();
    setPath(broken, 'commerce.giftWrapFeeMinor', 99.5);

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/giftWrapFeeMinor/);
  });

  it('rejects a tax rate expressed as a decimal', () => {
    const broken = validConfig();
    setPath(broken, 'locale.gstRateBasisPoints', 0.18);

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/gstRateBasisPoints/);
  });

  it('rejects an invalid timezone against the real tz database', () => {
    const broken = validConfig();
    setPath(broken, 'locale.timezone', 'Mars/Olympus');

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/timezone/);
  });

  it('rejects a store with no active warehouse', () => {
    // Otherwise no order could ever be allocated.
    const broken = validConfig();
    setPath(broken, 'warehouses.0.active', false);

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(
      /at least one warehouse/i,
    );
  });

  it('rejects duplicate warehouse codes', () => {
    const broken = validConfig();
    const warehouses = broken.warehouses as Record<string, unknown>[];
    broken.warehouses = [warehouses[0], { ...warehouses[0] }];

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/unique/);
  });

  it('rejects a category whose parent does not exist', () => {
    const broken = validConfig();
    setPath(broken, 'content.categories', [
      {
        name: 'One',
        slug: 'one',
        parent: 'ghost',
        showInFilters: true,
        showInNav: true,
        sortOrder: 1,
      },
    ]);

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/parent/);
  });

  it('rejects a category tree deeper than one level', () => {
    // A deeper tree needs breadcrumb and navigation work v1.0 does not have, so it
    // fails here rather than rendering a category nobody can reach.
    const broken = validConfig();
    setPath(broken, 'content.categories', [
      { name: 'A', slug: 'a', showInFilters: true, showInNav: true, sortOrder: 1 },
      { name: 'B', slug: 'b', parent: 'a', showInFilters: true, showInNav: false, sortOrder: 2 },
      { name: 'C', slug: 'c', parent: 'b', showInFilters: true, showInNav: false, sortOrder: 3 },
    ]);

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/one level only/);
  });

  it('rejects duplicate age band values', () => {
    const broken = validConfig();
    setPath(broken, 'content.ageBands', [
      { value: '0-2', label: 'A', note: 'N' },
      { value: '0-2', label: 'B', note: 'N' },
    ]);

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/unique/);
  });

  it('requires copy for every notification kind', () => {
    // Adding a notification type in @romp/contracts must fail every store config
    // until its copy exists — better a failed build than a blank notification.
    const broken = validConfig();
    deletePath(broken, 'content.notifications.order_shipped');

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(
      /notifications\.order_shipped/,
    );
  });

  it('rejects a lowercase order prefix', () => {
    // The generated order number must satisfy HumanOrderIdSchema in @romp/contracts.
    const broken = validConfig();
    setPath(broken, 'brand.orderPrefix', 'rmp');

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/orderPrefix/);
  });

  it('rejects a non-E.164 WhatsApp number', () => {
    const broken = validConfig();
    setPath(broken, 'contact.whatsappNumber', '9845021174');

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/whatsappNumber/);
  });

  it('rejects a malformed UPI VPA', () => {
    const broken = validConfig();
    setPath(broken, 'commerce.upi.vpa', 'not-a-vpa');

    expect(() => validateStoreConfig('fixture', broken, noAssets)).toThrow(/vpa/);
  });

  it('bounds the reservation TTL', () => {
    // Too short loses orders mid-payment; too long parks stock all day.
    const tooShort = validConfig();
    setPath(tooShort, 'commerce.reservationTtlMinutes', 1);
    expect(() => validateStoreConfig('fixture', tooShort, noAssets)).toThrow(/reservationTtl/);

    const tooLong = validConfig();
    setPath(tooLong, 'commerce.reservationTtlMinutes', 5000);
    expect(() => validateStoreConfig('fixture', tooLong, noAssets)).toThrow(/reservationTtl/);
  });

  it('throws StoreConfigError, not a raw ZodError', () => {
    // So callers get one error type with a message an author can act on.
    expect(() => validateStoreConfig('fixture', {}, noAssets)).toThrow(StoreConfigError);
  });

  it('rejects a non-object entirely', () => {
    expect(() => validateStoreConfig('fixture', 'not a config', noAssets)).toThrow(
      StoreConfigError,
    );
    expect(() => validateStoreConfig('fixture', null, noAssets)).toThrow(StoreConfigError);
  });

  it('checks asset existence by default', () => {
    // The fixture has no directory, so the default path must complain about assets.
    expect(() => validateStoreConfig('fixture', validConfig())).toThrow(/missing asset/);
  });
});
