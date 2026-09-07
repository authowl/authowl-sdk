---
"@authowl/core": patch
"@authowl/react": patch
"authowl": patch
---

Hide passkey enrollment and sign-in controls when the browser's current host
cannot perform the WebAuthn ceremony, while preserving management of existing
credentials. Refresh the CLI scaffold pin for the React patch.
