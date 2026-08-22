---
'@authowl/core': patch
---

**Upgrade note:** `OrganizationMemberUser.email` is `string | null`, not `string`. It was
widened in **0.16.0**, a minor release.

The type deliberately runs ahead of the wire. A phone-only user has a synthetic address, and
the session response already redacts it to `null`; the organization endpoints do not redact
yet, so today they still return the synthetic string. Code written against `string` will
compile against `null` as soon as that redaction reaches them.

Because this package sets `changelog: false`, the changeset text never reached consumers, so
the widening arrived as a bare compile error. If you hit it, supply a fallback
(`user.email ?? ''`) or guard before use.

No runtime behaviour changed.
