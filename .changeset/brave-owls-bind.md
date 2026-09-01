---
"@authowl/core": patch
---

Bind browser bearer-session fallback tokens to a non-extractable per-origin key,
keep cookie-capable browsers cookie-only, and recover safely from browser key
loss by revoking only the affected session.
