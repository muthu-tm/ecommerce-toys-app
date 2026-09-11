import { defineStoreConfig } from '@romp/store-config';

/**
 * ROMP — the first store.
 *
 * Everything that makes this ROMP rather than any other toy retailer is in this file.
 * Nothing here is referenced by name from `apps/` or `packages/`.
 *
 * The palette was chosen against the contrast gate, not by eye: every text colour
 * clears WCAG AA normal text (4.5:1) on all four surfaces, and `borderStrong` and
 * `focusRing` clear the 3:1 non-text bar. `pnpm --filter @romp/store-config test`
 * re-checks that on every run.
 */
export default defineStoreConfig({
  brand: {
    id: 'romp',
    name: 'ROMP',
    legalName: 'ROMP Retail Private Limited',
    tagline: 'Toys that grow with them',
    orderPrefix: 'RMP',
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
      // Surfaces, deepest to lightest.
      surfaceDeep: '#0e0e10',
      page: '#131417',
      surface: '#161719',
      surfaceAlt: '#191a1d',

      // Acid lime on near-black: 16.61:1 for the button label.
      primary: '#d8fd4f',
      primaryOn: '#0e0e10',
      // Coral, for sale badges and secondary actions. 6.05:1 for its label.
      accent: '#ff6f5e',
      accentOn: '#3d0f08',

      // Text ramp. Worst-case ratios against the lightest surface (#191a1d):
      // 16.08, 10.17 and 5.50 — so even "muted" clears AA normal text.
      textPrimary: '#f5f6f7',
      textSecondary: '#c2c6cf',
      textMuted: '#8b919d',

      // Decorative hairline between surfaces — not contrast-gated, deliberately.
      border: '#2a2c31',
      // Interactive boundary: 3.58:1 at worst, clearing the 3:1 non-text bar.
      borderStrong: '#6b727c',
      // Focus ring reuses the primary: 14.98:1 at worst, unmissable on every surface.
      focusRing: '#d8fd4f',

      success: '#5ee9a0',
      warning: '#ffc857',
      danger: '#ff6b6b',
    },
    radii: {
      sm: '8px',
      md: '14px',
      lg: '22px',
      pill: '999px',
    },
    shadows: {
      card: '0 1px 2px rgb(0 0 0 / 0.4), 0 8px 24px rgb(0 0 0 / 0.28)',
      overlay: '0 24px 64px rgb(0 0 0 / 0.55)',
    },
    fonts: {
      display: {
        family: 'Archivo Black',
        weights: [400],
        source: 'google',
        fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      body: {
        family: 'Archivo',
        // Only the weights actually used. Each one is bytes on the LCP path.
        weights: [400, 500, 600, 700],
        source: 'google',
        fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
    motion: {
      // A toy store should feel playful. `prefers-reduced-motion` still overrides this.
      intensity: 'full',
      durationMs: 220,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  },

  locale: {
    currency: 'INR',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    // How a bare "9845021174" is read when normalising to E.164. Because a mobile
    // number is a login identifier, changing this for an existing store would orphan
    // accounts.
    defaultPhoneRegion: 'IN',
    gstRateBasisPoints: 1_800,
  },

  content: {
    home: {
      hero: {
        eyebrow: 'New this season',
        headline: 'Toys that grow with them',
        subcopy:
          'Open-ended, BIS-certified playthings picked for the stage your child is at — and the one they are heading into.',
        primaryCta: { label: 'Shop by age', href: '/age/3-5' },
        secondaryCta: { label: 'Browse everything', href: '/c/all' },
      },
      promo: {
        headline: 'Free shipping over ₹1,499',
        subcopy: 'Dispatched from Bengaluru and Delhi, usually within a day.',
        cta: { label: 'See what ships fastest', href: '/c/all' },
      },
      trustBadges: [
        { title: 'BIS certified', description: 'Every toy carries a current BIS mark.' },
        { title: 'No small parts under 3', description: 'Age ratings we actually enforce.' },
        { title: 'Easy 7-day returns', description: 'Unopened, and we arrange the pickup.' },
        { title: 'Real humans on WhatsApp', description: 'Mon–Sat, and usually within the hour.' },
      ],
      ageSectionTitle: 'Find it by age',
      featuredTitle: 'Loved this week',
      categorySectionTitle: 'Shop by kind of play',
    },

    product: {
      breadcrumbHome: 'Home',
      addToCart: 'Add to bag',
      outOfStock: 'Out of stock',
      selectVariant: 'Choose an option',
      inTheBoxTitle: 'In the box',
      skillsTitle: 'Skills it builds',
      safetyTitle: 'Safety',
      smallPartsWarning: 'Contains small parts. Not suitable for children under 3.',
      bisCertifiedLabel: 'BIS certified',
      bpaFreeLabel: 'BPA-free',
      ratingCountLabel: '{count} reviews',
      reviews: {
        title: 'Reviews',
        countLabel: '{count} reviews',
        emptyLabel: 'No reviews yet. Be the first to share how it played.',
        verifiedLabel: 'Verified purchase',
        writeCta: 'Write a review',
        signInPrompt: 'Sign in to write a review.',
        ratingLabel: 'Your rating',
        titleLabel: 'Title',
        bodyLabel: 'Your review',
        submitLabel: 'Post review',
        pendingNotice: 'Thanks! Your review is with our team and will appear once approved.',
      },
    },

    // The age taxonomy itself, not a hardcoded union.
    ageBands: [
      { value: '0-2', label: '0–2 years', note: 'Grasp, stack, mouth-safe' },
      { value: '3-5', label: '3–5 years', note: 'Pretend play and first puzzles' },
      { value: '6-8', label: '6–8 years', note: 'Building, rules, making things' },
      { value: '9-12', label: '9–12 years', note: 'Models, logic and real skills' },
    ],

    categories: [
      {
        name: 'Wooden toys',
        slug: 'wooden',
        active: true,
        showInFilters: true,
        showInNav: true,
        sortOrder: 10,
      },
      {
        name: 'Puzzles',
        slug: 'puzzles',
        active: true,
        showInFilters: true,
        showInNav: true,
        sortOrder: 20,
      },
      {
        name: 'Building & STEM',
        slug: 'building-stem',
        active: true,
        showInFilters: true,
        showInNav: true,
        sortOrder: 30,
      },
      {
        name: 'Pretend play',
        slug: 'pretend-play',
        active: true,
        showInFilters: true,
        showInNav: true,
        sortOrder: 40,
      },
      {
        name: 'Outdoor',
        slug: 'outdoor',
        active: true,
        showInFilters: true,
        showInNav: true,
        sortOrder: 50,
      },
      {
        name: 'Books',
        slug: 'books',
        active: true,
        showInFilters: true,
        showInNav: false,
        sortOrder: 60,
      },
      {
        name: 'Sensory',
        slug: 'sensory',
        parent: 'wooden',
        active: true,
        showInFilters: true,
        showInNav: false,
        sortOrder: 11,
      },
      {
        name: 'Jigsaws',
        slug: 'jigsaws',
        parent: 'puzzles',
        active: true,
        showInFilters: true,
        showInNav: false,
        sortOrder: 21,
      },
    ],

    footer: {
      columns: [
        {
          title: 'Shop',
          links: [
            { label: 'All toys', href: '/c/all' },
            { label: 'Wooden toys', href: '/c/wooden' },
            { label: 'Puzzles', href: '/c/puzzles' },
            { label: 'Building & STEM', href: '/c/building-stem' },
          ],
        },
        {
          title: 'Help',
          links: [
            { label: 'Track an order', href: '/account/orders' },
            { label: 'Returns', href: '/policies/returns' },
            { label: 'Shipping', href: '/policies/shipping' },
            // Not "Chat on WhatsApp": the footer already renders a direct chat button, and
            // two controls with the same label doing different things is a UX trap.
            { label: 'Support & contact', href: '/support' },
          ],
        },
        {
          title: 'About',
          links: [
            { label: 'Our safety standard', href: '/policies/safety' },
            { label: 'Privacy', href: '/policies/privacy' },
            { label: 'Terms', href: '/policies/terms' },
          ],
        },
      ],
      legalLine: '© ROMP Retail Private Limited. GSTIN on request. All prices include GST.',
    },

    policies: {
      returns:
        'Unopened items can be returned within 7 days of delivery. We arrange the pickup at no cost. Opened items are returnable only if faulty.',
      shipping:
        'Dispatched from the nearest stocked warehouse, usually within one working day. Free over ₹1,499; ₹149 for express where available.',
      privacy:
        'We store only what an order needs: your name, contact number, delivery address and order history. We never send marketing email — we do not have an email channel at all.',
      terms:
        'By placing an order you confirm the details are accurate. Payment is by UPI and is verified by our team before dispatch.',
    },

    notifications: {
      order_placed: {
        title: 'Order {orderRef} placed',
        body: 'Pay {amount} with the UPI QR on the order page, then submit the reference so we can verify it.',
      },
      new_order: {
        title: 'New order {orderRef}',
        body: '{amount}. Awaiting payment.',
      },
      payment_under_review: {
        title: 'Checking your payment',
        body: 'We have your reference for {orderRef} and are matching it against our account. Usually within a few hours.',
      },
      payment_proof_submitted: {
        title: 'Payment proof for {orderRef}',
        body: 'A reference has been submitted and is waiting for verification.',
      },
      payment_verified: {
        title: 'Payment confirmed',
        body: 'We have matched your payment for {orderRef}. It is going to be packed next.',
      },
      payment_rejected: {
        title: 'We could not match your payment',
        body: 'The reference for {orderRef} did not match a payment we received. Check it and submit again — your items are still held.',
      },
      order_expired: {
        title: 'Order {orderRef} expired',
        body: 'We held your items but did not receive a payment in time. Nothing was charged — place the order again whenever you are ready.',
      },
      order_packed: {
        title: 'Packed and ready',
        body: 'Order {orderRef} is packed and waiting for the courier.',
      },
      order_shipped: {
        title: 'On its way',
        body: 'Order {orderRef} shipped with {carrier}. Tracking: {trackingNo}.',
      },
      order_delivered: {
        title: 'Delivered',
        body: 'Order {orderRef} has been delivered. Tell us how it went — a review helps other parents.',
      },
      order_cancelled: {
        title: 'Order {orderRef} cancelled',
        body: 'This order has been cancelled. Any payment received is being refunded.',
      },
      refund_issued: {
        title: 'Refund sent',
        body: '{amount} for order {orderRef} has been transferred back to you.',
      },
      review_pending: {
        title: 'A review needs moderation',
        body: 'A new review is waiting to be approved.',
      },
      review_published: {
        title: 'Your review is live',
        body: 'Thanks for writing it — other parents can see it now.',
      },
      low_stock: {
        title: 'Low stock: {sku}',
        body: 'Only a few units left. Restock before it sells out.',
      },
      out_of_stock: {
        title: 'Out of stock: {sku}',
        body: 'This variant is no longer available to buy.',
      },
      sweeper_anomaly: {
        title: 'Reservation sweeper anomaly',
        body: 'The sweeper reported something it could not resolve. Check the runbook.',
      },
      password_changed: {
        title: 'Your password was changed',
        body: 'If this was not you, contact us on WhatsApp straight away — every other session has been signed out.',
      },
      address_added: {
        title: 'A new address was saved',
        body: 'The delivery address "{addressLabel}" was added to your account. If this was not you, let us know.',
      },
    },

    emptyStates: {
      noResults: {
        title: 'Nothing matched',
        body: 'Try a broader age range, or clear a filter or two.',
      },
      emptyCart: { title: 'Your bag is empty', body: 'Start with what suits their age.' },
      emptyWishlist: {
        title: 'No saved toys yet',
        body: 'Tap the heart on anything you want to come back to.',
      },
      emptyOrders: { title: 'No orders yet', body: 'When you order, it will show up here.' },
      emptyNotifications: {
        title: 'Nothing new',
        body: 'Order updates will appear here.',
      },
    },
  },

  contact: {
    whatsappNumber: '+919845021174',
    // Written so it reads correctly with *and* without an order reference. Putting the
    // placeholder mid-sentence ("help with {orderRef}.") leaves "help with." on a general
    // enquiry, which looks like a bug to the customer.
    whatsappGreeting: 'Hi ROMP, I need some help. {orderRef}',
    supportHours: 'Mon–Sat, 10am–7pm IST',
    // Display only. The platform has no email transport (ADR-0007).
    supportEmail: 'hello@romp.example',
  },

  features: {
    reviews: true,
    wishlist: true,
    giftWrap: true,
    expressDelivery: true,
    deliveryEstimate: true,
  },

  commerce: {
    upi: {
      vpa: 'romp.store@okhdfcbank',
      payeeName: 'ROMP Retail',
    },
    // Long enough for a customer to finish a UPI transfer and find the reference,
    // short enough that unpaid orders do not sit on stock.
    reservationTtlMinutes: 30,
    giftWrapFeeMinor: 9_900,
    expressFeeMinor: 14_900,
    standardShippingFeeMinor: 5_900,
    freeShippingThresholdMinor: 149_900,
    lowStockThreshold: 5,
    maxQtyPerLine: 20,
  },

  warehouses: [
    {
      code: 'blr',
      name: 'Bengaluru hub',
      city: 'Bengaluru',
      pincode: '560001',
      priority: 10,
      active: true,
      servicePincodePrefixes: ['56', '57', '58', '59', '60', '61', '62', '68'],
    },
    {
      code: 'del',
      name: 'Delhi NCR hub',
      city: 'New Delhi',
      pincode: '110001',
      priority: 20,
      active: true,
      servicePincodePrefixes: ['11', '12', '13', '20', '21', '22', '24', '30'],
    },
  ],
});
