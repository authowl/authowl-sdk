'use client';
import * as React from 'react';
import type { AuthActionResult } from '@authowl/core';
import { useServerError } from '../../i18n';

export function useAccountResource<T>(
  loader: () => Promise<AuthActionResult<T>>,
  failure: string,
) {
  const loaderRef = React.useRef(loader);
  loaderRef.current = loader;
  const failureRef = React.useRef(failure);
  failureRef.current = failure;
  const toServerError = useServerError();
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const requestRef = React.useRef(0);

  const load = React.useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await loaderRef.current();
      if (request !== requestRef.current) return;
      if (result.error) {
        setError(toServerError(result.error, failureRef.current));
        return;
      }
      setData(result.data);
      setError(null);
    } catch {
      if (request !== requestRef.current) return;
      setError(failureRef.current);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [toServerError]);

  React.useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  return { data, error, loading, load };
}
