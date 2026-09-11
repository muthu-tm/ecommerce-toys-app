/**
 * `@romp/core` — pure domain logic shared by the browser and the server.
 *
 * Nothing here touches Firebase, the network or the filesystem. It is the set of functions
 * that must give the same answer on the client and the server: identity normalisation
 * (so a login alias is derived identically in both places) and the password policy (so the
 * strength meter and the API gate agree). Keeping them here, dependency-light and pure, is
 * what lets both surfaces import one implementation rather than reimplementing it twice.
 */

export {
  InvalidPhoneNumberError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_SCORE,
  aliasDomain,
  assessPassword,
  classifyIdentifier,
  normalizeEmail,
  normalizePhone,
  toAuthEmail,
} from './identity';
export type { PasswordAssessment, PasswordContext } from './identity';

export {
  applyStockDelta,
  cacheTags,
  canBeActive,
  decideMediaFinalize,
  deriveSlug,
  normaliseMediaOrder,
  planProductCountChanges,
  productSearchParts,
  resolveStatusTransition,
  slugify,
  sniffImageType,
  stockThresholdCrossing,
  summariseVariants,
  tagsForProduct,
  validateCategoryParent,
} from './catalogue';
export type {
  AllowedImageType,
  ApplyStockDeltaResult,
  CategoryParentRefusal,
  CountableProduct,
  MediaFinalizeDecision,
  MediaQuarantineReason,
  ProductCountDelta,
  ProductPricing,
  StatusTransition,
  StatusTransitionResult,
  StockByWarehouse,
  StockDeltaRefusal,
  StockDeltaResult,
  ValidateCategoryParentResult,
  VariantForSummary,
} from './catalogue';

export {
  allocateStock,
  applyCartMutation,
  applyReservation,
  buildUpiUri,
  cartItemCount,
  cartSubtotal,
  computeOrderTotals,
  formatOrderNumber,
  mergeCarts,
} from './commerce';
export type {
  ApplyCartMutationResult,
  ApplyReservationResult,
  CartLineView,
  CartMutation,
  CartMutationContext,
  CartMutationRefusal,
  OrderLineInput,
  OrderTotals,
  OrderTotalsSettings,
  VariantSnapshot,
  WarehouseStock,
} from './commerce';

export { aggregateDailyOrders, zonedDayWindow } from './analytics';
export type { DailyRollup, DayWindow, RollupOrder } from './analytics';

export {
  NOTIFICATION_ROUTES,
  allowedTokensByNotificationType,
  findTemplateTokenViolations,
  planNotifications,
  tokensIn,
} from './notifications';
export type {
  DispatchInputs,
  NotificationContent,
  NotificationRoute,
  TemplateTokenViolation,
} from './notifications';
