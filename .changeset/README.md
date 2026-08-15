# Changesets

Add a changeset for every user-visible package change:

```bash
pnpm changeset
```

Choose the affected packages and semantic version bump. The release owner
applies pending changesets with `pnpm version-packages`. Do not edit generated
changelogs by hand.
