---
"@authowl/core": minor
"authowl": minor
"@authowl/react": patch
"@authowl/next": patch
---

Accept legacy and region-carrying API keys. Decoded publishable keys expose a nullable region hint across all SDKs, without changing routing.

The four-part UUID segment is now validated positionally (8-4-4-4-12 hex), matching the server; strings that only matched the old loose `[0-9a-f-]{36}` character class (never a minted key) are now rejected.
