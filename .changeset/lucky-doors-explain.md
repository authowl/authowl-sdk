---
"@authowl/core": patch
---

Document that `getInvitation` is recipient-only. The method resolves an invitation only when
the signed-in session's own email is the recipient — a deliberate access control, not a
defect — so an inviter looking up an invitation they sent should call
`listInvitations({ organizationId })` instead. Documentation only; no behaviour change.
