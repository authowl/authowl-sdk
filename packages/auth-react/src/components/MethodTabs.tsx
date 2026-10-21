'use client';
import * as React from 'react';
import { useT } from '../i18n';
import { useSlot } from '../elements';

type Method = 'password' | 'magic' | 'otp' | 'sso' | 'passkey';
export function MethodTabs({ id, methods, active, labels, onChange }: {
  id: string; methods: Method[]; active: Method | undefined;
  labels: Record<Method, string>; onChange: (method: Method) => void;
}) {
  const slot = useSlot();
  const t = useT();
  const columns = methods.length >= 4 ? Math.ceil(methods.length / 2) : methods.length;
  const index = Math.max(0, methods.indexOf(active!));
  return (
    <div role="tablist" aria-label={t('signIn.methodsLabel')} className={slot('ba-method-tabs')}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      <span aria-hidden="true" className={slot('ba-tab-indicator')} style={{
        width: `calc((100% - 8px) / ${columns})`,
        insetInlineStart: `calc(4px + (100% - 8px) * ${index % columns} / ${columns})`,
        insetBlockStart: `${4 + Math.floor(index / columns) * 32}px`,
      }} />
      {methods.map((method, i) => (
        <button key={method} id={`${id}-tab-${method}`} type="button" role="tab"
          className={slot('ba-method-tab')} aria-selected={active === method}
          aria-controls={`${id}-panel-${method}`} tabIndex={active === method ? 0 : -1}
          onClick={() => onChange(method)} onKeyDown={(event) => {
            const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
            const delta = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? methods.length - 1 : delta ? (i + delta + methods.length) % methods.length : null;
            if (next === null) return;
            event.preventDefault();
            onChange(methods[next]!);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
          }}>{labels[method]}</button>
      ))}
    </div>
  );
}
