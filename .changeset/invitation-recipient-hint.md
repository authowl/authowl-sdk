---
'@authowl/core': minor
'@authowl/react': minor
---

Resolve an invitation's new-user hint before authentication, so an invitee can
be sent to sign up without changing the emailed URL contract for older clients.

An invitation usually goes to somebody with no account, and the emailed link
landed them on sign-in - the one screen they cannot use. The SDK now resolves
the hint from the existing opaque invitation id. `useInvitationRecipientHint()`
exposes an explicit `isLoaded` state so "not read yet" is never confused with
"not told".

Its absence means "not told", never "they have an account".
