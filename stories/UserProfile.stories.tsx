import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
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
function groupStory(group: 'security' | 'connections', section: UserProfileSection): Story {
  return {
    args: { section: undefined },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      const nav = await canvas.findByRole('navigation');
      const link = nav.querySelector<HTMLAnchorElement>(`a[href="#authowl-profile-${section}"]`)!;
      await userEvent.click(link);
      await waitFor(() => expect(canvasElement.querySelector(`[data-group="${group}"]`)).not.toBeNull());
      expect(canvasElement.querySelectorAll('[aria-expanded="true"]')).toHaveLength(0);
      await expectStoryMatrix(canvasElement);
    },
  };
}

export const Security = groupStory('security', 'password');
export const ConnectedAccounts = groupStory('connections', 'social');
export const Email = sectionStory('email');
export const Password = sectionStory('password');
export const SocialConnections = sectionStory('social');
export const Sessions = sectionStory('sessions');
export const Passkeys = sectionStory('passkeys');
export const MultiFactor = sectionStory('mfa');
export const Recovery = sectionStory('recovery');
export const Privacy: Story = {
  ...sectionStory('privacy'),
  parameters: { authowl: { privacyEnabled: true } },
};
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
    await canvas.findByRole('navigation');
    const bounds = dialog.getBoundingClientRect();
    const layout = dialog.querySelector<HTMLElement>('.ba-profile-layout');
    const navigation = dialog.querySelector<HTMLElement>('.ba-profile-nav');
    expect(containingBlock.contains(dialog)).toBe(false);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(layout).not.toBeNull();
    expect(navigation).not.toBeNull();
    if (bounds.width > 640) {
      expect(Math.abs(navigation!.getBoundingClientRect().height - layout!.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
    } else {
      expect(getComputedStyle(navigation!).flexDirection).toBe('row');
      expect(getComputedStyle(dialog.querySelector('.ao-profile-identity')!).display).toBe('none');
    }
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

// Runs in all locale/theme projects and in the 390px phone project.
export const PhoneSheet: Story = {
  args: { mode: 'modal', section: 'password', onClose: () => undefined },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const dialog = await within(canvasElement).findByRole('dialog');
    await within(dialog).findByRole('navigation');
    const style = getComputedStyle(dialog);
    const bounds = dialog.getBoundingClientRect();
    if (window.innerWidth <= 480) {
      expect(Math.abs(bounds.width - window.innerWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds.bottom - window.innerHeight)).toBeLessThanOrEqual(1);
      expect(bounds.height).toBeLessThanOrEqual(window.innerHeight * 0.92 + 1);
      expect(style.overflowY).toBe('auto');
      expect(style.borderEndStartRadius).toBe('0px');
      expect(parseFloat(style.borderStartStartRadius)).toBeGreaterThan(0);
      expect(getComputedStyle(dialog.querySelector('.ao-profile-sheet-handle')!).display).toBe('block');
    } else {
      expect(Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2)).toBeLessThanOrEqual(1);
      expect(getComputedStyle(dialog.querySelector('.ao-profile-sheet-handle')!).display).toBe('none');
    }
  },
};

export const NarrowContainer: Story = {
  ...sectionStory('password'),
  render: (args) => <div style={{ width: 420, maxWidth: '100%', margin: '0 auto' }}><UserProfile {...args} /></div>,
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const nav = await within(canvasElement).findByRole('navigation');
    expect(getComputedStyle(nav).flexDirection).toBe('row');
    expect(getComputedStyle(nav).overflowX).toBe('auto');
    expect(getComputedStyle(nav.querySelector('.ao-profile-identity')!).display).toBe('none');
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(4);
    links[0]!.focus();
    await userEvent.tab();
    expect(links[1]).toHaveFocus();
  },
};
