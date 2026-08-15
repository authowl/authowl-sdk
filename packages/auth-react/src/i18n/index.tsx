'use client';
import * as React from 'react';
import {
  formatMessage,
  resolveServerError,
  type MessageKey,
  type MessageParams,
  type ServerErrorInput,
} from '@authowl/core/i18n';
import { useAuthOwlContext } from '../provider';

/** The active component locale (resolved by <AuthOwlProvider>). */
export function useLocale() {
  return useAuthOwlContext().locale;
}

/**
 * Translate a catalog key in the active locale. Every user-visible string in
 * the components goes through this (or richMessage below for node slots).
 */
export function useT() {
  const locale = useLocale();
  return React.useCallback(
    (key: MessageKey, params?: MessageParams) => formatMessage(locale, key, params),
    [locale],
  );
}

/**
 * Interpolate React nodes into a translated template's `{slot}` tokens - for
 * messages that embed links or styled spans (e.g. `signUp.consentLabel`'s
 * {links}). Translators move the token; word order stays theirs, not JSX's.
 */
export function richMessage(
  template: string,
  slots: Record<string, React.ReactNode>,
): React.ReactNode {
  return template
    .split(/(\{\w+\})/g)
    .filter(Boolean)
    .map((part, i) => {
      const token = /^\{(\w+)\}$/.exec(part);
      if (token && token[1]! in slots) {
        return <React.Fragment key={i}>{slots[token[1]!]}</React.Fragment>;
      }
      return part;
    });
}

/**
 * Bidi-isolate an LTR value (email address, manual key, code) embedded in a
 * possibly-RTL sentence, so punctuation and order render correctly.
 */
export function Bidi({ children }: { children: React.ReactNode }) {
  return <bdi>{children}</bdi>;
}

/**
 * THE server-error display policy, in one place (CONTRACTS §3): localize by the
 * server's error CODE, and for the rate-limit family render a live "try again
 * in {duration}" when the server sends `retryAfterSeconds`. An unmapped code that
 * carries a real 4xx body `message` shows that message (a fallback tier - our own
 * engine's auth strings are curated for display), except for enumeration-
 * sensitive codes, which stay neutral. The compatibility rate limiter sends a
 * bare 429 with no code, so that one is mapped by status. Everything else falls
 * back to the caller's already-localized generic string. Used by the
 * useSubmitAction chokepoint and the few surfaces that can't run through it.
 */
export function useServerError() {
  const locale = useLocale();
  return React.useCallback(
    (error: ServerErrorInput | null | undefined, fallback: string): string =>
      resolveServerError(locale, error, fallback),
    [locale],
  );
}

export {
  formatMessage,
  serverErrorMessage,
  resolveServerError,
  formatRetryDuration,
  catalogs,
  type MessageKey,
  type MessageCatalog,
  type MessageParams,
  type ServerErrorInput,
} from '@authowl/core/i18n';
