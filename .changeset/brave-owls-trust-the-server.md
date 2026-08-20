---
'@authowl/react': patch
---

`useOrganizationInvitation()` no longer calls `setActive` after accepting.

Accepting an invitation already re-points the session at the new organization
server-side, unconditionally, and the mutation refreshes the session so the
client picks that up. The extra call was a second round trip to reach the state
we were already in — and the condition guarding it claimed to protect an
existing active organization, which it never could: the server had switched it
before the condition was evaluated.
