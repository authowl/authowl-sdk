---
'@authowl/core': patch
---

Teach the conformance corpus the `roles` claim, and the five relying-party ports with it.

The engine publishes every role a member holds and the JS SDK was fixed to gate
on the set. The Go, Python, PHP, Rust and Dart ports were never taught it, and
neither was the corpus that exists to keep every SDK identical - so the same
member got `has(role: 'editor')` true from a JS frontend and false from any
other backend.
