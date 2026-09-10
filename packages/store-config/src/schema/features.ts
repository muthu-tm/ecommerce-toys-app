import { z } from 'zod';

/**
 * Feature flags.
 *
 * Each flag removes a capability from the UI **and** from the server contract. A
 * disabled feature is not merely hidden — its routes refuse — so it cannot be reached
 * by a crafted request. Hiding a button while leaving the endpoint open is not a
 * feature flag, it is a vulnerability with a nice UI.
 */
export const FeatureFlagsSchema = z.object({
  /** Review submission, the PDP review section, and the review routes. */
  reviews: z.boolean(),
  /** Wishlist hearts, the account section, and the wishlist routes. */
  wishlist: z.boolean(),
  /** Gift wrap in the cart UI and as a line in the checkout quote. */
  giftWrap: z.boolean(),
  /** Express shipping as a delivery option. */
  expressDelivery: z.boolean(),
  /** The PDP pincode delivery estimator. */
  deliveryEstimate: z.boolean(),
});
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

export const FEATURE_FLAG_NAMES = Object.freeze(
  Object.keys(FeatureFlagsSchema.shape) as (keyof FeatureFlags)[],
);
