import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, waitFor, within } from 'storybook/test';
import { UserProfile, type UserProfileSection } from '@authowl/react';
import { expectStoryMatrix } from './matrix';

const meta = {
  title: 'Account/UserProfile',
  component: UserProfile,
  render: (args) => (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <UserProfile {...args} />
    </div>
  ),
  args: { section: 'profile' },
} satisfies Meta<typeof UserProfile>;

export default meta;
type Story = StoryObj<typeof meta>;

function sectionStory(section: UserProfileSection): Story {
  return {
    args: { section },
    play: async ({ canvasElement }) => {
      await expectStoryMatrix(canvasElement);
      const canvas = within(canvasElement);
      await waitFor(() => {
        expect(canvas.getByTestId('user-profile').querySelector(`[data-section="${section}"]`)).not.toBeNull();
      });
    },
  };
}

export const Profile = sectionStory('profile');
export const Email = sectionStory('email');
export const Password = sectionStory('password');
export const SocialConnections = sectionStory('social');
export const Sessions = sectionStory('sessions');
export const Passkeys = sectionStory('passkeys');
export const MultiFactor = sectionStory('mfa');
export const Recovery = sectionStory('recovery');
export const DangerZone = sectionStory('danger');

export const Modal: Story = {
  args: { mode: 'modal', section: 'recovery', onClose: () => undefined },
  render: (args) => (
    <div
      data-testid="modal-containing-block"
      style={{ width: 240, height: 64, backdropFilter: 'blur(14px)' }}
    >
      <UserProfile {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole('dialog');
    const containingBlock = canvas.getByTestId('modal-containing-block');
    const bounds = dialog.getBoundingClientRect();
    const layout = dialog.querySelector<HTMLElement>('.ba-profile-layout');
    const navigation = dialog.querySelector<HTMLElement>('.ba-profile-nav');
    expect(containingBlock.contains(dialog)).toBe(false);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(layout).not.toBeNull();
    expect(navigation).not.toBeNull();
    expect(Math.abs(navigation!.getBoundingClientRect().height - layout!.getBoundingClientRect().height))
      .toBeLessThanOrEqual(1);
  },
};

export const WhiteBrandBoundary: Story = {
  ...sectionStory('passkeys'),
  parameters: { authowl: { primaryColor: '#ffffff' } },
};

export const BlackBrandBoundary: Story = {
  ...sectionStory('passkeys'),
  parameters: { authowl: { primaryColor: '#000000' } },
};
