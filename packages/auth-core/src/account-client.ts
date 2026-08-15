import type {
  ActionFetchOptions,
  AuthActionResult,
  AuthUser,
  SocialIdTokenOptions,
} from './client';
import type { AuthHttpClient } from './http-client';
import { createAuthActionHelpers } from './http-client';
import {
  getUserMetadata,
  updateUnsafeMetadata,
  type UpdateUnsafeMetadataOptions,
  type UserMetadata,
} from './metadata-client';
import {
  asBoolean,
  asDate,
  asRecord,
  asString,
  asStringArray,
  decodeAuthUser,
  invalidResponse,
  optionalNullableString,
} from './response-schema';

export interface UpdateProfileOptions {
  name?: string;
  image?: string | null;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface ChangeEmailOptions {
  newEmail: string;
  callbackURL?: string;
}

export interface ChangePasswordOptions {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}

export interface ChangePasswordData {
  user: AuthUser;
}

/** Browser-safe metadata for one signed-in session. */
export interface AccountSession {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RevokeSessionOptions {
  sessionId: string;
}

export interface AccountStatusData {
  status: boolean;
}

export interface SocialAccount {
  id: string;
  userId: string;
  providerId: string;
  accountId: string;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
  /** False when disconnecting this provider would remove the last sign-in method. */
  canUnlink: boolean;
}

type LinkedAccountRecord = Omit<SocialAccount, 'canUnlink'>;

export interface LinkSocialOptions {
  provider: string;
  callbackURL?: string;
  errorCallbackURL?: string;
  disableRedirect?: boolean;
  requestSignUp?: boolean;
  scopes?: string[];
  idToken?: SocialIdTokenOptions & { scopes?: string[] };
}

export interface LinkSocialData {
  url: string;
  redirect: boolean;
}

export interface UnlinkSocialOptions {
  providerId: string;
  accountId?: string;
}

export interface DeleteAccountOptions {
  callbackURL?: string;
  password?: string;
  token?: string;
}

export interface DeleteAccountData {
  /**
   * The request was accepted - which is NOT the same as "the account is gone".
   * When deletion is confirmation-gated, `true` means only that a confirmation
   * email went out and the session is still live.
   *
   * That ambiguity is why this call deliberately does not end the local session
   * the way `signOut` does; a real deletion is caught instead by the session read
   * that finds the token dead. See the ending catch in `session-store.ts`.
   */
  success: boolean;
  message: string;
}

export interface AccountClient {
  /** Read public and unsafe metadata for the signed-in user. Private metadata is never returned. */
  getMetadata(
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<UserMetadata>>;
  /** Optimistically apply a JSON Merge Patch to end-user-owned unsafe metadata. */
  updateUnsafeMetadata(
    params: UpdateUnsafeMetadataOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<UserMetadata>>;
  updateProfile(
    params: UpdateProfileOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<AccountStatusData>>;
  changeEmail(
    params: ChangeEmailOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<AccountStatusData>>;
  changePassword(
    params: ChangePasswordOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<ChangePasswordData>>;
  listSessions(
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<AccountSession[]>>;
  revokeSession(
    params: RevokeSessionOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<AccountStatusData>>;
  revokeOtherSessions(
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<AccountStatusData>>;
  listSocialAccounts(
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<SocialAccount[]>>;
  linkSocial(
    params: LinkSocialOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<LinkSocialData>>;
  unlinkSocial(
    params: UnlinkSocialOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<AccountStatusData>>;
  /** Available only when `PublicConfig.accountDeletion` is true. */
  delete(
    params?: DeleteAccountOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<DeleteAccountData>>;
}

export function createAccountClient(
  http: AuthHttpClient,
  notifyMutation: () => void,
): AccountClient {
  const { post, mutation } = createAuthActionHelpers(http, notifyMutation);

  return {
    getMetadata: (fetchOptions) => getUserMetadata(http, fetchOptions),
    updateUnsafeMetadata: (params, fetchOptions) =>
      updateUnsafeMetadata(http, params, fetchOptions),
    updateProfile: (params, fetchOptions) =>
      mutation(post('/update-user', params, fetchOptions, decodeStatus)),
    changeEmail: (params, fetchOptions) =>
      mutation(post('/change-email', params, fetchOptions, decodeStatus)),
    changePassword: (params, fetchOptions) =>
      mutation(post('/change-password', params, fetchOptions, decodeChangePassword)),
    listSessions: (fetchOptions) =>
      http.request<AccountSession[]>('/list-sessions', {
        fetchOptions,
        decode: decodeSessions,
      }),
    revokeSession: ({ sessionId }, fetchOptions) =>
      mutation(post('/revoke-session', { sessionId }, fetchOptions, decodeStatus)),
    revokeOtherSessions: (fetchOptions) =>
      mutation(post('/revoke-other-sessions', {}, fetchOptions, decodeStatus)),
    listSocialAccounts: async (fetchOptions) => {
      const result = await http.request<LinkedAccountRecord[]>('/list-accounts', {
        fetchOptions,
        decode: decodeSocialAccounts,
      });
      if (!result.data) return { data: null, error: result.error };
      const canUnlink = result.data.length > 1;
      return {
        ...result,
        data: result.data
          .filter((account) => account.providerId !== 'credential')
          .map((account) => ({ ...account, canUnlink })),
      };
    },
    linkSocial: (params, fetchOptions) =>
      post<LinkSocialData>('/link-social', params, fetchOptions, decodeLinkSocial),
    unlinkSocial: (params, fetchOptions) =>
      mutation(post('/unlink-account', params, fetchOptions, decodeStatus)),
    delete: (params = {}, fetchOptions) =>
      mutation(post('/delete-user', params, fetchOptions, decodeDeleteAccount)),
  };
}

function decodeStatus(value: unknown): AccountStatusData {
  const row = asRecord(value);
  return { status: asBoolean(row.status) };
}

function decodeChangePassword(value: unknown): ChangePasswordData {
  const row = asRecord(value);
  return { user: decodeAuthUser(row.user) };
}

function decodeSessions(value: unknown): AccountSession[] {
  if (!Array.isArray(value)) invalidResponse();
  return value.map((entry) => {
    const row = asRecord(entry);
    return {
      id: asString(row.id),
      userId: asString(row.userId),
      createdAt: asDate(row.createdAt),
      updatedAt: asDate(row.updatedAt),
      expiresAt: asDate(row.expiresAt),
      ...optionalAccountField('ipAddress', optionalNullableString(row, 'ipAddress')),
      ...optionalAccountField('userAgent', optionalNullableString(row, 'userAgent')),
    };
  });
}

function decodeSocialAccounts(value: unknown): LinkedAccountRecord[] {
  if (!Array.isArray(value)) invalidResponse();
  return value.map((entry) => {
    const row = asRecord(entry);
    return {
      id: asString(row.id),
      userId: asString(row.userId),
      providerId: asString(row.providerId),
      accountId: asString(row.accountId),
      scopes: asStringArray(row.scopes),
      createdAt: asDate(row.createdAt),
      updatedAt: asDate(row.updatedAt),
    };
  });
}

function decodeLinkSocial(value: unknown): LinkSocialData {
  const row = asRecord(value);
  return {
    url: asString(row.url),
    redirect: asBoolean(row.redirect),
  };
}

function decodeDeleteAccount(value: unknown): DeleteAccountData {
  const row = asRecord(value);
  return {
    success: asBoolean(row.success),
    message: asString(row.message),
  };
}

function optionalAccountField<Key extends 'ipAddress' | 'userAgent'>(
  key: Key,
  value: string | null | undefined,
): { [K in Key]?: string | null } {
  return value === undefined ? {} : { [key]: value } as { [K in Key]?: string | null };
}
