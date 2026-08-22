'use client';
import * as React from 'react';
import { useT } from '../i18n';
import type { QrMatrix } from './qr';

export type QrCodeProps = {
  /** The value to encode (here, an `otpauth://` URI). */
  value: string;
  /** Rendered pixel size of the square. Defaults to 200. */
  size?: number;
};

/**
 * Renders `value` as a QR code in a self-contained inline SVG. The encoder loads
 * from the package's own on-demand chunk; `value` is processed locally and never
 * leaves the page. Fixed dark-on-white with a quiet-zone margin so it stays
 * scannable in any theme. Returns null while loading or when the value cannot be
 * encoded, so the caller's manual-entry fallback stays available throughout.
 */
export function QrCode({ value, size = 200 }: QrCodeProps) {
  const t = useT();
  const [path, setPath] = React.useState<QrMatrix | null>(null);

  React.useEffect(() => {
    let active = true;
    setPath(null);
    void import('./qr').then(
      ({ qrPath }) => {
        if (active) setPath(qrPath(value));
      },
      () => {
        if (active) setPath(null);
      },
    );
    return () => {
      active = false;
    };
  }, [value]);

  if (!path) return null;
  const margin = 4; // QR spec (ISO/IEC 18004) quiet zone: 4 modules, so scanners read it on any background
  const dim = path.count + margin * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      role="img"
      aria-label={t('qr.ariaLabel')}
      shapeRendering="crispEdges"
      className="ba-qr"
    >
      <rect width={dim} height={dim} fill="#ffffff" />
      <g transform={`translate(${margin} ${margin})`}>
        <path d={path.d} fill="#000000" />
      </g>
    </svg>
  );
}
