---
'@authowl/core': minor
---

**`PublicConfig` now reports the bot challenge provider-agnostically**, as
`captcha: { provider, siteKey } | null`.

Read `config.captcha` rather than `authTurnstileSiteKey`. The Turnstile fields
remain populated whenever the provider is Turnstile, and the client derives the
generic shape from them when talking to a server that predates provider choice —
so there is one shape to branch on regardless of which end is older.

`provider` is a plain string, not a union of the providers a given build can
render. A project may be switched to a provider newer than the SDK an
application is running, and the difference between *no challenge configured* and
*a challenge this build cannot render* is the difference between signing in and
an unexplained refusal. Keeping the slug lets the renderer name what it does not
know.

`<AuthChallenge/>` renders whichever of Cloudflare Turnstile, hCaptcha or reCAPTCHA v2 the
project reports. A provider this build cannot render **fails closed with a message naming it**
rather than rendering nothing — an empty challenge sends no token and produces a refusal the
end user cannot act on.

Client-side only; no server change is required to adopt it.
