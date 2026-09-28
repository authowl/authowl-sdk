// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({
  inspect:vi.fn(),accept:vi.fn(),signOut:vi.fn(),
  user:{isLoaded:true,isSignedIn:false,user:null as null|{email:string;emailVerified:boolean}},
  config:{environmentId:'project-a'},
}));
const client={applicationInvitations:{inspect:mocks.inspect,accept:mocks.accept}};
vi.mock('./hooks',()=>({useAuthClient:()=>client,usePublicConfig:()=>({config:mocks.config}),useUser:()=>mocks.user,useSignOut:()=>({signOut:mocks.signOut})}));
vi.mock('./provider',()=>({useAuthOwlContext:()=>({locale:'en'})}));
vi.mock('./components/MFARequiredGate',()=>({MFARequiredGate:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock('./components/SignUp',()=>({SignUp:({initialEmail,applicationInvitationProof}:{initialEmail:string;applicationInvitationProof:string})=><p data-testid="signup">{initialEmail}:{applicationInvitationProof?'proof-present':'missing'}</p>}));
vi.mock('./components/SignIn',()=>({SignIn:()=><p>Sign in form</p>}));
import { AcceptApplicationInvitation } from './components/AcceptApplicationInvitation';
const proof=`12345678-1234-1234-1234-123456789abc.${'a'.repeat(43)}`;
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();window.history.replaceState({},'',`/join#authowl_application_invitation_proof=${proof}`);mocks.user={isLoaded:true,isSignedIn:false,user:null};mocks.inspect.mockResolvedValue({data:{email:'recipient@example.com',status:'pending',expiresAt:new Date('2030-01-01')},error:null});mocks.accept.mockResolvedValue({data:{accepted:true},error:null});});
afterEach(cleanup);
it('inspects proof before showing signup, passes the recipient proof and offers ordinary sign-in',async()=>{
  render(<AcceptApplicationInvitation/>);
  expect((await screen.findByTestId('signup')).textContent).toBe('recipient@example.com:proof-present');
  expect(window.location.hash).toBe('');
  fireEvent.click(screen.getByText('Already have an account? Sign in'));
  expect(screen.getByText('Sign in form')).toBeTruthy();
});
it('shows invalid invitations without a signup form',async()=>{
  mocks.inspect.mockResolvedValue({data:null,error:{status:400,code:'INVALID_APPLICATION_INVITATION'}});
  render(<AcceptApplicationInvitation/>);
  await screen.findByRole('alert');expect(screen.queryByTestId('signup')).toBeNull();
});
it('requires switching from a wrong account and never calls accept',async()=>{
  mocks.user={isLoaded:true,isSignedIn:true,user:{email:'wrong@example.com',emailVerified:true}};
  render(<AcceptApplicationInvitation/>);
  fireEvent.click(await screen.findByRole('button',{name:/sign out/i}));expect(mocks.signOut).toHaveBeenCalledOnce();expect(mocks.accept).not.toHaveBeenCalled();
});
it('clears proof and calls completion only after successful acceptance',async()=>{
  mocks.user={isLoaded:true,isSignedIn:true,user:{email:'recipient@example.com',emailVerified:true}};
  const done=vi.fn();render(<AcceptApplicationInvitation onJoined={done}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Continue to the application'}));
  await waitFor(()=>expect(done).toHaveBeenCalledOnce());
  expect(mocks.accept).toHaveBeenCalledWith(proof);expect(localStorage.getItem('authowl.application-invitation:project-a')).toBeNull();
});
