import type { SVGProps } from 'react';

export const codeIconAttributes = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
} as const satisfies SVGProps<SVGSVGElement>;

export function FactorIcon({ factor }: { factor: 'totp' | 'backup' | 'otp' }) {
  return <svg {...codeIconAttributes} width="13" height="13">
    {factor === 'totp' ? <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M11 17h2" /></>
      : factor === 'backup' ? <><path d="M7 11V8a5 5 0 0 1 10 0v3" /><rect x="5" y="11" width="14" height="10" rx="2" /></>
        : <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>}
  </svg>;
}
