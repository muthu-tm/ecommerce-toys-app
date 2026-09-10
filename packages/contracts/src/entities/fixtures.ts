/**
 * Valid document fixtures, and overridable builders for them.
 *
 * Reached at `@romp/contracts/fixtures`, deliberately **not** re-exported from the
 * package barrel — this module exists for tests, and a barrel export would put
 * sample product copy in the storefront bundle.
 *
 * Why these live in the contracts package rather than in each consumer's tests:
 * every document schema here carries cross-field refinements, so a fixture is not
 * a two-line literal. Repeated per package, they drift, and the drift shows up as
 * a repository test that passes against a document the real schema would reject.
 * One set of known-valid documents, maintained beside the schemas that define
 * them, is the only version that cannot lie.
 *
 * Each builder takes a partial override and merges it **shallowly**, so a test
 * that wants one invalid field spells out only that field. Nested objects are
 * replaced wholesale rather than deep-merged: a half-overridden `payment` map
 * would silently keep fields the test thought it had removed.
 */
import { AgeBandSchema } from '../domain/product';
import { RatingSchema } from '../domain/review';
import { basisPoints } from '../primitives/basis-points';
import {
  E164PhoneSchema,
  EmailSchema,
  HumanOrderIdSchema,
  PincodeSchema,
  SkuSchema,
  SlugSchema,
  UpiVpaSchema,
  UtrSchema,
} from '../primitives/identifiers';
import {
  CategoryIdSchema,
  EventIdSchema,
  OrderIdSchema,
  ProductIdSchema,
  ReservationIdSchema,
  UidSchema,
  VariantIdSchema,
  WarehouseIdSchema,
} from '../primitives/ids';
import { money } from '../primitives/money';

import type { CartDoc } from './cart';
import type { PostalAddress } from './common';
import type { InventoryDoc, InventoryLedgerDoc, ReservationDoc, WarehouseDoc } from './inventory';
import type { NotificationDoc } from './notification';
import type { CounterDoc, OrderDoc, OrderEventDoc, PaymentRefGuardDoc } from './order';
import type { CategoryDoc, ProductDoc, VariantDoc } from './product';
import type { RefundDoc } from './refund';
import type { ReviewDoc } from './review';
import type { CheckoutSettingsDoc, DailyAnalyticsDoc } from './settings';
import type { AddressDoc, IdentityIndexDoc, UserDoc, WishlistItemDoc } from './user';

/**
 * A fixed instant, so a fixture is byte-identical between runs.
 *
 * `Date.now()` in a fixture makes an assertion about a timestamp either untestable
 * or flaky, and it makes a snapshot useless.
 */
export const FIXTURE_NOW = new Date('2026-03-01T09:30:00.000Z');
export const FIXTURE_LATER = new Date('2026-03-01T10:00:00.000Z');

const uid = (value = 'customer-uid-0001') => UidSchema.parse(value);
const staffUid = () => UidSchema.parse('staff-uid-0001');

export const aWarehouse = (overrides: Partial<WarehouseDoc> = {}): WarehouseDoc => ({
  code: WarehouseIdSchema.parse('blr'),
  name: 'Bengaluru hub',
  city: 'Bengaluru',
  pincode: PincodeSchema.parse('560001'),
  priority: 0,
  active: true,
  servicePincodePrefixes: ['56', '57'],
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  ...overrides,
});

export const aCategory = (overrides: Partial<CategoryDoc> = {}): CategoryDoc => ({
  name: 'Building sets',
  slug: SlugSchema.parse('building-sets'),
  parentId: null,
  active: true,
  showInFilters: true,
  showInNav: true,
  productCount: 1,
  sortOrder: 0,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  ...overrides,
});

export const aVariant = (overrides: Partial<VariantDoc> = {}): VariantDoc => ({
  productId: ProductIdSchema.parse('wooden-blocks'),
  name: '6–8 yrs · 240 pcs',
  sku: SkuSchema.parse('WB-240'),
  priceMinor: money(129_900),
  mrpMinor: money(149_900),
  options: { ageBand: '6-8', finish: 'natural' },
  active: true,
  weightGrams: 1_400,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  ...overrides,
});

export const aProduct = (overrides: Partial<ProductDoc> = {}): ProductDoc => ({
  slug: SlugSchema.parse('wooden-blocks'),
  name: 'Wooden building blocks',
  description: 'A 240-piece set of sanded beechwood blocks in six shapes.',
  brand: 'Woodwise',
  categoryId: CategoryIdSchema.parse('building-sets'),
  categorySlug: SlugSchema.parse('building-sets'),
  ageBand: AgeBandSchema.parse('6-8'),
  status: 'active',
  badge: null,
  priceFromMinor: money(129_900),
  mrpFromMinor: money(149_900),
  variantSummary: [
    {
      variantId: VariantIdSchema.parse('WB-240'),
      name: '6–8 yrs · 240 pcs',
      sku: SkuSchema.parse('WB-240'),
      priceMinor: money(129_900),
      mrpMinor: money(149_900),
      active: true,
      inStock: true,
    },
  ],
  media: [
    {
      path: 'products/wooden-blocks/cover.webp',
      alt: 'A tower of beechwood blocks on a pale rug',
      width: 1_200,
      height: 1_200,
      blurhash: null,
      order: 0,
    },
  ],
  skills: ['spatial reasoning', 'fine motor'],
  boxItems: ['240 blocks', 'Cotton storage bag'],
  safety: {
    bisCertified: true,
    bisCertNo: 'BIS-9911-2025',
    bisCertExpiry: new Date('2028-01-01T00:00:00.000Z'),
    bpaFree: true,
    hasSmallParts: false,
  },
  ratingAvg: 4.6,
  ratingCount: 18,
  searchTokens: ['woo', 'wood', 'wooden', 'blo', 'block', 'blocks'],
  seo: { title: null, description: null, index: true },
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  publishedAt: FIXTURE_NOW,
  ...overrides,
});

