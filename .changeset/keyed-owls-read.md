---
"@authowl/next": patch
---

`auth()` now throws a configuration error when it finds an app-origin bridge
cookie but has no secret key, instead of presenting the session token unkeyed.
Configure the same `AUTHOWL_SECRET_KEY` the bridge requires where `auth()`
runs, through the env or `initAuth({ secretKey })`. Removing both the bridge
and the key surfaces this error for users still carrying a bridge cookie until
it expires.
