---
'@authowl/react': major
'@authowl/core': minor
---

Refresh SignIn and SignUp with compact token-based cards, accessible method tabs, social last-used hints, and reduced-motion-aware feedback. Add English and Arabic subtitles, method labels, and last-used copy.

DOM and rendering contract changes for the migration guide:

- The stacked `ba-button-secondary` sign-in alternates are gone. Methods are tabs now.
- Social buttons show the bare provider name as visible text. Their accessible name is the localized "Continue with <provider>" ("Redirecting..." while pending).
- Phone sign-in is a secondary link styled with `ba-link-button` rather than a button styled as an alternate action. It retains native button semantics.
- A new `.ba-subtitle` renders under the title.
- The exported `useLastUsedSignInMethod` returns null on the first render and resolves after mount.
- The passkey tab uses a filled primary button.
- At widths of 480px or less, controls grow to 48px and inputs use 16px text. Nothing changes the host page layout.
