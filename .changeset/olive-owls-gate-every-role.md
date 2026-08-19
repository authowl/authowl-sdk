---
'@authowl/core': minor
---

Gate on every role a member holds, not just the primary one.

`member.role` is a comma-separated set server-side, so `admin,editor` is an
ordinary membership. `has({ role: 'editor' })` answered false for someone who
genuinely held it, because the check compared the single primary role — while
`permissions` had unioned across both roles all along.

`OrganizationMembership` gains `roles`, and `has()` now matches against the set.
The new `membershipHasRole()` is exported for the same check outside a `has()`
query.

`roles` is optional and falls back to `role`, so a client pointed at an older
AuthOwl reports what that server actually told it rather than claiming the
member holds nothing. Client and server can deploy in either order.
