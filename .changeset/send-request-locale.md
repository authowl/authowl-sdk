---
'@authowl/core': minor
'@authowl/react': minor
---

**The SDK now tells the server which language your application is rendering.**

A project's locale is bound once when its auth engine is built, so without this
a bilingual project sent every user the same language — including a user who had
just completed sign-up entirely in Arabic, who then received an English
verification email.

`<AuthOwlProvider>` publishes its resolved locale automatically; there is nothing
to configure. Requests carry `x-authowl-locale`, and a server that does not know
it ignores it.

Deliberately **not** `accept-language`. That header is the browser's preference,
set by the operating system, while this is the language your application chose to
render — a product decision, and frequently a different answer. Someone reading an
Arabic app on an English-locale laptop should get Arabic mail.

Needs an engine that honours the header to change anything; older servers are
unaffected.
