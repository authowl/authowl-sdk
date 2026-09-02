/** Same-origin custom header that keeps plain HTML forms out of the bridge. */
export const APP_SESSION_BRIDGE_HEADER = 'x-authowl-session-bridge';

/** Server-only proof waiver for replaying a validated app bridge cookie. */
export const AUTHOWL_SECRET_KEY_HEADER = 'x-authowl-secret-key';

// A DoS ceiling only, deliberately generous and NOT a format assertion. The
// engine owns bridge-code shape; the SDK must forward that credential opaquely
// so an engine policy change cannot silently stop every bridge deployment.
export const APP_SESSION_BRIDGE_CODE_MAX_LENGTH = 4_096;

type AppSessionCookieNames = Readonly<{ secure: string; local: string }>;

export function appSessionCookieNames(projectId: string): AppSessionCookieNames {
  const suffix = projectId.toLowerCase().replace(/-/g, '');
  return {
    secure: `__Host-authowl_app_${suffix}`,
    local: `authowl_app_${suffix}`,
  };
}
