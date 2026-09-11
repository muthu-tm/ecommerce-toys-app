/**
 * `@romp/contracts` — the shared contract.
 *
 * Every type in the platform that crosses a boundary is defined here as a Zod
 * schema, and the TypeScript type is *inferred* from it. That direction matters:
 * a hand-written type beside a schema is two declarations that can disagree, and
 * the one that disagrees silently is always the type.
 *
 * The same schemas serve three jobs — compile-time types, runtime validation at
 * every boundary, and OpenAPI generation — so the documented contract cannot drift
 * from what the code enforces.
 *
 * This package has **no I/O and no Firebase import**. It is consumed by the
 * browser bundle, so a Firestore type reaching in here would pull the SDK with it.
 */

// --- primitives -------------------------------------------------------------
export {
  MoneySchema,
  MoneyDeltaSchema,
  ZERO_MONEY,
  money,
  moneyDelta,
  rupeesToMoney,
  moneyToRupees,
  addMoney,
  sumMoney,
  subtractMoney,
  multiplyMoney,
  applyTaxBps,
  addTaxBps,
  allocateProportionally,
  formatMoney,
} from './primitives/money';
export type { Money, MoneyDelta } from './primitives/money';

export {
  BasisPointsSchema,
  BASIS_POINTS_SCALE,
  GST_BANDS,
  basisPoints,
  formatBasisPoints,
} from './primitives/basis-points';
export type { BasisPoints } from './primitives/basis-points';

export {
  ActorIdSchema,
  AddressIdSchema,
  CartIdSchema,
  CategoryIdSchema,
  EventIdSchema,
  LedgerEntryIdSchema,
  NotificationIdSchema,
  OrderIdSchema,
  ProductIdSchema,
  RefundIdSchema,
  ReservationIdSchema,
  ReviewIdSchema,
  SYSTEM_ACTOR,
  StoreIdSchema,
  UidSchema,
  VariantIdSchema,
  WarehouseIdSchema,
} from './primitives/ids';
export type {
  ActorId,
  AddressId,
  CartId,
  CategoryId,
  EventId,
  LedgerEntryId,
  NotificationId,
  OrderId,
  ProductId,
  RefundId,
  ReservationId,
  ReviewId,
  StoreId,
  Uid,
  VariantId,
  WarehouseId,
} from './primitives/ids';

export {
  CorrelationIdSchema,
  E164PhoneSchema,
  EmailSchema,
  HumanOrderIdSchema,
  IdempotencyKeySchema,
  IdentifierTypeSchema,
  LoginIdentifierSchema,
  PincodeSchema,
  SkuSchema,
  SlugSchema,
  UpiVpaSchema,
  UtrSchema,
} from './primitives/identifiers';
export type {
  CorrelationId,
  E164Phone,
  Email,
  HumanOrderId,
  IdempotencyKey,
  IdentifierType,
  LoginIdentifier,
  Pincode,
  Sku,
  Slug,
  UpiVpa,
  Utr,
} from './primitives/identifiers';

export {
  CursorSchema,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PageRequestSchema,
  pagedSchema,
} from './primitives/pagination';
export type { Cursor, Paged, PageRequest, ResolvedPageRequest } from './primitives/pagination';

export { InstantSchema, NullableInstantSchema, instantsEqual } from './primitives/instant';
export type { Instant } from './primitives/instant';

// --- state machines ---------------------------------------------------------
export { createStateMachine, describeTransitionFailure } from './state-machine';
export type { StateMachine, TransitionCheck, TransitionTable } from './state-machine';

// --- domain -----------------------------------------------------------------
export {
  AWAITING_ADMIN_ACTION_STATUSES,
  DeliverySpeedSchema,
  FulfilmentStatusSchema,
  OrderStatusSchema,
  PaymentMethodSchema,
  RESERVATION_HOLDING_STATUSES,
  fulfilmentStatusMachine,
  orderStatusMachine,
} from './domain/order';
export type { DeliverySpeed, FulfilmentStatus, OrderStatus, PaymentMethod } from './domain/order';

export { ReservationStatusSchema, reservationStatusMachine } from './domain/reservation';
export type { ReservationStatus } from './domain/reservation';

export {
  RATING_COUNTED_STATUSES,
  REVIEW_SLOT_OCCUPYING_STATUSES,
  RatingSchema,
  ReviewStatusSchema,
  reviewStatusMachine,
} from './domain/review';
export type { Rating, ReviewStatus } from './domain/review';

export {
  PUBLICLY_VISIBLE_PRODUCT_STATUSES,
  AgeBandSchema,
  ProductStatusSchema,
  productStatusMachine,
} from './domain/product';
export type { AgeBand, ProductStatus } from './domain/product';

export {
  NOTE_REQUIRED_REASONS,
  RESTOCK_SUGGESTED_REASONS,
  RefundModeSchema,
  RefundReasonSchema,
} from './domain/refund';
export type { RefundMode, RefundReason } from './domain/refund';

export {
  InventoryLedgerReasonSchema,
  OPERATOR_SELECTABLE_REASONS,
  QuantityDeltaSchema,
  QuantitySchema,
  availableStock,
  quantity,
  quantityDelta,
} from './domain/inventory';
export type { InventoryLedgerReason, Quantity, QuantityDelta } from './domain/inventory';

// --- events -----------------------------------------------------------------
export {
  AudienceSchema,
  EVENT_SUBJECT_KIND,
  EventDocSchema,
  EventPayloadSchema,
  EventSubjectKindSchema,
  EventTypeSchema,
  NotificationTypeSchema,
  StoredEventSchema,
} from './events';
export type {
  Audience,
  EventDoc,
  EventPayload,
  EventPayloadOf,
  EventSubjectKind,
  EventType,
  NotificationType,
  StoredEvent,
} from './events';

