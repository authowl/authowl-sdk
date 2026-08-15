import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, waitFor } from 'storybook/test';
import {
  CreateOrganization,
  OrganizationList,
  OrganizationProfile,
  OrganizationSwitcher,
  type OrganizationProfileSection,
} from '@authowl/react';
import { expectStoryMatrix } from './matrix';

const meta = {
  title: 'Organizations/Management',
  parameters: { docs: { description: { component: 'Drop-in organization switching and lifecycle surfaces backed by the preview API fixture.' } } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const frame = (children: React.ReactNode, width = 920, surface = false) => (
  <div style={{ maxWidth: width, margin: '0 auto', ...(surface ? { background: 'var(--ba-surface)', color: 'var(--ba-fg)', border: '1px solid var(--ba-border)', borderRadius: 14, overflow: 'hidden' } : {}) }}>{children}</div>
);

export const Switcher: Story = {
  render: () => frame(<div style={{ display: 'flex', justifyContent: 'flex-end' }}><OrganizationSwitcher /></div>),
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('.ba-organization-switcher')).not.toBeNull());
  },
};

export const Directory: Story = {
  render: () => frame(<OrganizationList />, 960),
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('.ba-organization-directory')).not.toBeNull());
  },
};

export const Create: Story = {
  render: () => frame(<CreateOrganization />, 920, true),
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('.ba-organization-create')).not.toBeNull());
  },
};

function profileStory(defaultSection: OrganizationProfileSection): Story {
  return {
    render: () => frame(<OrganizationProfile defaultSection={defaultSection} />, 920, true),
    play: async ({ canvasElement }) => {
      await expectStoryMatrix(canvasElement);
      await waitFor(() => expect(canvasElement.querySelector('.ba-organization-profile')).not.toBeNull());
    },
  };
}

export const General = profileStory('general');
export const Members = profileStory('members');
export const Invitations = profileStory('invitations');
export const DangerZone = profileStory('danger');
