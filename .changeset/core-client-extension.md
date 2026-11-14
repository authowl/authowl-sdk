---
"@authowl/core": minor
---

Add the client extension seam used by sibling SDK packages.
Send every Admin API request with cache: no-store. A runtime whose fetch rejects the cache option can pass its own
fetch that drops it.
