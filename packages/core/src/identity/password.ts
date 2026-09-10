import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';

/**
 * The password policy, as a pure assessment shared by the registration UI and the API.
 *
 * The policy is deliberately **not** composition rules ("one uppercase, one symbol").
 * Those push people toward predictable patterns — `Password1!` — and measurably reduce
 * real entropy while feeling strict. A strength estimator is the better gate, so this uses
 * zxcvbn with a length floor and a context-aware blocklist (the identifier itself, the
 * brand name), which are the passwords an attacker tries first against *this* store.
 *
 * The UI calls `assessPassword` to drive a live meter with specific guidance; the API
 * calls it to accept or reject. Same function, so the meter cannot promise a password the
 * server then refuses. See `IDENTITY.md § password policy`.
 */

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt-style truncation past 72 bytes is a surprise; we cap well below any provider limit. */
export const PASSWORD_MAX_LENGTH = 128;
/** zxcvbn score is 0–4; 3 ("safely unguessable") is the floor. */
export const PASSWORD_MIN_SCORE = 3;

// Configure zxcvbn once at module load with the common dictionary (leet substitutions,
// common passwords, keyboard patterns). English dictionaries are intentionally omitted:
// they are large, and the common set already catches the passwords that matter here while
// keeping this dependency-light enough to run in the browser bundle.
// No `translations` option: the English feedback strings live in a separate language pack,
// and we do not depend on them — `assessPassword` supplies its own user-safe fallback
// suggestions, so zxcvbn's built-in feedback is a bonus when present, not a requirement.
zxcvbnOptions.setOptions({
  dictionary: { ...zxcvbnCommon.dictionary },
  graphs: zxcvbnCommon.adjacencyGraphs,
});

export interface PasswordContext {
  /** The identifier being registered — email or phone — so the password cannot echo it. */
  readonly identifier?: string;
  /** Brand names to blocklist, so `<brandname>123` is rejected as the obvious guess. */
  readonly brandNames?: readonly string[];
}

export interface PasswordAssessment {
  readonly ok: boolean;
  /** zxcvbn score, 0 (trivial) to 4 (strong). */
  readonly score: number;
  /** Why it failed, or guidance to strengthen it. Safe to show a user verbatim. */
  readonly suggestions: readonly string[];
}

/**
 * Assesses a candidate password against the policy.
 *
 * Length is checked first and short-circuits: a 4-character password does not need a
 * strength estimate to be rejected, and running zxcvbn on it only produces vaguer advice
 * than "make it at least 10 characters". Above the floor, the zxcvbn score decides, with
 * the identifier and brand fed in as user inputs so a password derived from them scores
 * as the weak choice it is.
 */
export function assessPassword(
  password: string,
  context: PasswordContext = {},
): PasswordAssessment {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      score: 0,
      suggestions: [`Use at least ${String(PASSWORD_MIN_LENGTH)} characters.`],
    };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      score: 0,
      suggestions: [`Keep it under ${String(PASSWORD_MAX_LENGTH)} characters.`],
    };
  }

  const userInputs = buildUserInputs(context);
  const result = zxcvbn(password, userInputs);

  if (result.score >= PASSWORD_MIN_SCORE) {
    return { ok: true, score: result.score, suggestions: [] };
  }

  // zxcvbn's own feedback is specific and user-safe ("Add another word or two"). Fall back
  // to a general line when it has nothing, so the UI never shows an empty reason.
  const feedback = [
    ...(result.feedback.warning ? [result.feedback.warning] : []),
    ...result.feedback.suggestions,
  ];
  return {
    ok: false,
    score: result.score,
    suggestions:
      feedback.length > 0
        ? feedback
        : ['Choose a longer or less predictable password — avoid common words and patterns.'],
  };
}

/**
 * Builds the zxcvbn user-input list: the identifier and the brand names, plus a few
 * derived forms. A password containing any of these is penalised, because they are the
 * first things an attacker targeting this store would try.
 */
function buildUserInputs(context: PasswordContext): string[] {
  const inputs: string[] = [];
  if (context.identifier !== undefined && context.identifier !== '') {
    inputs.push(context.identifier);
    // The local part of an email is a common password seed on its own.
    const at = context.identifier.indexOf('@');
    if (at > 0) inputs.push(context.identifier.slice(0, at));
  }
  for (const name of context.brandNames ?? []) {
    if (name !== '') inputs.push(name);
  }
  return inputs;
}
