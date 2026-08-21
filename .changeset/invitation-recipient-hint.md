---
'@authowl/core': minor
'@authowl/react': minor
---

Surface the invitation link's new-user hint, so an invitee can be sent to sign UP.

An invitation usually goes to somebody with no account, and the emailed link
landed them on sign-in - the one screen they cannot use. The engine now says so
in the link, and the claim store carries it: `InvitationClaim.recipientHint`,
plus a `useInvitationRecipientHint()` hook readable before there is a session.

Its absence means "not told", never "they have an account".
