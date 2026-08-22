---
'@authowl/core': patch
---

**Upgrade note:** `OrganizationMemberUser.email` is `string | null`, not `string`. It was
widened in **0.16.0**, a minor release, so servers can withhold internal placeholder addresses
without breaking decoding. Code written against `string` must handle `null` when an address is
not available to the caller.

Because this package sets `changelog: false`, the changeset text never reached consumers, so
the widening arrived as a bare compile error. If you hit it, supply a fallback
(`user.email ?? ''`) or guard before use.

No runtime behaviour changed in this package.
