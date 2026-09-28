/** @vitest-environment jsdom */
import { beforeEach, expect, it } from 'vitest';
import { captureApplicationInvitationProof, clearApplicationInvitationProof } from './application-invitations';
const proof = `12345678-1234-1234-1234-123456789abc.${'a'.repeat(43)}`;
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/join'); });
it('captures only its fragment, strips it and persists intent across redirects within one environment', () => {
  window.history.replaceState({}, '', `/join?authowl_application_invitation=id&theme=dark#authowl_application_invitation_proof=${proof}&tab=1`);
  expect(captureApplicationInvitationProof('project-a')).toBe(proof);
  expect(window.location.search).toBe('?theme=dark');
  expect(window.location.hash).toBe('#tab=1');
  window.history.replaceState({}, '', '/join');
  expect(captureApplicationInvitationProof('project-a')).toBe(proof);
  expect(captureApplicationInvitationProof('project-b')).toBeNull();
  clearApplicationInvitationProof('project-a');
  expect(captureApplicationInvitationProof('project-a')).toBeNull();
});
it('does not reuse a previous invitation when a new malformed link arrives', () => {
  window.history.replaceState({}, '', `/join#authowl_application_invitation_proof=${proof}`);
  captureApplicationInvitationProof('a');
  window.history.replaceState({}, '', '/join?authowl_application_invitation=other#authowl_application_invitation_proof=invalid');
  expect(captureApplicationInvitationProof('a')).toBeNull();
  expect(window.location.hash).toBe('');
});
