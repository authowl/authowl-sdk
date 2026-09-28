---
'@authowl/next': patch
---

Preserve the app session cookie when a browser session check fails, including during page hydration. Retry and recover without signing the user out; successful empty session checks and explicit sign-out continue to clear the cookie. Server-side session validation remains required.
