---
'@authowl/core': patch
---

Organization reads that are open at the same time now share one request.

`useOrganization()` fetches per consumer, so a page rendering the switcher, a
members table and a few `<Protect>` boundaries asked the server for the same
organization once per component — a dozen identical requests for one load.

This is a join, not a cache: nothing is retained once a request settles, so a
later read is a real read, and a write ends every join in progress so a caller
refreshing after its own mutation is never handed a read that started before it.
A caller passing its own fetch options always gets its own request.
