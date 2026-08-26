---
'@authowl/react': patch
---

**`<GoogleOneTap/>` now warns in development when it runs without a `nonce`.**

The prop already existed and AuthOwl already forwarded it to Google and verified
the match — but it is optional, and nothing pointed anyone at it. Without a
nonce, Google issues a token that says nothing about which attempt asked for it,
so a token captured from one browser can be replayed from another and will
verify correctly.

Generate a fresh random value per attempt server-side and pass it as `nonce`.
The warning is dev-only and eliminated from production builds, and it stays
quiet once a nonce is supplied.

No behaviour change. `scriptNonce` is unrelated — it is a CSP nonce for the
Google Identity script tag and does not bind the token.
