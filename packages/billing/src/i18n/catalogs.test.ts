import { describe, expect, it } from 'vitest';
import { ar } from './ar';
import { en } from './en';
import { billingMessageKeys, billingMessages } from './runtime';

describe('billing message catalogs', () => {
  it('keeps the compact runtime catalogs aligned with the typed source catalogs', () => {
    expect(billingMessageKeys.map((key, index) => [key, billingMessages.en[index]]))
      .toEqual(Object.entries(en));
    expect(billingMessageKeys.map((key, index) => [key, billingMessages.ar[index]]))
      .toEqual(Object.entries(ar));
  });
});
