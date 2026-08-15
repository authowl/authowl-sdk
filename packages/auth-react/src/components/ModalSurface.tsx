'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';

const useClientLayoutEffect = typeof document === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function ModalSurface({
  overlayClassName,
  panelClassName,
  labelledBy,
  testId,
  returnFocusRef,
  onClose,
  children,
}: {
  overlayClassName: string;
  panelClassName: string;
  labelledBy: string;
  testId?: string;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ownerRef = React.useRef<HTMLSpanElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const returnFocusRefRef = React.useRef(returnFocusRef);
  onCloseRef.current = onClose;
  returnFocusRefRef.current = returnFocusRef;

  // A fixed element is positioned against the nearest transformed, filtered,
  // or contained ancestor instead of the viewport. UserButton commonly lives
  // in a sticky, backdrop-filtered app header, which otherwise centers a tall
  // account dialog inside that short header and clips it above the page.
  // Portal to the provider root so the modal escapes host layout ancestors
  // while retaining the provider's scoped theme variables, locale, and dir.
  useClientLayoutEffect(() => {
    setPortalTarget(ownerRef.current?.closest<HTMLElement>('.authowl-root') ?? document.body);
  }, []);

  React.useEffect(() => {
    if (!portalTarget) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      const returnTarget = returnFocusRefRef.current?.current ?? previousFocus;
      window.setTimeout(() => returnTarget?.focus(), 0);
    };
  }, [portalTarget]);

  const surface = (
    <div className={overlayClassName} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={panelRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );

  return (
    <>
      <span ref={ownerRef} hidden aria-hidden="true" />
      {portalTarget ? createPortal(surface, portalTarget) : null}
    </>
  );
}
