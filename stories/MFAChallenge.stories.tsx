import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { MFAChallenge } from '@authowl/react';
import { slot } from '../packages/auth-react/src/elements';
import { expectStoryMatrix } from './matrix';

// The sign-in second-factor prompt. It renders its initial TOTP step with no
// config/session/network, so both the default and the backup-code fallback (a
// pure client-state switch) render deterministically.
const meta = {
  title: 'Conversion/MFAChallenge',
  component: MFAChallenge,
  render: (args) => (
    <div className={`${slot('card')} ${slot('auth-card')}`}>
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
    // In TOTP mode the first factor chip selects backup codes.
    const useBackup = form.querySelector('.ba-factor-chip');
    expect(useBackup).not.toBeNull();
    await userEvent.click(useBackup as HTMLElement);
    await waitFor(() => {
      expect(form.querySelector('.ba-consent')).toBeNull();
    });
  },
};


export const WithTrustDevice: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await userEvent.click(within(canvasElement).getByRole('checkbox'));
    await expect(within(canvasElement).getByRole('checkbox')).toBeChecked();
  },
};

export const StepUp: Story = {
  args: { variant: 'step-up', onCancel: () => {} },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await expect(within(canvasElement).queryByRole('checkbox')).toBeNull();
  },
};

export const EmailedCode: Story = {
  args: { email: 'mona@example.test' },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const form = await within(canvasElement).findByTestId('mfa-challenge');
    await userEvent.click(form.querySelectorAll('.ba-factor-chip')[1] as HTMLElement);
    await waitFor(() => expect(form.querySelector('.ba-code-status .ba-link-button')).not.toBeNull());
  },
};

export const Verifying: Story = {
  parameters: { authowl: { codePending: true } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await userEvent.type(within(canvasElement).getByRole('textbox'), '123456');
    await waitFor(() => expect(canvasElement.querySelector('.ba-code-status .ba-code-spin')).not.toBeNull());
  },
};

export const InvalidCode: Story = {
  parameters: { authowl: { invalidCode: true } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await userEvent.type(within(canvasElement).getByRole('textbox'), '123456');
    await within(canvasElement).findByRole('alert');
  },
};

export const Verified: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await userEvent.type(within(canvasElement).getByRole('textbox'), '123456');
    await waitFor(() => expect(canvasElement.querySelector('[data-state=success]')).not.toBeNull());
  },
};
