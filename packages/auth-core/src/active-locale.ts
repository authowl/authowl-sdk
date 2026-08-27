/**
 * The language the application is currently rendering, per project.
 *
 * The server binds a project's locale once, when its auth engine is built, and
 * shares that engine across every request - so without being told otherwise it
 * sends every user the same language. A user who just completed sign-up
 * entirely in Arabic would get an English verification email.
 *
 * This is what the client tells it. Not `accept-language`: that is the
 * BROWSER's preference, set by the operating system, while this is the language
 * the tenant's application chose to render - a product decision, and frequently
 * a different answer. Someone reading an Arabic app on an English-locale laptop
 * should get Arabic mail.
 *
 * KEYED BY PROJECT, not global. Two providers for two projects on one page is
 * unusual but legal, and a single shared value would let one of them relabel
 * the other's mail. Held outside the client so changing language does not
 * rebuild it - a rebuilt client is a rebuilt session store, which is a very
 * expensive way to answer a question about wording.
 */
type LocaleRegistration = { token: symbol; locale: string };
const activeLocales = new Map<string, LocaleRegistration[]>();

/** Bounded so a hostile or accidental value cannot become a header of any size. */
const LOCALE_PATTERN = /^[a-z]{2}$/;

export function setActiveLocale(projectId: string, locale: string | null): () => void {
  // This state belongs to one browser tab. Refuse to create process-global
  // request state when the core package is imported by a server renderer.
  if (typeof window === 'undefined') return () => {};
  if (locale === null) {
    activeLocales.delete(projectId);
    return () => {};
  }
  const normalized = locale.trim().toLowerCase();
  // The server accepts only locales it has catalogues for and ignores the rest,
  // so an unknown value here costs nothing - but sending an unbounded string
  // would, and this is a header on every authenticated request.
  if (!LOCALE_PATTERN.test(normalized)) return () => {};
  const token = Symbol(projectId);
  const registrations = activeLocales.get(projectId) ?? [];
  registrations.push({ token, locale: normalized });
  activeLocales.set(projectId, registrations);
  return () => {
    const current = activeLocales.get(projectId);
    if (!current) return;
    const remaining = current.filter((registration) => registration.token !== token);
    if (remaining.length === 0) activeLocales.delete(projectId);
    else activeLocales.set(projectId, remaining);
  };
}

export function activeLocale(projectId: string): string | null {
  if (typeof window === 'undefined') return null;
  return activeLocales.get(projectId)?.at(-1)?.locale ?? null;
}
