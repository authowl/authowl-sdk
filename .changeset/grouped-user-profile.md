---
'@authowl/react': major
'@authowl/core': minor
---

Group UserProfile into Profile, Security, Connected accounts and Privacy with compact summary rows, an identity sidebar, container-responsive navigation and an SDK-owned phone modal sheet. Add English and Modern Standard Arabic group subtitles and action labels, and regenerate the Dart catalog.

Included in the unreleased React major. DOM-contract changes for the migration guide: per-section navigation buttons become group anchors with aria-current="page"; group content contains every available section in order; Edit/Manage opens each existing form inline. Closing a row unmounts its workflow. Section hashes and section props keep their existing identifiers, with deep links focusing the requested heading. New profile row, identity, group-heading and sheet-handle appearance slots emit both ao- and ba- classes. The modal uses a 92dvh bottom sheet only at viewport widths of 480px or less; navigation changes at a 640px container width. See docs/react-appearance-migration.md for the complete contract.
