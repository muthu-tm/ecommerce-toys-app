import { defineStoreConfig } from '@romp/store-config';

/**
 * Store scaffold, copied by `pnpm store:new <id>`.
 *
 * This is **deliberately a valid, working store**, not a file full of `TODO`s: a new
 * store should render on the first `pnpm dev`, so the author can rebrand against
 * something they can see rather than against a stack of validation errors.
 *
 * It is also deliberately a **light theme with different fonts, copy, age bands and
 * warehouses** from ROMP. That is what makes it useful as the second config in CI:
 * a component that only renders correctly against ROMP's dark palette, or a token
 * emitter that assumed a dark theme, fails here. The contrast gate runs over this
 * palette on every test run too, so the two themes prove the gate is not tuned to one.
 *
 * After `pnpm store:new`:
 *   1. Replace every value below.
 *   2. Replace `assets/` with real artwork.
 *   3. `STORE_ID=<id> pnpm --filter @romp/store-config test`
 *   4. `STORE_ID=<id> pnpm dev`
 */
export default defineStoreConfig({
  brand: {
    // Replaced by `pnpm store:new` with the directory name.
    id: '_template',
    name: 'Example Store',
    legalName: 'Example Store Private Limited',
    tagline: 'Replace this tagline',
    orderPrefix: 'EXA',
    logos: {
      dark: 'assets/logo-dark.svg',
      light: 'assets/logo-light.svg',
      mark: 'assets/mark.svg',
      favicon: 'assets/favicon.svg',
    },
    ogFallback: 'assets/og-fallback.png',
  },

  theme: {
    // A light theme by default, where ROMP is dark — and a dark counterpart in `modes`,
    // so the both-store CI matrix exercises light-default AND dark-default, and both of a
    // dual-palette store's themes. Every value in every palette clears the same contrast gate.
    colors: {
      page: '#ffffff',
      surface: '#f7f8fa',
      surfaceAlt: '#eef0f4',
      surfaceDeep: '#e8eaef',
      surfaceElevated: '#ffffff',

      primary: '#5b3df5',
      primaryOn: '#ffffff',
      accent: '#b91c1c',
      accentOn: '#ffffff',

      // Worst-case ratios against the darkest surface: 15.69, 8.24, 5.22.
      textPrimary: '#101114',
      textSecondary: '#3f434c',
      textMuted: '#5a6070',

      border: '#dfe3ea',
      borderStrong: '#7c8290',
      focusRing: '#5b3df5',

      success: '#0f766e',
      warning: '#7f5307',
      danger: '#b3261e',
    },

    // Light is this store's default; dark is the counterpart the toggle switches to.
    defaultMode: 'light',
    modes: {
      light: {
        page: '#ffffff',
        surface: '#f7f8fa',
        surfaceAlt: '#eef0f4',
        surfaceDeep: '#e8eaef',
        surfaceElevated: '#ffffff',
        primary: '#5b3df5',
        primaryOn: '#ffffff',
        accent: '#b91c1c',
        accentOn: '#ffffff',
        textPrimary: '#101114',
        textSecondary: '#3f434c',
        textMuted: '#5a6070',
        border: '#dfe3ea',
        borderStrong: '#7c8290',
        focusRing: '#5b3df5',
        success: '#0f766e',
        warning: '#7f5307',
        danger: '#b3261e',
      },
      dark: {
        surfaceDeep: '#0b0d12',
        page: '#111319',
        surface: '#161922',
        surfaceAlt: '#1b1f29',
        surfaceElevated: '#20242f',
        primary: '#a99bff',
        primaryOn: '#12101f',
        accent: '#ff8a8a',
        accentOn: '#3a0d0d',
        textPrimary: '#f4f5f8',
        textSecondary: '#c3c8d4',
        textMuted: '#8990a0',
        border: '#2a2f3b',
        borderStrong: '#727a8b',
        focusRing: '#a99bff',
        success: '#4fd6a3',
        warning: '#ffc857',
        danger: '#ff8a8a',
      },
    },
    radii: {
      sm: '6px',
      md: '10px',
      lg: '16px',
      pill: '999px',
    },
    shadows: {
      card: '0 1px 2px rgb(16 17 20 / 0.06), 0 4px 16px rgb(16 17 20 / 0.08)',
      overlay: '0 20px 48px rgb(16 17 20 / 0.18)',
    },
    fonts: {
      // Different families from ROMP, so a hardcoded font name fails the CI matrix.
      display: {
        family: 'Fraunces',
        weights: [600, 900],
        source: 'google',
        fallback: ['ui-serif', 'Georgia', 'serif'],
      },
      body: {
        family: 'Inter',
        weights: [400, 500, 700],
        source: 'google',
        fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
    motion: {
      // Also different: proves motion intensity actually reaches the emitted tokens.
      intensity: 'subtle',
      durationMs: 180,
      easing: 'ease-out',
    },
  },

  locale: {
    currency: 'INR',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    defaultPhoneRegion: 'IN',
    gstRateBasisPoints: 1_200,
  },

  content: {
    home: {
      hero: {
        eyebrow: 'Replace this eyebrow',
        headline: 'Replace this headline',
        subcopy: 'Replace this supporting sentence with something about your store.',
        primaryCta: { label: 'Shop by age', href: '/age/2-4' },
        secondaryCta: { label: 'Browse everything', href: '/c/all' },
      },
      promo: {
        headline: 'Replace this promotion',
        subcopy: 'Replace this promotional detail.',
        cta: { label: 'See more', href: '/c/all' },
      },
      trustBadges: [
        { title: 'Replace badge one', description: 'Replace this description.' },
        { title: 'Replace badge two', description: 'Replace this description.' },
      ],
      ageSectionTitle: 'Shop by age',
      featuredTitle: 'Featured',
      categorySectionTitle: 'Categories',
    },

    product: {
      breadcrumbHome: 'Home',
      addToCart: 'Add to cart',
      outOfStock: 'Sold out',
      selectVariant: 'Select an option',
      inTheBoxTitle: "What's included",
      skillsTitle: 'Highlights',
      safetyTitle: 'Safety & compliance',
      smallPartsWarning: 'Contains small parts. Keep away from young children.',
      bisCertifiedLabel: 'Certified',
      bpaFreeLabel: 'BPA-free',
      ratingCountLabel: '{count} ratings',
      reviews: {
        title: 'Ratings & reviews',
        countLabel: '{count} ratings',
        emptyLabel: 'No reviews yet.',
        verifiedLabel: 'Verified buyer',
        writeCta: 'Write a review',
        signInPrompt: 'Sign in to leave a review.',
        ratingLabel: 'Rating',
        titleLabel: 'Headline',
        bodyLabel: 'Review',
        submitLabel: 'Submit',
        pendingNotice: 'Thank you. Your review will be published after review.',
      },
    },

    // Different bands from ROMP, so nothing can assume ROMP's taxonomy.
    ageBands: [
      { value: '0-1', label: '0–1 year', note: 'Replace this note' },
      { value: '2-4', label: '2–4 years', note: 'Replace this note' },
      { value: '5-7', label: '5–7 years', note: 'Replace this note' },
    ],

    categories: [
      {
        name: 'Category one',
        slug: 'category-one',
        active: true,
        showInFilters: true,
        showInNav: true,
        sortOrder: 10,
      },
      {
        name: 'Category two',
        slug: 'category-two',
        active: true,
        showInFilters: true,
        showInNav: true,
        sortOrder: 20,
      },
      {
        name: 'Sub of one',
        slug: 'sub-of-one',
        parent: 'category-one',
        active: true,
        showInFilters: true,
        showInNav: false,
        sortOrder: 11,
      },
    ],

    footer: {
      columns: [
        {
          title: 'Shop',
          links: [
            { label: 'All products', href: '/c/all' },
            { label: 'Category one', href: '/c/category-one' },
          ],
        },
        {
          title: 'Help',
          links: [
            { label: 'Track an order', href: '/account/orders' },
            { label: 'Returns', href: '/policies/returns' },
          ],
        },
      ],
      legalLine: '© Example Store Private Limited. Replace this legal line.',
    },

    policies: {
      returns: 'Replace this returns policy.',
      shipping: 'Replace this shipping policy.',
      privacy: 'Replace this privacy notice.',
      terms: 'Replace these terms.',
    },

    notifications: {
      order_placed: {
        title: 'Order {orderRef} placed',
        body: 'Pay {amount} using the UPI QR on the order page, then submit the reference.',
      },
      new_order: { title: 'New order {orderRef}', body: '{amount}. Awaiting payment.' },
      payment_under_review: {
        title: 'Checking your payment',
        body: 'We are matching the reference for {orderRef} against our account.',
      },
      payment_proof_submitted: {
        title: 'Payment proof for {orderRef}',
        body: 'A reference is waiting for verification.',
      },
      payment_verified: {
        title: 'Payment confirmed',
        body: 'We matched your payment for {orderRef}.',
      },
      payment_rejected: {
        title: 'We could not match your payment',
        body: 'The reference for {orderRef} did not match. Check it and submit again.',
      },
      order_expired: {
        title: 'Order {orderRef} expired',
        body: 'No payment arrived in time. Nothing was charged.',
      },
      order_packed: { title: 'Packed', body: 'Order {orderRef} is packed.' },
      order_shipped: {
        title: 'On its way',
        body: 'Order {orderRef} shipped with {carrier}. Tracking: {trackingNo}.',
      },
      order_delivered: { title: 'Delivered', body: 'Order {orderRef} has been delivered.' },
      order_cancelled: { title: 'Order {orderRef} cancelled', body: 'This order was cancelled.' },
      refund_issued: { title: 'Refund sent', body: '{amount} for {orderRef} has been refunded.' },
      review_pending: {
        title: 'A review needs moderation',
        body: 'A review is awaiting approval.',
      },
      review_published: { title: 'Your review is live', body: 'Thanks for writing it.' },
      low_stock: { title: 'Low stock: {sku}', body: 'Only a few units left.' },
      out_of_stock: { title: 'Out of stock: {sku}', body: 'This variant cannot be bought.' },
      sweeper_anomaly: {
        title: 'Reservation sweeper anomaly',
        body: 'The sweeper reported something unresolved. Check the runbook.',
      },
      password_changed: {
        title: 'Your password was changed',
        body: 'If this was not you, contact support — every other session has been signed out.',
      },
      address_added: {
        title: 'A new address was saved',
        body: 'The address "{addressLabel}" was added to your account.',
      },
    },

    emptyStates: {
      noResults: { title: 'Nothing matched', body: 'Try clearing a filter.' },
      emptyCart: { title: 'Your bag is empty', body: 'Add something to get started.' },
      emptyWishlist: { title: 'Nothing saved yet', body: 'Tap a heart to save it.' },
      emptyOrders: { title: 'No orders yet', body: 'Your orders will appear here.' },
      emptyNotifications: { title: 'Nothing new', body: 'Updates will appear here.' },
    },
  },

  contact: {
    whatsappNumber: '+910000000000',
    // Placeholder goes last, so the message reads correctly whether or not an order
    // reference is in context. "help with {orderRef}." leaves "help with." otherwise.
    whatsappGreeting: 'Hi, I need some help. {orderRef}',
    supportHours: 'Replace with your support hours',
  },

  features: {
    // Deliberately not all true, so a component that assumes a feature is on fails.
    reviews: true,
    wishlist: false,
    giftWrap: false,
    expressDelivery: false,
    deliveryEstimate: true,
  },

  commerce: {
    upi: {
      vpa: 'example@okaxis',
      payeeName: 'Example Store',
    },
    reservationTtlMinutes: 45,
    giftWrapFeeMinor: 0,
    expressFeeMinor: 0,
    standardShippingFeeMinor: 4_900,
    freeShippingThresholdMinor: 99_900,
    lowStockThreshold: 3,
    maxQtyPerLine: 10,
  },

  // A single warehouse, where ROMP has two — so nothing may assume a count.
  warehouses: [
    {
      code: 'main',
      name: 'Main warehouse',
      city: 'Replace city',
      pincode: '400001',
      priority: 10,
      active: true,
      servicePincodePrefixes: ['4'],
    },
  ],
});
