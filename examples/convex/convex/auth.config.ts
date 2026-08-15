/**
 * Tells the Convex deployment to trust your AuthOwl project's JWTs (verified
 * statelessly against the project's published JWKS - Convex never calls
 * AuthOwl at request time). All three values come from your project's
 * public config `jwtIssuer` block; enable Settings -> JWT issuer first.
 *
 * Convex reads env vars from the DEPLOYMENT (npx convex env set ...), not
 * from Vite: set AUTHOWL_ISSUER_URL and AUTHOWL_PROJECT_ID there.
 */
export default {
  providers: [
    {
      type: 'customJwt',
      issuer: process.env.AUTHOWL_ISSUER_URL!, // <jwtIssuer.issuer>
      jwks: `${process.env.AUTHOWL_ISSUER_URL!}/jwks`, // <jwtIssuer.jwksUrl>
      applicationID: process.env.AUTHOWL_PROJECT_ID!, // <jwtIssuer.aud> = project id
      algorithm: 'ES256',
    },
  ],
};
