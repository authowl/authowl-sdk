/**
 * The host a WebAuthn ceremony would run on, or `undefined` on a server render.
 *
 * Lives here rather than in `signin-methods.ts`, whose contract is "pure,
 * DOM-free resolution of which sign-in surfaces to render" - a licence readers
 * rely on to call that module from a server context. This reads
 * `window.location`, so putting it there made the promise false for everything
 * beside it.
 *
 * Hand-rolled at three call sites before this, in two spellings that had already
 * drifted: one read `window.location.hostname` bare and was safe only because a
 * conjunct ahead of it short-circuited, so reordering that `&&` chain was a
 * crash rather than a type error.
 */
export function currentPageHost(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.hostname;
}