// --- documents --------------------------------------------------------------
// One schema per Firestore collection. Instants are `Date` here; the Timestamp
// conversion is owned by the converters in `@romp/data`.
export * from './entities';

// --- search -----------------------------------------------------------------
// Engine-neutral catalogue discovery. `ProductQuery` describes intent, not a
// Firestore query — the commitment that makes ADR-0002's SearchPort swappable.
export {
  DEFAULT_PRODUCT_SORT,
  FacetCountsSchema,
  MAX_FILTER_VALUES,
  PriceBandSchema,
  ProductQuerySchema,
  ProductSortSchema,
  ProductSummarySchema,
  SuggestionSchema,
  VariantOptionSchema,
} from './search/query';
export type {
  FacetCounts,
  PriceBand,
  ProductQuery,
  ProductSort,
  ProductSummary,
  ResolvedProductQuery,
  Suggestion,
  VariantOption,
} from './search/query';

// --- http -------------------------------------------------------------------
export {
  ERROR_DEFINITIONS,
  ERROR_TYPE_BASE_URI,
  ErrorCodeSchema,
  errorTitle,
  errorTypeUri,
  httpStatusForErrorCode,
  isDetailExposable,
} from './http/error-codes';
export type { ErrorCode } from './http/error-codes';

export {
  PROBLEM_JSON_CONTENT_TYPE,
  ProblemDetailsSchema,
  ValidationIssueSchema,
} from './http/problem';
export type { ProblemDetails, ValidationIssue } from './http/problem';

export {
  CheckIdentifierRequestSchema,
  CheckIdentifierResponseSchema,
  MeResponseSchema,
  MeUpdateRequestSchema,
  PasswordChangeRequestSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
} from './http/auth';
export type {
  CheckIdentifierRequest,
  CheckIdentifierResponse,
  MeResponse,
  MeUpdateRequest,
  PasswordChangeRequest,
  RegisterRequest,
  RegisterResponse,
} from './http/auth';

export {
  CreateProductRequestSchema,
  CreateProductResponseSchema,
  CreateVariantRequestSchema,
  CreateVariantResponseSchema,
  InventoryAdjustRequestSchema,
  InventoryResponseSchema,
  ProductStatusChangeRequestSchema,
  RegisterMediaRequestSchema,
  RegisterMediaResponseSchema,
  UpdateProductRequestSchema,
  UpdateVariantRequestSchema,
} from './http/admin-catalogue';
export type {
  CreateProductRequest,
  CreateProductResponse,
  CreateVariantRequest,
  CreateVariantResponse,
  InventoryAdjustRequest,
  InventoryResponse,
  ProductStatusChangeRequest,
  RegisterMediaRequest,
  RegisterMediaResponse,
  UpdateProductRequest,
  UpdateVariantRequest,
} from './http/admin-catalogue';

export {
  CreateCategoryRequestSchema,
  CreateCategoryResponseSchema,
  ReorderCategoriesRequestSchema,
  UpdateCategoryRequestSchema,
} from './http/admin-category';
export type {
  CreateCategoryRequest,
  CreateCategoryResponse,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
} from './http/admin-category';

export {
  AddCartItemRequestSchema,
  CartLineViewSchema,
  CartViewSchema,
  UpdateCartRequestSchema,
} from './http/cart';
export type {
  AddCartItemRequest,
  CartLineView as CartLineViewResponse,
  CartView,
  UpdateCartRequest,
} from './http/cart';

export {
  CheckoutQuoteLineSchema,
  CheckoutQuoteRequestSchema,
  CheckoutQuoteResponseSchema,
} from './http/checkout';
export type {
  CheckoutQuoteLine,
  CheckoutQuoteRequest,
  CheckoutQuoteResponse,
} from './http/checkout';

export { OrderViewSchema, PlaceOrderRequestSchema, PlaceOrderResponseSchema } from './http/orders';
export type { OrderView, PlaceOrderRequest, PlaceOrderResponse } from './http/orders';

export { SubmitPaymentProofRequestSchema, SubmitPaymentProofResponseSchema } from './http/payments';
export type { SubmitPaymentProofRequest, SubmitPaymentProofResponse } from './http/payments';

export {
  DailyAnalyticsRangeRequestSchema,
  DailyAnalyticsResponseSchema,
  DailyAnalyticsRowSchema,
} from './http/admin-analytics';
export type {
  DailyAnalyticsRangeRequest,
  DailyAnalyticsResponse,
  DailyAnalyticsRow,
} from './http/admin-analytics';

export {
  AdminOrderActionResponseSchema,
  AdminOrderListRequestSchema,
  AdminOrderListResponseSchema,
  AdminOrderMutationResponseSchema,
  CancelOrderRequestSchema,
  FulfilmentRequestSchema,
  IssueRefundRequestSchema,
  IssueRefundResponseSchema,
  RejectPaymentRequestSchema,
  VerifyPaymentRequestSchema,
} from './http/admin-orders';
export type {
  AdminOrderActionResponse,
  AdminOrderListRequest,
  AdminOrderListResponse,
  AdminOrderMutationResponse,
  CancelOrderRequest,
  FulfilmentRequest,
  IssueRefundRequest,
  IssueRefundResponse,
  RejectPaymentRequest,
  ResolvedAdminOrderListRequest,
  VerifyPaymentRequest,
} from './http/admin-orders';

// --- openapi ----------------------------------------------------------------
// Deliberately not re-exported from the barrel: importing it calls
// `extendZodWithOpenApi`, which patches the shared Zod instance. Only the spec
// generator should pay that cost, so it is reached at `@romp/contracts/openapi`
// via a direct path import instead.
