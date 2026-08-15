# authowl/authowl (PHP)

**[Complete PHP guide](https://authowl.dev/docs/sdks/php)** ·
**[JWT issuer setup](https://authowl.dev/docs/backend/jwt-issuer)**

Server-side SDK for [AuthOwl](https://authowl.dev), the multi-tenant auth SaaS.

```bash
composer require authowl/authowl
```

Requires PHP 8.1+ with `ext-openssl`. No other runtime dependencies.

This package is the **relying-party** side of AuthOwl. It never signs anyone in:
your frontend authenticates against the AuthOwl server directly, and this SDK
validates what arrives at your backend.

## Verify a token

```php
use AuthOwl\{RemoteKeySource, Verifier};

$projectId = '2f1c9a84-...';
$issuer = "https://api.authowl.dev/api/projects/{$projectId}/auth";

$verifier = new Verifier(
    issuer: $issuer,
    audience: $projectId,
    keys: new RemoteKeySource("{$issuer}/jwks"),
);

$verified = $verifier->verify($token);   // throws TokenVerificationException
echo $verified->subject;
```

`RemoteKeySource` caches the JWKS for five minutes and survives key rotation by
forcing a single rate-limited refetch when it meets an unknown `kid`.

## Authorize a request

`has()` is the real authorization primitive. It **fails closed**: an invalid,
tampered, expired, or wrong-audience token returns `false` rather than throwing.

```php
if (!$verifier->has($token, permission: 'org:billing:read')) {
    throw new AccessDeniedHttpException();
}

// Every supplied criterion must hold (AND):
$verifier->has($token, role: 'admin', permission: 'org:billing:read');
```

Configuration mistakes throw from the constructor, so a misconfigured verifier
can never reach the silent-denial path — a backend that quietly denies every
request because of a missing env var is far harder to debug.

`teamId` checks **group membership, not authority** — teams grant nothing on
their own, and a token minted before teams shipped can never satisfy a `teamId`
query.

## Read the session cookie

```php
use AuthOwl\Cookie;

// `secure` must reflect the SERVER's cookie mode - derive it from the API URL
// scheme (https => true), not from the incoming request.
$name = Cookie::sessionName($projectId, secure: true);
$token = $_COOKIE[$name] ?? null;
```

## Verify a webhook

```php
use AuthOwl\Webhook;

$ok = Webhook::verify(
    // The EXACT request bytes: json_decode/json_encode reorders keys and breaks the HMAC.
    rawBody: file_get_contents('php://input'),
    timestamp: $_SERVER['HTTP_AUTHOWL_TIMESTAMP'],
    signatureHeader: $_SERVER['HTTP_AUTHOWL_SIGNATURE'],
    secrets: [$current, $previous],   // both, during rotation overlap
);
```

Returns `false` for anything wrong with the untrusted request, and throws
`ConfigurationException` only for invalid local configuration.

## Laravel

```php
// app/Providers/AppServiceProvider.php
$this->app->singleton(Verifier::class, fn () => new Verifier(
    issuer: config('authowl.issuer'),
    audience: config('authowl.project_id'),
    keys: new RemoteKeySource(config('authowl.issuer') . '/jwks'),
));
```

Then gate routes on `$verifier->has($token, permission: ...)` inside a middleware
or a `Gate::define`.

## Error codes

`TokenVerificationException::$errorCode` carries a code shared verbatim with
every other AuthOwl SDK, so a PHP log line means the same thing as a TypeScript
one. Match on the code, never the message.

## Conformance

```bash
composer install && ./vendor/bin/phpunit
```

Runs the shared 125-vector corpus from `conformance/vectors`. If a case fails,
this implementation has diverged from the contract — the fix belongs in the code,
not the vector. See `conformance/README.md`.

## License

MIT
