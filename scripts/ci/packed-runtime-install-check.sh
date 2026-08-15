#!/usr/bin/env bash
# Tarball-install proof. Packs the React publishable packages and installs them
# into a throwaway consumer the way a real user would, from tarballs rather
# than workspace links.
#
# Uses `pnpm pack` (rewrites the `workspace:*` @authowl/core dep to a real
# version) then `npm install` (mirrors a plain consumer and produces a
# package-lock.json to grep). Run AFTER `pnpm run build`.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$root" || exit 1

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/tgz"

echo "packing tarballs (core + react)..."
if [ -n "${AUTHOWL_PREPACKED_DIR:-}" ]; then
  cp \
    "$AUTHOWL_PREPACKED_DIR"/authowl-core-*.tgz \
    "$AUTHOWL_PREPACKED_DIR"/authowl-react-*.tgz \
    "$WORK/tgz/"
else
  for p in core react; do
    (cd "packages/auth-$p" && pnpm pack --pack-destination "$WORK/tgz" >/dev/null)
  done
fi
CORE_TGZ="$(ls "$WORK"/tgz/authowl-core-[0-9]*.tgz)"
# Keep this pattern version-specific so it does not also select the
# authowl-react-native tarball when the full release set is prepacked.
REACT_TGZ="$(ls "$WORK"/tgz/authowl-react-[0-9]*.tgz)"

# @authowl/react's dependency on @authowl/core is forced to the local core
# tarball via overrides, so nothing resolves against the (unpublished) registry.
cat > "$WORK/package.json" <<JSON
{
  "name": "authowl-packed-install-check",
  "private": true,
  "dependencies": {
    "@authowl/core": "file:$CORE_TGZ",
    "@authowl/react": "file:$REACT_TGZ",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "5.9.3"
  },
  "overrides": { "@authowl/core": "file:$CORE_TGZ" }
}
JSON

echo "installing into throwaway consumer..."
install_consumer() {
  (cd "$WORK" && npm install --no-audit --no-fund --loglevel=error)
}
if ! install_consumer; then
    echo "packed-runtime-install-check: npm install failed; retrying once..."
  install_consumer || {
    echo "packed-runtime-install-check: FAILED (npm install errored twice)"; exit 1;
  }
fi

echo "importing the packed runtime..."
# shellcheck disable=SC2016
(cd "$WORK" && node --input-type=module -e '
  const core = await import("@authowl/core");
  const react = await import("@authowl/react");
  const key = "pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789";
  let revokeBody;
  const backendToken = `h.${Buffer.from(JSON.stringify({
    sub: "user-packed",
    exp: Math.floor(Date.now() / 1000) + 900
  })).toString("base64url")}.s`;
  const fetchImpl = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/get-session")) {
      return Response.json({
        session: {
          id: "session-packed",
          userId: "user-packed",
          token: "durable-session-sentinel",
          expiresAt: "2026-08-01T00:00:00.000Z"
        },
        user: {
          id: "user-packed",
          email: "packed@example.test",
          emailVerified: true,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z"
        }
      });
    }
    if (path.endsWith("/list-sessions")) {
      return Response.json([{
        id: "session-packed",
        userId: "user-packed",
        token: "durable-list-sentinel",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-08-01T00:00:00.000Z"
      }]);
    }
    if (path.endsWith("/revoke-session")) {
      revokeBody = JSON.parse(String(init?.body));
      return Response.json({ status: true });
    }
    if (path.endsWith("/token")) return Response.json({ token: backendToken });
    throw new Error(`unexpected packed request: ${path}`);
  };
  const client = core.createAuthOwlClient(core.resolveConfig({
    publishableKey: key,
    apiUrl: "https://auth.example.test",
    fetch: fetchImpl
  }));
  if (
    typeof client.signIn?.email !== "function" ||
    typeof client.sessionStore?.subscribe !== "function" ||
    typeof client.sessionStore?.getSnapshot !== "function" ||
    typeof client.account?.updateProfile !== "function" ||
    typeof client.organization?.list !== "function"
  ) {
    throw new Error("packed AuthOwl client surface is incomplete");
  }
  for (const component of [
    "OrganizationSwitcher",
    "OrganizationList",
    "CreateOrganization",
    "OrganizationProfile",
    "GoogleOneTap"
  ]) {
    if (typeof react[component] !== "function") {
      throw new Error(`packed React surface is missing ${component}`);
    }
  }
  const current = await client.getSession();
  const sessions = await client.account.listSessions();
  await client.account.revokeSession({ sessionId: "session-packed" });
  const minted = await client.getToken();
  if (
    !current.data?.session ||
    "token" in current.data.session ||
    !sessions.data?.[0] ||
    "token" in sessions.data[0] ||
    revokeBody?.sessionId !== "session-packed" ||
    minted !== backendToken
  ) {
    throw new Error("packed browser session contract is not token-free");
  }
