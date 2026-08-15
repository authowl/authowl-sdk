import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';
import { PasskeyButton } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

// Explicit passkey (WebAuthn) sign-in button. It owns no config/session state,
// so it renders deterministically; the click ceremony is a real browser prompt
// and is out of scope for a static story.
const meta = {
  title: 'Conversion/PasskeyButton',
  component: PasskeyButton,
  parameters: { authowl: { signedIn: false } },
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
