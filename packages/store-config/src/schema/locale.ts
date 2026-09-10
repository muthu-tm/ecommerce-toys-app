import { z } from 'zod';

import { BasisPointsSchema } from '@romp/contracts';

/**
 * Locale and tax.
 *
 * Everything here is passed explicitly into formatting and normalisation rather than
 * read from a module-level default, which is what keeps a second store from silently
 * inheriting the first store's timezone or currency (ADR-0005).
 */
export const LocaleConfigSchema = z.object({
  /** ISO 4217. Drives `Intl.NumberFormat`. */
  currency: z.string().regex(/^[A-Z]{3}$/u, { error: 'Must be an ISO 4217 code such as "INR".' }),
  /** BCP 47. Drives number and date formatting. */
  locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u, {
    error: 'Must be a BCP 47 tag such as "en-IN".',
  }),
  /** IANA zone. Validated against the runtime's own tz database rather than a regex. */
  timezone: z.string().refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { error: 'Must be an IANA timezone such as "Asia/Kolkata".' },
  ),
  /**
   * ISO 3166-1 alpha-2. Decides how a bare `9845021174` is interpreted when
   * normalising a mobile number to E.164 — and since a mobile number is a login
   * identifier (ADR-0006), getting this wrong for a new store would mean customers
   * cannot log back in with the number they typed at registration.
   */
  defaultPhoneRegion: z
    .string()
    .regex(/^[A-Z]{2}$/u, { error: 'Must be an ISO 3166-1 alpha-2 code such as "IN".' }),
  /** Integer basis points: 1800 = 18%. Same reasoning as money in paise (ADR-0004). */
  gstRateBasisPoints: BasisPointsSchema,
});
export type LocaleConfig = z.infer<typeof LocaleConfigSchema>;