') || {
  echo "packed-runtime-install-check: FAILED (packed runtime import errored)"; exit 1;
}

cat > "$WORK/proof.ts" <<'TS'
import {
  createAuthOwlClient,
  resolveConfig,
  type AccountSession,
  type AuthSession,
  type AuthUser,
  type ChangePasswordData,
  type EmailAuthData,
  type EmailSignUpData,
  type PhoneOtpVerifyData,
  type SocialAuthData,
  type TwoFactorVerifyData,
} from '@authowl/core';

const now = new Date();
const user: AuthUser = {
  id: 'user-packed',
  email: 'packed@example.test',
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
};
const session: AuthSession = {
  id: 'session-packed',
  userId: user.id,
  expiresAt: now,
};
const listed: AccountSession = {
  ...session,
  createdAt: now,
  updatedAt: now,
};
const signIn: EmailAuthData = { redirect: false, user };
const signUp: EmailSignUpData = { sessionCreated: true, user };
const social: SocialAuthData = { redirect: false, user };
const phone: PhoneOtpVerifyData = {
  status: true,
  sessionCreated: true,
  user: {
    id: user.id,
    phoneNumber: '01000000000',
    phoneNumberVerified: true,
  },
};
const twoFactor: TwoFactorVerifyData = { status: true };
const changed: ChangePasswordData = { user };
void [listed, signIn, signUp, social, phone, twoFactor, changed];

// @ts-expect-error Durable browser session tokens are intentionally absent.
void session.token;
// @ts-expect-error Session lists expose stable ids, not durable tokens.
void listed.token;
// @ts-expect-error Sign-in actions issue the session through Set-Cookie only.
void signIn.token;
// @ts-expect-error Signup uses the explicit sessionCreated discriminant.
void signUp.token;
// @ts-expect-error Social ID-token exchange never projects the durable session token.
void social.token;
// @ts-expect-error Phone verification never projects the durable session token.
void phone.token;
// @ts-expect-error MFA verification never projects the durable session token.
void twoFactor.token;
// @ts-expect-error Password changes never project the durable session token.
void changed.token;

const client = createAuthOwlClient(resolveConfig({
  publishableKey: 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789',
  apiUrl: 'https://auth.example.test',
}));
void client.account.revokeSession({ sessionId: session.id });
// @ts-expect-error Browser session revocation accepts an owned session id only.
void client.account.revokeSession({ token: 'durable-session-token' });
const backendJwt: Promise<string | null> = client.getToken({ template: 'convex' });
void backendJwt;
TS
cat > "$WORK/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["proof.ts"]
}
JSON
(cd "$WORK" && npx --no-install tsc -p tsconfig.json)

if [ ! -f "$WORK/package-lock.json" ]; then
  echo "packed-runtime-install-check: FAILED (no package-lock.json produced)"
  exit 1
fi

echo "packed-runtime-install-check: OK"
