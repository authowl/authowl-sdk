---
'@authowl/core': minor
'@authowl/react': minor
---

Stop rejecting organization responses that carry an empty, null, or absent display string.

The organization decoder required every string on the wire to be non-empty, so a
single member with no display name made the WHOLE organization undecodable:
`get()`, `listMembers()`, `listUserInvitations()`, `listInvitations()`,
`listTeams()`, and - worst - the mutations `leave()` and `removeMember()`, where
the server had already done the work and the SDK then threw `INVALID_RESPONSE`
on the receipt. A nameless member could not leave an organization they had in
fact just left.

Empty names are not malformed data: the store column is nullable, and this SDK's
own `<SignUp>` posts `name: ''` under the default capability config. Four fields
now accept them - member `user.name`, `team.name`, `invitation.email`, and the
`organizationName` on list-user-invitations (which may be absent entirely) -
each coerced to `''` so `name` stays a `string` and existing surfaces can keep
calling `.trim()` on it. The length cap that guards against oversized responses
stays. Identifiers, slugs, roles, and statuses are unchanged: an empty value
there is still a contract violation.

`OrganizationMemberUser.email` and `OrganizationInvitationDetails.inviterEmail`
become `string | null`. This is the asymmetry worth naming: `''` and `null` mean
the SAME thing for a display name (nobody supplied one), while for an address
they mean DIFFERENT things - `null` says the server withheld it, and a present
string says it was disclosed. Today's server always sends an address, so the type
widens ahead of the wire on purpose: AuthOwl currently redacts phone-only users'
synthetic `phone_<digest>@...` addresses on the session endpoint only, and the
organization endpoints still hand that address to every member. A tolerant reader
has to be in the field BEFORE the server starts withholding it, or the privacy
fix breaks every strict SDK already installed. Shipping it now costs one minor
release instead of two.
