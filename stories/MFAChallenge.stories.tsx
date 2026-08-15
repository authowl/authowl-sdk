import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { MFAChallenge } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

// The sign-in second-factor prompt. It renders its initial TOTP step with no
// config/session/network, so both the default and the backup-code fallback (a
// pure client-state switch) render deterministically.
const meta = {
  title: 'Conversion/MFAChallenge',
  component: MFAChallenge,
  render: (args) => (
    <div style={card}>
      <MFAChallenge {...args} />
    </div>
  ),
} satisfies Meta<typeof MFAChallenge>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default TOTP step, including the "trust this device" affordance.
export const Totp: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    const form = await canvas.findByTestId('mfa-challenge');
    expect(form.querySelector('.ba-consent')).not.toBeNull();
  },
};

// Backup-code fallback: switching factor is client-only and hides the
// trust-device option (never offered on the backup path).
export const BackupCode: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    const form = await canvas.findByTestId('mfa-challenge');
    // In TOTP mode the first link-button is "Use a backup code" (source order:
    // backup, then email-OTP). Select structurally to stay locale-agnostic.
    const useBackup = form.querySelector('.ba-link-button');
    expect(useBackup).not.toBeNull();
    await userEvent.click(useBackup as HTMLElement);
    await waitFor(() => {
      expect(form.querySelector('.ba-consent')).toBeNull();
    });
  },
};
