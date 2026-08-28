/**
 * Privacy evidence helpers used by managed sign-up surfaces.
 *
 * The authenticated privacy client is available as `client.privacy`; keeping
 * evidence construction in this subpath avoids adding UI-only code to every
 * framework-neutral client bundle.
 */
export {
  buildPrivacySignUpEvidence,
} from './privacy-evidence';
export type { PrivacyLocale } from './privacy-client';
