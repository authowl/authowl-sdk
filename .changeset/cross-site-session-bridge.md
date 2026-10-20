---
"@authowl/core": minor
"@authowl/react": minor
"@authowl/next": patch
---

Wait for app-session projection after cross-site handoff redemption, then complete sign-in and sign-up navigation. Preserve remember-me choices across tabs for the same session, reject non-object bridge request bodies with 400, and document public social and SSO callback pages for server-gated apps.

Expose `AuthOwlClient.handoff` as public API. SignIn and SignUp return to the form before completing navigation and no longer pass `redirectTo` as `callbackURL`; cross-origin `redirectTo` values are now dropped by `safeRedirect`. Bound projection requests and handoff completion, keep failed projections retryable without navigation, and finish required MFA enrollment before completing a handoff.
