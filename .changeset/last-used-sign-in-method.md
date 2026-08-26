---
'@authowl/core': minor
'@authowl/react': minor
---

**The SDK now remembers which sign-in method last worked in this browser.**

`useLastUsedSignInMethod()` returns it, per project. Nothing renders differently
yet — this ships the recording so a "last used" affordance can be added without
a second release, and so the value is already accurate when it arrives.

Two kinds of method are treated differently on purpose. Password, username and
email-OTP verification complete in the page, so success is observable and is
recorded when it happens. Social, SSO and magic link leave the page, so the
attempt is **parked** and promoted only once a session actually appears —
bouncing off a provider's consent screen does not teach the form that the
provider worked.

**What is remembered is a property of the browser, never of an address.** Nothing
is keyed by or derived from an email or username: *"which method does a@b.com
use"* is an account-enumeration and targeted-phishing surface, and the value is
written only after a method has already succeeded here, so it reveals nothing
this browser did not already do.

Storage is best-effort. A browser that refuses `localStorage` degrades to "no
hint" rather than to a sign-in that throws, and an unrecognised or tampered
value is discarded rather than trusted.

This is deliberately **not** Better Auth's `last-login-method` plugin, which
cannot work here: it reads a non-httpOnly cookie from `document.cookie`, and in
AuthOwl's SPA architecture that cookie lands on the engine's domain while in the
server architecture it lands on the tenant server's fetch. Unreadable in both.
