<?php

declare(strict_types=1);

namespace AuthOwl;

use AuthOwl\Exception\TokenVerificationException;

/**
 * Stateless verification of AuthOwl project JWTs.
 *
 * This is the REAL server-side authorization primitive. It verifies the ES256
 * signature against the project's published JWKS and checks issuer, audience,
 * and expiry BEFORE reading any claim, so no permission is ever granted off an
 * unverified claim.
 */
final class Verifier
{
    public const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;
    /**
     * A tolerance beyond this keeps revoked tokens alive too long to be called
     * authorization, so it is refused as a configuration error.
     */
    public const MAX_CLOCK_TOLERANCE_SECONDS = 300;

    /** @var callable():float */
    private $clock;

    public function __construct(
        public readonly string $issuer,
        public readonly string $audience,
        private readonly KeySource $keys,
        public readonly int $clockToleranceSeconds = self::DEFAULT_CLOCK_TOLERANCE_SECONDS,
        ?callable $clock = null,
    ) {
        if ($issuer === '' || $audience === '') {
            throw new TokenVerificationException(
                'Verifier requires an issuer and an audience.',
                ErrorCode::TokenConfigInvalid
            );
        }
        if ($clockToleranceSeconds < 0 || $clockToleranceSeconds > self::MAX_CLOCK_TOLERANCE_SECONDS) {
            throw new TokenVerificationException(
                'clockToleranceSeconds must be an integer from 0 through 300.',
                ErrorCode::TokenConfigInvalid
            );
        }
        $this->clock = $clock ?? static fn (): float => microtime(true);
    }

    /**
     * Verify a project JWT and return its subject, membership, and claims.
     *
     * Checks run in a deliberate order - structure, algorithm, key, signature,
     * then claims - so a token with a bad signature always reports as a
     * signature failure even when its claims are also invalid.
     */
    public function verify(string $token): VerifiedToken
    {
        if ($token === '') {
            throw new TokenVerificationException(
                'A token string is required.',
                ErrorCode::TokenMalformed
            );
        }
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new TokenVerificationException('Malformed JWT.', ErrorCode::TokenMalformed);
        }
        [$headerSegment, $payloadSegment, $signatureSegment] = $parts;

        $header = self::decodeSegment($headerSegment);
        // The algorithm is pinned BEFORE key resolution, which is what defeats
        // the `alg: none` and HS256-confusion families outright.
        if (($header['alg'] ?? null) !== 'ES256') {
            throw new TokenVerificationException(
                'Unsupported JWT algorithm.',
                ErrorCode::TokenAlgorithmUnsupported
            );
        }
        $kid = $header['kid'] ?? null;
        $key = $this->keys->resolveKey(is_string($kid) ? $kid : null);

        if (preg_match('/^[A-Za-z0-9_-]{86}$/', $signatureSegment) !== 1) {
            throw new TokenVerificationException(
                'Malformed JWT signature.',
                ErrorCode::TokenMalformed
            );
        }
        $signature = Jwks::base64UrlDecode($signatureSegment);
        if ($signature === null || strlen($signature) !== 64) {
            throw new TokenVerificationException(
                'Malformed JWT signature.',
                ErrorCode::TokenMalformed
            );
        }

        $verified = openssl_verify(
            $headerSegment . '.' . $payloadSegment,
            self::rawSignatureToDer($signature),
            $key->publicKey,
            OPENSSL_ALGO_SHA256
        );
        if ($verified !== 1) {
            throw new TokenVerificationException(
                'Invalid token signature.',
                ErrorCode::TokenSignatureInvalid
            );
        }

        $claims = self::decodeSegment($payloadSegment);
        $now = (int) ($this->clock)();
        $tolerance = $this->clockToleranceSeconds;

