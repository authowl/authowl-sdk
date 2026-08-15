/** Same-origin custom header that keeps plain HTML forms out of the bridge. */
export const APP_SESSION_BRIDGE_HEADER = 'x-authowl-session-bridge';

type AppSessionCookieNames = Readonly<{ secure: string; local: string }>;

export function appSessionCookieNames(projectId: string): AppSessionCookieNames {
  const suffix = projectId.toLowerCase().replace(/-/g, '');
  return {
    secure: `__Host-authowl_app_${suffix}`,
    local: `authowl_app_${suffix}`,
  };
}
