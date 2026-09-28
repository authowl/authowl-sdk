import type { AuthHttpClient } from './http-client';
import { asRecord, asString, asDate, invalidResponse } from './response-schema';
import { localStore, readFrom, writeTo } from './web-storage';

export type ApplicationInvitationDetails = { email: string; status: 'pending' | 'accepted'; expiresAt: Date };
/** Recipient operations are separate from the server-only management API. */
export function createApplicationInvitationClient(http: AuthHttpClient) {
  return {
    inspect: (proof: string) => http.request('/application-invitations/inspect', {
      method: 'POST', body: { proof }, decode(value): ApplicationInvitationDetails {
        const row = asRecord(value);
        if (row.status !== 'pending' && row.status !== 'accepted') invalidResponse();
        return { email: asString(row.email), status: row.status, expiresAt: asDate(row.expiresAt) };
      },
    }),
    accept: (proof: string) => http.request('/application-invitations/accept', {
      method: 'POST', body: { proof }, decode(value): { accepted: true } {
        if (asRecord(value).accepted !== true) invalidResponse();
        return { accepted: true };
      },
    }),
  };
}

const proofPattern = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i;
/** Scope persisted intent to an application environment. Proof never belongs in a query. */
export function captureApplicationInvitationProof(environment: string): string | null {
  const key = `authowl.application-invitation:${environment}`;
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const proof = fragment.get('authowl_application_invitation_proof');
  if (proof !== null || url.searchParams.has('authowl_application_invitation')) {
    fragment.delete('authowl_application_invitation_proof');
    url.hash = fragment.toString();
    url.searchParams.delete('authowl_application_invitation');
    try { window.history.replaceState(window.history.state, '', url.toString()); } catch { /* Restricted history. */ }
    writeTo(localStore(), key, proof && proofPattern.test(proof) ? proof : null);
    return proof && proofPattern.test(proof) ? proof : null;
  }
  const stored = readFrom(localStore(), key);
  return stored && proofPattern.test(stored) ? stored : null;
}
export function clearApplicationInvitationProof(environment: string) {
  writeTo(localStore(), `authowl.application-invitation:${environment}`, null);
}
