/**
 * Recognising Firestore's create-conflict.
 *
 * The `create`-only write is the platform's reservation primitive: an identifier, a category
 * slug, a payment reference — each is claimed by writing a document whose ID *is* the value, so a
 * second claim fails atomically on the document already existing rather than on a query that could
 * race. That failure surfaces differently across runtimes — the Admin SDK sets a numeric gRPC
 * status, the emulator a string code, and some paths only a message — so recognising it in one
 * place, tested against all three shapes, keeps every claim site from re-deriving the check.
 */

/** Whether an error is Firestore's ALREADY_EXISTS from a create against an existing document. */
export function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 6 || code === 'already-exists') return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /already exists/iu.test(message);
}
