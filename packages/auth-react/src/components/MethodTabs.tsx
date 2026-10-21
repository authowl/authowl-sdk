'use client';
import * as React from 'react';
import { useT } from '../i18n';
import { useSlot } from '../elements';

import type { TabMethod } from '../signin-methods';
import { AuthCardLock } from './AuthCardLock';
export function MethodTabs({ id, methods, active, labels, onChange }: {
  id: string; methods: TabMethod[]; active: TabMethod;
  labels: Record<TabMethod, { tab: string }>; onChange: (method: TabMethod) => void;
}) {
  const pending = React.useContext(AuthCardLock)?.locked ?? false;
  const slot = useSlot();
  const t = useT();
  const columns = methods.length >= 4 ? Math.ceil(methods.length / 2) : methods.length;
  const index = methods.indexOf(active);
  return (
    <div role="tablist" aria-label={t('signIn.methodsLabel')} className={slot('ba-method-tabs')}
      style={{ '--ao-tab-columns': columns } as React.CSSProperties}>
      <span aria-hidden="true" className={slot('ba-tab-indicator')} style={{
        '--ao-tab-col': index % columns, '--ao-tab-row': Math.floor(index / columns),
      } as React.CSSProperties} />
      {methods.map((method, i) => (
        <button key={method} id={`${id}-tab-${method}`} type="button" role="tab"
          className={slot('ba-method-tab')} aria-selected={active === method}
          aria-disabled={pending && active !== method || undefined}
          aria-controls={`${id}-panel`} tabIndex={active === method ? 0 : -1}
          onClick={() => { if (!pending) onChange(method); }} onKeyDown={(event) => {
            const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
            const delta = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? methods.length - 1 : delta ? (i + delta + methods.length) % methods.length : null;
            if (next === null) return;
            event.preventDefault();
            if (pending) return;
            onChange(methods[next]!);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
          }}>{labels[method].tab}</button>
      ))}
    </div>
  );
}
