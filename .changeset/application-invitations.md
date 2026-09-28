---
"@authowl/core": minor
"@authowl/react": minor
---

Add standalone application invitations: typed server management operations,
recipient inspection and acceptance, and the bilingual AcceptApplicationInvitation
component. Email/password signup can carry application invitation proof while
preserving normal consent, MFA and signup policy checks. Scope browser invitation
intent to the environment and remove proof from the URL fragment after capture.

Requires an AuthOwl server with application-invitation endpoints. Invitations use
the existing email allowance and shared workspace invitation throughput limits.
