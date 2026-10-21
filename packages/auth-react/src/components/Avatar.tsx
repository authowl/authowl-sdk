'use client';
import * as React from 'react';
import { useSlot } from '../elements';

export function Avatar({ name, email, image, profile = false }: {
  name?: string | null; email?: string | null; image?: string | null; profile?: boolean;
}) {
  const slot = useSlot();
  const [failedImage, setFailedImage] = React.useState<string | null>(null);
  const source = name?.trim() || email?.trim() || '○';
  const initial = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source)[Symbol.iterator]().next().value?.segment ?? '○';
  const className = profile ? 'ba-profile-avatar' : 'ba-avatar';
  return image && failedImage !== image ? (
    <img className={slot(className)} src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />
  ) : <span className={slot(`${className} ba-avatar-fallback`)} aria-hidden="true">{initial}</span>;
}
