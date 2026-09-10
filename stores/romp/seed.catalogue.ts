import { defineCatalogueSeed } from '@romp/store-config';

/**
 * ROMP's opening catalogue.
 *
 * Written by `pnpm seed`, then managed in admin. Re-running the seed is safe: every
 * document ID here is derived from a natural key — the product slug, the variant SKU
 * — so a second run updates the same documents instead of creating a second copy.
 *
 * Two rules for editing this file:
 *
 *   1. **Prices are paise.** `129900` is ₹1,299.00 (ADR-0004). MRP must be at or
 *      above the selling price, and the loader enforces it.
 *   2. **Every reference must exist.** `category` is a slug from
 *      `content.categories`, `ageBand` is a value from `content.ageBands`, and every
 *      `stock` key is a code from `warehouses`. The loader checks all three and
 *      reports every mismatch in one pass.
 *
 * `media` is intentionally empty. Product photography arrives through the admin
 * upload pipeline, which re-derives content types from magic bytes and generates the
 * responsive variants; a seed that wrote Storage paths directly would produce
 * documents pointing at objects that do not exist. Until photos are uploaded, cards
 * render the storefront's placeholder — which is visibly a placeholder, not a broken
 * image.
 */
export default defineCatalogueSeed({
  products: [
    {
      slug: 'beechwood-stacking-rings',
      name: 'Beechwood stacking rings',
      description:
        'Seven graded rings on a solid beech post, finished with food-safe linseed oil. The base is weighted so it rights itself instead of toppling, which is what keeps a one-year-old trying.',
      brand: 'Kaadu',
      category: 'sensory',
      ageBand: '0-2',
      badge: 'Bestseller',
      featured: true,
      skills: ['hand–eye coordination', 'size ordering', 'pincer grip'],
      boxItems: ['Weighted beech post', '7 graded rings', 'Cotton drawstring bag'],
      safety: {
        bisCertified: true,
        bisCertNo: 'IS-9873-KDU-0114',
        bisCertExpiry: '2029-04-30',
        bpaFree: true,
        hasSmallParts: false,
      },
      variants: [
        {
          name: 'Natural oil finish',
          sku: 'KDU-STK-NAT',
          priceMinor: 89_900,
          mrpMinor: 109_900,
          options: { finish: 'natural' },
          weightGrams: 640,
          stock: { blr: 24, del: 16 },
        },
        {
          name: 'Plant-dyed rings',
          sku: 'KDU-STK-DYE',
          priceMinor: 99_900,
          mrpMinor: 119_900,
          options: { finish: 'plant-dyed' },
          weightGrams: 660,
          stock: { blr: 12, del: 6 },
        },
      ],
    },
    {
      slug: 'first-shapes-puzzle-board',
      name: 'First shapes puzzle board',
      description:
        'Six chunky shapes with deep finger holes, each sitting in a matched recess. Thick enough for small hands to grip without pinching, and the board lies flat so it works on a rug.',
      brand: 'Kaadu',
      category: 'puzzles',
      ageBand: '0-2',
      badge: null,
      featured: false,
      skills: ['shape recognition', 'problem solving'],
      boxItems: ['Puzzle board', '6 shape pieces'],
      safety: {
        bisCertified: true,
        bisCertNo: 'IS-9873-KDU-0121',
        bisCertExpiry: '2029-04-30',
        bpaFree: true,
        hasSmallParts: false,
      },
      variants: [
        {
          name: '6 shapes',
          sku: 'KDU-PZL-SHP6',
          priceMinor: 54_900,
          mrpMinor: 64_900,
          options: { pieces: '6' },
          weightGrams: 480,
          stock: { blr: 30, del: 22 },
        },
      ],
    },
    {
      slug: 'market-stall-play-set',
      name: 'Market stall play set',
      description:
        'A fold-flat wooden stall with a chalkboard sign, felt produce, a two-pan balance and a set of printed notes. Everything packs back into the stall, which is the only reason a play kitchen survives a month.',
      brand: 'Chotu Co.',
      category: 'pretend-play',
      ageBand: '3-5',
      badge: 'New',
      featured: true,
      skills: ['pretend play', 'early numeracy', 'turn taking'],
      boxItems: [
        'Fold-flat stall with chalkboard',
        '18 felt produce pieces',
        'Two-pan balance',
        'Printed note set',
      ],
      safety: {
        bisCertified: true,
        bisCertNo: 'IS-9873-CHO-0208',
        bisCertExpiry: '2028-11-30',
        bpaFree: true,
        hasSmallParts: true,
      },
      variants: [
        {
          name: 'Stall + produce',
          sku: 'CHO-MKT-BASE',
          priceMinor: 189_900,
          mrpMinor: 229_900,
          options: { bundle: 'base' },
          weightGrams: 2_400,
          stock: { blr: 10, del: 8 },
        },
        {
          name: 'Stall + produce + bakery add-on',
          sku: 'CHO-MKT-PLUS',
          priceMinor: 244_900,
          mrpMinor: 289_900,
          options: { bundle: 'plus' },
          weightGrams: 3_100,
          stock: { blr: 5, del: 3 },
        },
      ],
    },
    {
      slug: 'gear-machine-builder',
      name: 'Gear machine builder',
      description:
        'Ninety interlocking gears, cranks and plates that mount on a pegboard. The instruction card shows four machines and then stops, because the point is the fifth one they invent.',
      brand: 'Tinker Bay',
      category: 'building-stem',
      ageBand: '6-8',
      badge: null,
      featured: true,
      skills: ['mechanical reasoning', 'sequencing', 'persistence'],
      boxItems: ['Pegboard base', '90 gears and connectors', '2 hand cranks', 'Build card'],
      safety: {
        bisCertified: true,
        bisCertNo: 'IS-9873-TBY-0330',
        bisCertExpiry: '2028-06-30',
        bpaFree: true,
        hasSmallParts: true,
      },
      variants: [
        {
          name: '90 pieces',
          sku: 'TBY-GER-090',
          priceMinor: 149_900,
          mrpMinor: 179_900,
          options: { pieces: '90' },
          weightGrams: 1_250,
          stock: { blr: 18, del: 11 },
        },
        {
          name: '160 pieces',
          sku: 'TBY-GER-160',
          priceMinor: 229_900,
          mrpMinor: 274_900,
          options: { pieces: '160' },
          weightGrams: 2_050,
          stock: { blr: 7, del: 4 },
        },
        {
          name: '160 pieces + motor',
          sku: 'TBY-GER-160M',
          priceMinor: 299_900,
          mrpMinor: 349_900,
          options: { pieces: '160', motor: 'yes' },
          weightGrams: 2_300,
          // Deliberately seeded below the store's low-stock threshold of 5, so the
          // low-stock badge and the staff notification have something real to fire on
          // the first time anyone looks at the admin inventory screen.
          stock: { blr: 2, del: 1 },
        },
      ],
    },
    {
      slug: 'city-map-jigsaw-500',
      name: 'City map jigsaw, 500 pieces',
      description:
        'A hand-drawn map of a city that does not exist, with forty small jokes hidden in it. Ribbed board, matte print, and a poster of the finished image so nobody has to guess from the box.',
      brand: 'Paper Lane',
      category: 'jigsaws',
      ageBand: '9-12',
      badge: null,
      featured: false,
      skills: ['visual scanning', 'patience', 'spatial memory'],
      boxItems: ['500 pieces', 'Full-size reference poster'],
      safety: {
        bisCertified: false,
        bisCertNo: null,
        bisCertExpiry: null,
        bpaFree: true,
        hasSmallParts: true,
      },
      variants: [
        {
          name: '500 pieces',
          sku: 'PPL-JIG-500',
          priceMinor: 69_900,
          mrpMinor: 84_900,
          options: { pieces: '500' },
          weightGrams: 720,
          stock: { blr: 26, del: 19 },
        },
      ],
    },
    {
      slug: 'balance-board-outdoor',
      name: 'Curved balance board',
      description:
        'A single sheet of pressed birch with a felt underside. It is a bridge, a slide, a rocker and a shop counter, and it takes an adult standing on it without complaint.',
      brand: 'Chotu Co.',
      category: 'outdoor',
      ageBand: '3-5',
      badge: null,
      featured: false,
      skills: ['balance', 'core strength', 'open-ended play'],
      boxItems: ['Birch balance board with felt underside'],
      safety: {
        bisCertified: true,
        bisCertNo: 'IS-9873-CHO-0244',
        bisCertExpiry: '2028-11-30',
        bpaFree: true,
        hasSmallParts: false,
      },
      variants: [
        {
          name: 'Natural',
          sku: 'CHO-BAL-NAT',
          priceMinor: 279_900,
          mrpMinor: 329_900,
          options: { finish: 'natural' },
          weightGrams: 3_600,
          stock: { blr: 9, del: 0 },
        },
        {
          name: 'Charcoal felt',
          sku: 'CHO-BAL-CHR',
          priceMinor: 289_900,
          mrpMinor: 339_900,
          options: { finish: 'charcoal' },
          weightGrams: 3_600,
          // No stock anywhere: the out-of-stock path is part of the catalogue, and a
          // seed with everything in stock never exercises it.
          stock: {},
        },
      ],
    },
    {
      slug: 'why-does-it-rain-book',
      name: 'Why does it rain? — a lift-the-flap book',
      description:
        'Thirty-two board pages, sixty flaps, and answers written for a five-year-old who will ask again tomorrow. Rounded corners and a wipeable cover.',
      brand: 'Paper Lane',
      category: 'books',
      ageBand: '3-5',
      badge: null,
      featured: false,
      skills: ['early science', 'vocabulary', 'shared reading'],
      boxItems: ['Board book, 32 pages'],
      safety: {
        bisCertified: false,
        bisCertNo: null,
        bisCertExpiry: null,
        bpaFree: true,
        hasSmallParts: false,
      },
      variants: [
        {
          name: 'English',
          sku: 'PPL-BOK-RAIN-EN',
          priceMinor: 44_900,
          mrpMinor: 49_900,
          options: { language: 'English' },
          weightGrams: 420,
          stock: { blr: 40, del: 35 },
        },
        {
          name: 'Kannada',
          sku: 'PPL-BOK-RAIN-KN',
          priceMinor: 44_900,
          mrpMinor: 49_900,
          options: { language: 'Kannada' },
          weightGrams: 420,
          stock: { blr: 22, del: 4 },
        },
      ],
    },
    {
      slug: 'weaving-loom-starter',
      name: 'Lap weaving loom',
      description:
        'A beech frame, a shed stick, two shuttles and enough cotton warp for three small pieces. Comes with one project that finishes in an afternoon, because a first craft kit that takes a week never gets finished.',
      brand: 'Tinker Bay',
      category: 'wooden',
      ageBand: '9-12',
      badge: null,
      featured: false,
      skills: ['fine motor', 'pattern making', 'finishing a thing'],
      boxItems: [
        'Beech loom frame',
        'Shed stick',
        '2 shuttles',
        'Cotton warp and weft',
        'Project card',
      ],
      safety: {
        bisCertified: true,
        bisCertNo: 'IS-9873-TBY-0361',
        bisCertExpiry: '2028-06-30',
        bpaFree: true,
        hasSmallParts: true,
      },
      variants: [
        {
          name: 'Starter kit',
          sku: 'TBY-LOM-START',
          priceMinor: 119_900,
          mrpMinor: 139_900,
          options: { kit: 'starter' },
          weightGrams: 890,
          stock: { blr: 14, del: 9 },
        },
      ],
    },
    {
      slug: 'shadow-theatre-kit',
      name: 'Shadow theatre kit',
      description:
        'A folding screen, a warm LED lamp and twenty jointed puppets, plus blanks and a punch so they can add their own cast. Best in a dark room, which is the whole appeal.',
      brand: 'Chotu Co.',
      category: 'pretend-play',
      ageBand: '6-8',
      badge: null,
      // Seeded as a draft: the storefront must not show it, and rules must not serve
      // it to the public. That makes the draft-invisibility claim testable against
      // real seeded data rather than against a fixture.
      status: 'draft',
      featured: false,
      skills: ['storytelling', 'stagecraft'],
      boxItems: ['Folding screen', 'LED lamp', '20 jointed puppets', 'Blanks and punch'],
      safety: {
        bisCertified: true,
        bisCertNo: 'IS-9873-CHO-0277',
        bisCertExpiry: '2028-11-30',
        bpaFree: true,
        hasSmallParts: true,
      },
      variants: [
        {
          name: 'Full kit',
          sku: 'CHO-SHD-FULL',
          priceMinor: 199_900,
          mrpMinor: 234_900,
          options: { kit: 'full' },
          weightGrams: 1_900,
          stock: { blr: 6, del: 4 },
        },
      ],
    },
  ],
});
