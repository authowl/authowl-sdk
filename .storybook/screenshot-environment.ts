// Imported first by preview.tsx: hooks run too late for module-level fixtures.
// Only Date is replaced; browser timers, performance and animations keep real time.
if (import.meta.env.AUTHOWL_SCREENSHOTS === '1') {
  const RealDate = globalThis.Date;
  // Keep the preview's July fixtures in the past and pending invitations unexpired.
  const now = RealDate.parse('2026-07-15T10:00:00.000Z');
  globalThis.Date = new Proxy(RealDate, {
    apply: () => new RealDate(now).toString(),
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length === 0 ? [now] : args, newTarget),
    get: (target, property, receiver) =>
      property === 'now' ? () => now : Reflect.get(target, property, receiver),
  });
}
