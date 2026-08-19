---
'@authowl/react': patch
---

`<OrganizationList/>` no longer claims the directory is empty when loading it
failed. It rendered "you do not belong to an organization yet" underneath the
error, which is a claim the component cannot make when the request never
answered — and it buried the retry that is the actual next step.