export const anInventoryRecord = (overrides: Partial<InventoryDoc> = {}): InventoryDoc => ({
  productId: ProductIdSchema.parse('wooden-blocks'),
  stock: { [WarehouseIdSchema.parse('blr')]: 12, [WarehouseIdSchema.parse('del')]: 8 },
  onHandTotal: 20,
  reserved: 3,
  lowStockThreshold: 5,
  updatedAt: FIXTURE_NOW,
  ...overrides,
});

export const aLedgerEntry = (overrides: Partial<InventoryLedgerDoc> = {}): InventoryLedgerDoc => ({
  variantId: VariantIdSchema.parse('WB-240'),
  productId: ProductIdSchema.parse('wooden-blocks'),
  warehouseId: WarehouseIdSchema.parse('blr'),
  delta: 12,
  reason: 'seed',
  actorId: 'system',
  refId: null,
  note: null,
  at: FIXTURE_NOW,
  ...overrides,
});

export const aReservation = (overrides: Partial<ReservationDoc> = {}): ReservationDoc => ({
  orderId: OrderIdSchema.parse('order-0001'),
  items: [
    {
      variantId: VariantIdSchema.parse('WB-240'),
      qty: 2,
      allocation: { [WarehouseIdSchema.parse('blr')]: 2 },
    },
  ],
  status: 'active',
  expiresAt: FIXTURE_LATER,
  createdAt: FIXTURE_NOW,
  resolvedAt: null,
  ...overrides,
});

export const aUser = (overrides: Partial<UserDoc> = {}): UserDoc => ({
  displayName: 'Asha Menon',
  primaryIdentifierType: 'email',
  email: EmailSchema.parse('asha@example.com'),
  phone: E164PhoneSchema.parse('+919845021174'),
  orderCount: 2,
  lifetimeValueMinor: money(259_800),
  lastOrderAt: FIXTURE_NOW,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  deletedAt: null,
  deletionReason: null,
  ...overrides,
});

export const anIdentityIndexEntry = (
  overrides: Partial<IdentityIndexDoc> = {},
): IdentityIndexDoc => ({
  uid: uid(),
  type: 'email',
  createdAt: FIXTURE_NOW,
  ...overrides,
});

const postalAddress: PostalAddress = {
  recipientName: 'Asha Menon',
  line1: '12 Palm Grove',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  phone: '+919845021174',
};

export const anAddress = (overrides: Partial<AddressDoc> = {}): AddressDoc => ({
  label: 'Home',
  ...postalAddress,
  isDefault: true,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  ...overrides,
});

export const aWishlistItem = (overrides: Partial<WishlistItemDoc> = {}): WishlistItemDoc => ({
  productId: ProductIdSchema.parse('wooden-blocks'),
  addedAt: FIXTURE_NOW,
  ...overrides,
});

export const aCart = (overrides: Partial<CartDoc> = {}): CartDoc => ({
  ownerType: 'user',
  userId: uid(),
  items: [
    {
      variantId: VariantIdSchema.parse('WB-240'),
      productId: ProductIdSchema.parse('wooden-blocks'),
      sku: SkuSchema.parse('WB-240'),
      qty: 2,
      priceMinorSnapshot: money(129_900),
      nameSnapshot: 'Wooden building blocks',
      variantNameSnapshot: '6–8 yrs · 240 pcs',
      imagePathSnapshot: 'products/wooden-blocks/cover.webp',
      addedAt: FIXTURE_NOW,
    },
  ],
  giftWrap: false,
  updatedAt: FIXTURE_NOW,
  expiresAt: null,
  ...overrides,
});

