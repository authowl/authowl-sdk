---
'@authowl/core': minor
---

`listRoles()` now reports what a custom role grants.

A custom `org:<feature>:<action>` permission cannot appear in the engine's own
`permission` document, so a custom role read as empty there while genuinely
granting several - and no other call would tell an application otherwise.
`OrganizationRoleSummary` gains `customPermissionKeys`, absent both when a role
grants none and when the server does not report them, so an empty array is
never confused with "not told".
