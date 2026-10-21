// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MethodTabs } from './MethodTabs';

vi.mock('../i18n', () => ({ useT: () => (key: string) => key }));
afterEach(cleanup);
const methods = ['password', 'magic', 'otp', 'sso', 'passkey'] as const;
const labels = { password: 'Password', magic: 'Email link', otp: 'Email code', sso: 'SSO', passkey: 'Passkey' };
function Tabs() {
  const [active, setActive] = React.useState<(typeof methods)[number]>('password');
  return <MethodTabs id="test" methods={[...methods]} active={active} labels={labels} onChange={setActive} />;
}
describe('method tabs keyboard', () => {
  it.each(['ltr', 'rtl'])('activates and focuses in %s visual order, including wrapping and Home/End', (direction) => {
    const computed = window.getComputedStyle.bind(window);
    const style = vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => new Proxy(computed(node), { get: (target, key) => key === 'direction' ? direction : Reflect.get(target, key) }));
    render(<Tabs />);
    const tabs = screen.getAllByRole('tab');
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([tabs[1]]);
    fireEvent.keyDown(tabs[1]!, { key: 'End' });
    expect(document.activeElement).toBe(tabs[4]);
    fireEvent.keyDown(tabs[4]!, { key: direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0]!, { key: 'End' });
    fireEvent.keyDown(tabs[4]!, { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
    style.mockRestore();
  });
});
