---
'@authowl/react': patch
---

**`<GoogleOneTap/>` now warns in development when it runs without a `nonce`.**

The prop already existed and AuthOwl already forwarded it to Google and verified
the match, but it is optional and nothing pointed anyone at it.

Generate a fresh random value per prompt and pass it as `nonce`.
The warning is dev-only and eliminated from production builds, and it stays
quiet once a nonce is supplied.

The direct browser exchange does not persist separate one-time server state, so
the nonce prop alone is not replay prevention. The warning says that explicitly
instead of promising a security property the exchange does not enforce.

No behaviour change. `scriptNonce` is unrelated - it is a CSP nonce for the
Google Identity script tag and does not bind the token.
