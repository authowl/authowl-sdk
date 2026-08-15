#!/usr/bin/env bash
# Published package boundary guard. Run after `pnpm run build`.
#
# Checks the React client boundary and the contents of every package tarball.
set -uo pipefail
cd "$(dirname "$0")/../.."

fail=0
err() { echo "  FAIL: $*"; fail=1; }

echo "[1/2] React bundle preserves the Next.js client boundary..."
for bundle in packages/auth-react/dist/index.js packages/auth-react/dist/index.cjs; do
  head -n 3 "$bundle" | grep -Eq "^[\"']use client[\"'];$" || err "$bundle is missing its use client directive"
done

echo "[2/2] tarball contents (LICENSE and THIRD_PARTY_NOTICES.md present, no *.map)..."
for pkg in packages/*/; do
  [ -f "${pkg}package.json" ] || continue
  files=$( (cd "$pkg" && npm pack --dry-run --json 2>/dev/null) | node -e '
    let d="";
    process.stdin.on("data",c=>d+=c).on("end",()=>{
      try { const a=JSON.parse(d); console.log((a[0].files||[]).map(x=>x.path).join("\n")); }
      catch { process.exit(0); }
    });
  ' )
  echo "$files" | grep -qx "LICENSE" || err "${pkg} tarball missing LICENSE"
  echo "$files" | grep -qx "THIRD_PARTY_NOTICES.md" || err "${pkg} tarball missing THIRD_PARTY_NOTICES.md"
  if echo "$files" | grep -qE "\.map$"; then err "${pkg} tarball contains a .map file"; fi
done

if [ "$fail" -ne 0 ]; then echo "package-boundary-check: FAILED"; exit 1; fi
echo "package-boundary-check: OK"
