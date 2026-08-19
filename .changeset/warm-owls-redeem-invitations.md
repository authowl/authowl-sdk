---
'@authowl/core': minor
'@authowl/react': minor
---

Redeem organization invitations from the emailed link.

The invitation email links to the operator's own page carrying
`?authowl_invitation=<id>`, and nothing consumed it: the invitee signed up and
simply never joined, while the flow reported success. The invitation and the
accept route both worked - there was no code path connecting them.

`AuthOwlProvider` now captures that id into storage on mount and strips it from
the URL, because a query parameter does not survive the redirects the sign-up
itself performs (OAuth, email verification, an MFA hold, the operator's own
`redirectTo`). Once a session exists, an `<InvitationPrompt/>` offers the
organization by name and joins on one confirmation.

Confirmed rather than automatic, because accepting can fail in ways the user has
to see: the organization is at its member cap, the invitation expired, or the
session belongs to a different address than the one invited. An automatic redeem
has nowhere to render any of that - which is the original defect one layer up.
The engine binds acceptance to the recipient's email, so the wrong-account state
explains the mismatch and offers a sign-out without ever naming the invited
address.

`<SignIn/>` and `<SignUp/>` show a short notice while an invitation is pending,
because signing up with a different address than the invited one is the trap
with no recovery. Headless apps pass `invitationPrompt={false}` to
`AuthOwlProvider` and drive the new `useOrganizationInvitation()` hook, which
also exposes `dismiss()` - local only, never a server-side reject, so a
reflexive "not now" cannot burn a live invitation.
