'use client';
import * as React from 'react';
import { useT } from '../i18n';
import { qrPath } from './qr';

export type QrCodeProps = {
  /** The value to encode (here, an `otpauth://` URI). */
  value: string;
  /** Rendered pixel size of the square. Defaults to 200. */
  size?: number;
};

/**
 * Renders `value` as a QR code, as a single self-contained inline SVG (the QR
 * encoder is bundled, so nothing is fetched - the TOTP secret never leaves the
 * page). Fixed dark-on-white with a quiet-zone margin so it stays scannable in any
 * theme. Returns null if the value can't be encoded (e.g. too long); the caller
 * falls back to manual entry.
 */
export function QrCode({ value, size = 200 }: QrCodeProps) {
  const t = useT();
  const path = React.useMemo(() => qrPath(value), [value]);

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
