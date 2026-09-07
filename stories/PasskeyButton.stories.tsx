import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';
import { PasskeyButton } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

// Explicit passkey (WebAuthn) sign-in button. The click ceremony is a real
// browser prompt and is out of scope for a static story.
//
// It DOES depend on config: WebAuthn validates the relying-party id against the
// calling page, so the button hides itself where the ceremony cannot run - the
// same question <SignIn/> asks before offering it. `passkeyReachable` gives this
// story a relying party covering the story host, which is what a correctly
// configured project looks like.
//
// The off-host half (the button renders nothing) is pinned in
// packages/auth-react/src/components/PasskeyButton.test.tsx rather than here:
// stories share one publishable key, so a resolved config carries across them
// and an absence assertion would depend on story order.
const meta = {
  title: 'Conversion/PasskeyButton',
  component: PasskeyButton,
  parameters: { authowl: { signedIn: false, passkeyReachable: true } },
  render: (args) => (
    <div style={card}>
      <PasskeyButton {...args} />
    </div>
  ),
} satisfies Meta<typeof PasskeyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId('passkey-button')).resolves.toBeTruthy();
  },
};