export const anOrder = (overrides: Partial<OrderDoc> = {}): OrderDoc => ({
  humanId: HumanOrderIdSchema.parse('RMP-24817'),
  userId: uid(),
  contact: {
    email: EmailSchema.parse('asha@example.com'),
    phone: E164PhoneSchema.parse('+919845021174'),
  },
  status: 'awaiting_payment',
  fulfilment: {
    status: 'unfulfilled',
    carrier: null,
    trackingNo: null,
    packedAt: null,
    shippedAt: null,
    deliveredAt: null,
    holdReason: null,
  },
  items: [
    {
      productId: ProductIdSchema.parse('wooden-blocks'),
      variantId: VariantIdSchema.parse('WB-240'),
      sku: SkuSchema.parse('WB-240'),
      name: 'Wooden building blocks',
      variantName: '6–8 yrs · 240 pcs',
      imagePath: 'products/wooden-blocks/cover.webp',
      unitPriceMinor: money(129_900),
      qty: 2,
      lineTotalMinor: money(259_800),
    },
  ],
  amounts: {
    subtotalMinor: money(259_800),
    giftWrapMinor: money(0),
    shippingMinor: money(0),
    taxMinor: money(31_176),
    totalMinor: money(290_976),
    refundedMinor: money(0),
  },
  shippingAddress: postalAddress,
  deliverySpeed: 'standard',
  isGift: false,
  giftMessage: null,
  payment: {
    method: 'upi',
    upiRef: null,
    screenshotPath: null,
    qrPayload: 'upi://pay?pa=romp@okhdfcbank&pn=ROMP&am=2909.76&tn=RMP-24817',
    submittedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
  },
  reservationId: ReservationIdSchema.parse('reservation-0001'),
  allocation: {
    [VariantIdSchema.parse('WB-240')]: { [WarehouseIdSchema.parse('blr')]: 2 },
  },
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  ...overrides,
});

export const anOrderEvent = (overrides: Partial<OrderEventDoc> = {}): OrderEventDoc => ({
  orderId: OrderIdSchema.parse('order-0001'),
  type: 'order.created',
  actorId: uid(),
  actorRole: 'customer',
  payload: { itemCount: 1 },
  at: FIXTURE_NOW,
  ...overrides,
});

export const aPaymentRefGuard = (
  overrides: Partial<PaymentRefGuardDoc> = {},
): PaymentRefGuardDoc => ({
  orderId: OrderIdSchema.parse('order-0001'),
  upiRef: UtrSchema.parse('412398765432'),
  claimedAt: FIXTURE_NOW,
  ...overrides,
});

export const aCounter = (overrides: Partial<CounterDoc> = {}): CounterDoc => ({
  value: 24_817,
  updatedAt: FIXTURE_NOW,
  ...overrides,
});

export const aNotification = (overrides: Partial<NotificationDoc> = {}): NotificationDoc => ({
  eventId: EventIdSchema.parse('event-0001'),
  audience: 'user',
  userId: uid(),
  type: 'order_placed',
  title: 'Order RMP-24817 placed',
  body: 'Pay within 30 minutes to keep your items reserved.',
  link: '/account/orders/order-0001',
  readAt: null,
  readBy: {},
  createdAt: FIXTURE_NOW,
  expiresAt: FIXTURE_LATER,
  ...overrides,
});

export const anAdminNotification = (overrides: Partial<NotificationDoc> = {}): NotificationDoc =>
  aNotification({ audience: 'admin', userId: null, type: 'new_order', ...overrides });

export const aReview = (overrides: Partial<ReviewDoc> = {}): ReviewDoc => ({
  productId: ProductIdSchema.parse('wooden-blocks'),
  userId: uid(),
  authorName: 'Asha M.',
  rating: RatingSchema.parse(5),
  title: 'Sturdy and beautifully sanded',
  body: 'Two weeks in and the tower is still standing. No splinters anywhere.',
  status: 'published',
  verifiedPurchase: true,
  orderId: OrderIdSchema.parse('order-0001'),
  moderatedBy: staffUid(),
  moderatedAt: FIXTURE_LATER,
  rejectionReason: null,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_LATER,
  ...overrides,
});

export const aRefund = (overrides: Partial<RefundDoc> = {}): RefundDoc => ({
  orderId: OrderIdSchema.parse('order-0001'),
  userId: uid(),
  mode: 'full',
  amountMinor: money(290_976),
  reason: 'customer_cancelled',
  note: null,
  outwardUpiRef: UtrSchema.parse('412398765433'),
  restock: true,
  createdBy: staffUid(),
  createdAt: FIXTURE_NOW,
  ...overrides,
});

export const checkoutSettings = (
  overrides: Partial<CheckoutSettingsDoc> = {},
): CheckoutSettingsDoc => ({
  reservationTtlMinutes: 30,
  giftWrapFeeMinor: money(4_900),
  expressFeeMinor: money(9_900),
  freeShippingThresholdMinor: money(99_900),
  standardShippingFeeMinor: money(5_900),
  gstRateBasisPoints: basisPoints(1_200),
  upi: { vpa: UpiVpaSchema.parse('romp@okhdfcbank'), payeeName: 'ROMP Toys' },
  lowStockThreshold: 5,
  updatedAt: FIXTURE_NOW,
  updatedBy: 'system',
  ...overrides,
});

export const dailyAnalytics = (overrides: Partial<DailyAnalyticsDoc> = {}): DailyAnalyticsDoc => ({
  date: '2026-03-01',
  revenueMinor: money(581_952),
  orderCount: 3,
  paidCount: 2,
  rejectedCount: 1,
  refundedMinor: money(0),
  aovMinor: money(290_976),
  computedAt: FIXTURE_LATER,
  ...overrides,
});
