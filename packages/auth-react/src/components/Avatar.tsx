'use client';
import * as React from 'react';
import { useSlot } from '../elements';

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

export function Avatar({ name, email, image, profile = false }: {
  name?: string | null; email?: string | null; image?: string | null; profile?: boolean;
}) {
  const slot = useSlot();
  const [failedImage, setFailedImage] = React.useState<string | null>(null);
  const source = name?.trim() || email?.trim() || '○';
  const initial = (segmenter
    ? segmenter.segment(source)[Symbol.iterator]().next().value?.segment
    : Array.from(source)[0])?.toLocaleUpperCase() ?? '○';
  const className = profile ? 'ba-profile-avatar' : 'ba-avatar';
  return image && failedImage !== image ? (
    <img className={slot(className)} src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />
  ) : <span className={slot(`${className} ba-avatar-fallback`)} aria-hidden="true">{initial}</span>;
}
