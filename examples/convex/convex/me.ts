import { query } from './_generated/server';

/**
 * The acceptance probe: returns the AuthOwl identity Convex extracted from the
 * verified JWT, or null when the request carries no (valid) token.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return {
      // `subject` is the JWT `sub` = the AuthOwl user id. Optional claims are
      // coerced to null: Convex return values cannot carry `undefined` fields.
      userId: identity.subject,
      email: identity.email ?? null,
      name: identity.name ?? null,
    };
  },
});
