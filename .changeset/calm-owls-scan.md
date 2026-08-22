---
'@authowl/react': patch
---

Reduce the initial React SDK payload by loading the bundled TOTP QR encoder only when an
enrollment QR code is rendered. The secret is still encoded entirely in the browser, and the
manual-entry fallback remains available while the local chunk loads or if it cannot load.
