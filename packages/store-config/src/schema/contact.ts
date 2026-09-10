import { z } from 'zod';

import { E164PhoneSchema } from '@romp/contracts';

/**
 * Support contact details.
 *
 * WhatsApp is the support channel: the platform sends no email, and customer-initiated
 * support goes to WhatsApp (ADR-0007). `supportEmail` is therefore **display only** —
 * nothing sends to it.
 */
export const ContactConfigSchema = z.object({
  /** E.164. Powers every support deep link. */
  whatsappNumber: E164PhoneSchema,
  /**
   * Pre-filled message. `{orderRef}` is interpolated where an order is in context, and
   * dropped where one is not.
   */
  whatsappGreeting: z.string().min(1).max(500),
  /** Display string, e.g. "Mon–Sat, 10am–7pm IST". Not parsed. */
  supportHours: z.string().min(1).max(120),
  /**
   * Optional and display-only. Present so a store can publish a statutory contact
   * address; the platform has no email transport, so nothing here is ever sent to.
   */
  supportEmail: z.email().optional(),
});
export type ContactConfig = z.infer<typeof ContactConfigSchema>;

/** Interpolates `{orderRef}` into the greeting, or removes it when absent. */
export function buildWhatsappMessage(greeting: string, orderRef?: string): string {
  if (orderRef === undefined) {
    // Collapse the placeholder and any whitespace left around it, so a general
    // enquiry does not read "Hi, about order  ."
    return greeting
      .replaceAll(/\s*\{orderRef\}\s*/gu, ' ')
      .replace(/\s+([.,!?])/u, '$1')
      .trim();
  }
  return greeting.replaceAll('{orderRef}', orderRef).trim();
}

/** A `wa.me` deep link with the greeting pre-filled. */
export function buildWhatsappLink(
  contact: Pick<ContactConfig, 'whatsappNumber' | 'whatsappGreeting'>,
  orderRef?: string,
): string {
  // wa.me wants the number without the leading plus.
  const number = contact.whatsappNumber.replace(/^\+/u, '');
  const text = encodeURIComponent(buildWhatsappMessage(contact.whatsappGreeting, orderRef));
  return `https://wa.me/${number}?text=${text}`;
}