        // `exp` is REQUIRED, not skip-if-absent: a token with no expiry would
        // never fail closed on its own.
        $exp = self::numericClaim($claims['exp'] ?? null);
        if ($exp === null) {
            throw new TokenVerificationException(
                'Token is missing a valid exp claim.',
                ErrorCode::TokenClaimInvalid
            );
        }
        if ($exp + $tolerance < $now) {
            throw new TokenVerificationException('Token has expired.', ErrorCode::TokenClaimInvalid);
        }
        $nbf = self::numericClaim($claims['nbf'] ?? null);
        if ($nbf !== null && $nbf - $tolerance > $now) {
            throw new TokenVerificationException(
                'Token is not yet valid.',
                ErrorCode::TokenClaimInvalid
            );
        }
        // `iss` is REQUIRED and must match exactly - including any trailing slash.
        if (($claims['iss'] ?? null) !== $this->issuer) {
            throw new TokenVerificationException(
                'Token issuer missing or mismatched.',
                ErrorCode::TokenClaimInvalid
            );
        }
        if (!self::audienceMatches($claims['aud'] ?? null, $this->audience)) {
            throw new TokenVerificationException(
                'Token audience mismatch.',
                ErrorCode::TokenClaimInvalid
            );
        }

        $subject = $claims['sub'] ?? null;

        return new VerifiedToken(
            is_string($subject) ? $subject : null,
            Membership::fromClaim($claims['membership'] ?? null),
            $claims
        );
    }

    /**
     * Verify the token, then evaluate the query against its membership.
     *
     * Fails CLOSED: an invalid, tampered, expired, or wrong-audience token
     * returns false rather than throwing, so a caller that forgets to catch
     * still denies. Configuration mistakes are rejected in the constructor, so
     * a misconfigured verifier can never reach this silent-denial path.
     */
    public function has(
        string $token,
        ?string $role = null,
        ?string $permission = null,
        ?string $teamId = null,
    ): bool {
        try {
            $verified = $this->verify($token);
        } catch (TokenVerificationException) {
            return false;
        }

        return $verified->membership?->has($role, $permission, $teamId) ?? false;
    }

    /** Verify the token and report whether it grants $permission. Fails closed. */
    public function hasPermission(string $token, string $permission): bool
    {
        return $this->has($token, permission: $permission);
    }

    /** @return array<string, mixed> */
    private static function decodeSegment(string $segment): array
    {
        if (preg_match('/^[A-Za-z0-9_-]+$/', $segment) !== 1) {
            throw new TokenVerificationException(
                'Malformed JWT segment.',
                ErrorCode::TokenMalformed
            );
        }
        $raw = Jwks::base64UrlDecode($segment);
        if ($raw === null) {
            throw new TokenVerificationException(
                'Malformed JWT segment.',
                ErrorCode::TokenMalformed
            );
        }
        $parsed = json_decode($raw);
        if (!$parsed instanceof \stdClass) {
            throw new TokenVerificationException(
                'Malformed JWT segment.',
                ErrorCode::TokenMalformed
            );
        }

        return (array) $parsed;
    }

    /**
     * Read a numeric claim.
     *
     * `true` is excluded explicitly: PHP would otherwise happily compare a
     * boolean against an integer and let a token carrying `"exp": true` through.
     */
    private static function numericClaim(mixed $value): ?float
    {
        if (is_bool($value) || !is_int($value) && !is_float($value)) {
            return null;
        }

        return (float) $value;
    }

    private static function audienceMatches(mixed $aud, string $expected): bool
    {
        if (is_string($aud)) {
            return $aud === $expected;
        }
        if (is_array($aud)) {
            return in_array($expected, $aud, true);
        }

        return false;
    }

    /** Convert a JWT's raw r||s signature into the DER form OpenSSL expects. */
    private static function rawSignatureToDer(string $signature): string
    {
        $sequence = self::derInteger(substr($signature, 0, 32))
            . self::derInteger(substr($signature, 32, 32));

        return "\x30" . chr(strlen($sequence)) . $sequence;
    }

    private static function derInteger(string $bytes): string
    {
        $bytes = ltrim($bytes, "\x00");
        if ($bytes === '') {
            $bytes = "\x00";
        }
        // DER integers are signed, so a leading high bit needs a zero byte or the
        // value would be read as negative.
        if ((ord($bytes[0]) & 0x80) !== 0) {
            $bytes = "\x00" . $bytes;
        }

        return "\x02" . chr(strlen($bytes)) . $bytes;
    }
}
