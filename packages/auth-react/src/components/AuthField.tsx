'use client';
import * as React from 'react';
import { useSlot } from '../elements';

/** Native input props with the shared authentication label and input slots. */
export function AuthField({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  const slot = useSlot();
  return <label className={slot('ba-label')}>{label}<input {...props} className={slot('ba-input')} /></label>;
}
