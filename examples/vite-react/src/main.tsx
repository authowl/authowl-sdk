import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  AuthOwlProvider,
  GoogleOneTap,
  SignIn,
  SignUp,
  UserButton,
  useUser,
} from '@authowl/react';
import '@authowl/react/styles.css';
import { UserProfilePreview } from './UserProfilePreview';
import { OrganizationPreview } from './OrganizationPreview';

declare global {
  interface Window {
    __authowlDemoRoot?: ReturnType<typeof ReactDOM.createRoot>;
  }
}

const PK = import.meta.env.VITE_AUTHOWL_PUBLISHABLE_KEY as string | undefined;
const API_URL = (import.meta.env.VITE_AUTHOWL_API_URL as string | undefined) ?? 'http://localhost:3010';
// Demo locale switch (B.3): ?locale=ar|en|auto - omitted = the project's server default.
const LOCALE = new URLSearchParams(window.location.search).get('locale') as
  | 'en'
  | 'ar'
  | 'auto'
  | null;
const ARABIC = LOCALE === 'ar';
const PROFILE_PREVIEW = new URLSearchParams(window.location.search).has('profile');
const DARK_PREVIEW = new URLSearchParams(window.location.search).get('theme') === 'dark';
const ORGANIZATION_PREVIEW = new URLSearchParams(window.location.search).get('organizations');

function Page() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [mode, setMode] = React.useState<'in' | 'up'>('in');
  const [signupComplete, setSignupComplete] = React.useState(false);
  const hasLoadedSession = React.useRef(isLoaded);
  if (isLoaded) hasLoadedSession.current = true;
  // A session mutation briefly refreshes useUser. Only the initial load should
  // replace the auth surface, otherwise an in-flight signup ceremony would be
  // unmounted and lose its passkey-completion state.
  if (!hasLoadedSession.current) return <p>{ARABIC ? 'جارٍ التحميل…' : 'Loading…'}</p>;
  // Keep SignUp mounted after its request creates the session. The component
  // still owns the optional passkey-completion step and signals when that
  // ceremony is finished or skipped.
  if (!isSignedIn || (mode === 'up' && !signupComplete)) {
    return (
      <div style={{ maxWidth: 360, margin: '64px auto', fontFamily: 'system-ui' }}>
        {mode === 'in' ? <SignIn /> : <SignUp onSignedUp={() => setSignupComplete(true)} />}
        <p style={{ fontSize: 13, marginTop: 12 }}>
          {mode === 'in' ? (
            <>
              {ARABIC ? 'ليس لديك حساب؟' : 'No account?'}{' '}
              <button
                onClick={() => {
                  setSignupComplete(false);
                  setMode('up');
                }}
              >
                {ARABIC ? 'إنشاء حساب' : 'Sign up'}
              </button>
            </>
          ) : (
            <>
              {ARABIC ? 'لديك حساب؟' : 'Have an account?'}{' '}
              <button onClick={() => setMode('in')}>
                {ARABIC ? 'تسجيل الدخول' : 'Sign in'}
              </button>
            </>
          )}
        </p>
      </div>
    );
  }
  return (
    <div style={{ padding: 32, fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Hello, {user?.email ?? user?.phoneNumber ?? user?.name ?? 'there'}</h1>
        <UserButton />
      </header>
    </div>
  );
}

if (ORGANIZATION_PREVIEW) {
  const root = window.__authowlDemoRoot ?? ReactDOM.createRoot(document.getElementById('root')!);
  window.__authowlDemoRoot = root;
  root.render(<OrganizationPreview locale={ARABIC ? 'ar' : 'en'} dark={DARK_PREVIEW} profile={ORGANIZATION_PREVIEW === 'profile'} />);
} else if (PROFILE_PREVIEW) {
  const root = window.__authowlDemoRoot ?? ReactDOM.createRoot(document.getElementById('root')!);
  window.__authowlDemoRoot = root;
  root.render(<UserProfilePreview locale={ARABIC ? 'ar' : 'en'} dark={DARK_PREVIEW} />);
} else if (!PK) {
  document.getElementById('root')!.innerHTML =
    '<p style="font-family:system-ui;padding:32px">Set <code>VITE_AUTHOWL_PUBLISHABLE_KEY</code> in <code>.env.local</code>.</p>';
} else {
  const root = window.__authowlDemoRoot ?? ReactDOM.createRoot(document.getElementById('root')!);
  window.__authowlDemoRoot = root;
  root.render(
    <React.StrictMode>
      <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} locale={LOCALE ?? undefined}>
        <GoogleOneTap />
        <Page />
      </AuthOwlProvider>
    </React.StrictMode>,
  );
}
