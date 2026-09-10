export {
  InvalidPhoneNumberError,
  aliasDomain,
  classifyIdentifier,
  normalizeEmail,
  normalizePhone,
  toAuthEmail,
} from './phone';
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_SCORE,
  assessPassword,
} from './password';
export type { PasswordAssessment, PasswordContext } from './password';
