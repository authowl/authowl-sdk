<?php

declare(strict_types=1);

namespace AuthOwl;

use AuthOwl\Exception\TokenVerificationException;

/** JWKS document parsing. */
final class Jwks
{
    public const MAX_KEYS = 64;
    /** Bound the response so a hostile or misconfigured issuer cannot exhaust memory. */
    public const MAX_BYTES = 65536;

    private const ALLOWED_MEMBERS = ['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y'];
    /**
     * `d` is the private scalar; the RSA/oct members are listed so a key from
     * the wrong family is refused loudly rather than silently ignored.
     */
    private const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth'];

    /**
     * Validate a JWKS document and return its verification keys.
     *
     * The document must be an object whose ONLY member is a `keys` array. Extra
     * top-level members are refused, not ignored, so an issuer cannot slip
     * verifier-affecting metadata past this parser.
     *
     * @return list<Jwk>
     */
    public static function parse(string $json): array
    {
        $document = json_decode($json);
        if (!$document instanceof \stdClass) {
            throw new TokenVerificationException(
                'JWKS response must be an object containing only a keys array',
                ErrorCode::JwksDocumentInvalid
            );
        }
        $members = (array) $document;
        if (count($members) !== 1 || !isset($members['keys']) || !is_array($members['keys'])
            || !array_is_list($members['keys'])) {
            throw new TokenVerificationException(
                'JWKS response must be an object containing only a keys array',
                ErrorCode::JwksDocumentInvalid
            );
        }

        $entries = $members['keys'];
        if (count($entries) > self::MAX_KEYS) {
            throw new TokenVerificationException(
                'JWKS response exceeds the 64-key limit',
                ErrorCode::JwksTooManyKeys
            );
        }

        $keys = [];
        $seen = [];
        foreach ($entries as $entry) {
            $key = self::parsePublicEs256Jwk($entry);
            if (isset($seen[$key->kid])) {
                throw new TokenVerificationException(
                    'JWKS response contains duplicate kid values',
                    ErrorCode::JwksDuplicateKid
                );
            }
            $seen[$key->kid] = true;
            $keys[] = $key;
        }

        return $keys;
    }

    /**
     * Enforce the AuthOwl public-key schema.
     *
     * Anything outside it - a private member, an unexpected member, the wrong
     * curve - is refused rather than tolerated, so a compromised or confused
     * JWKS cannot smuggle in a key this verifier would trust.
     */
    private static function parsePublicEs256Jwk(mixed $raw): Jwk
    {
        if (!$raw instanceof \stdClass) {
            throw new TokenVerificationException(
                'JWKS contains a non-object key',
                ErrorCode::JwksKeyInvalid
            );
        }
        $key = (array) $raw;

        if (array_key_exists('key_ops', $key)) {
            throw self::invalidKey();
        }
        foreach (self::PRIVATE_MEMBERS as $member) {
            if (array_key_exists($member, $key)) {
                throw self::invalidKey();
            }
        }
        foreach (array_keys($key) as $member) {
            if (!in_array($member, self::ALLOWED_MEMBERS, true)) {
                throw self::invalidKey();
            }
        }

        if (($key['kty'] ?? null) !== 'EC'
            || ($key['crv'] ?? null) !== 'P-256'
            || ($key['alg'] ?? null) !== 'ES256'
            || ($key['use'] ?? null) !== 'sig') {
            throw self::invalidKey();
        }

        $kid = $key['kid'] ?? null;
        if (!is_string($kid) || $kid === '' || strlen($kid) > 128
            || preg_match('/^[A-Za-z0-9_-]+$/', $kid) !== 1) {
            throw self::invalidKey();
        }

        $rawX = self::decodeCoordinate($key['x'] ?? null);
        $rawY = self::decodeCoordinate($key['y'] ?? null);
        if ($rawX === null || $rawY === null) {
            throw self::invalidKey();
        }

        /** @var string $x */
        $x = $key['x'];
        /** @var string $y */
        $y = $key['y'];

        return Jwk::fromCoordinates($kid, $x, $y, $rawX, $rawY);
    }

    private static function decodeCoordinate(mixed $value): ?string
    {
        if (!is_string($value) || preg_match('/^[A-Za-z0-9_-]{43}$/', $value) !== 1) {
            return null;
        }
        $raw = self::base64UrlDecode($value);
        if ($raw === null || strlen($raw) !== 32) {
            return null;
        }

        return $raw;
    }

    public static function base64UrlDecode(string $value): ?string
    {
        $padded = strtr($value, '-_', '+/');
        $padded .= str_repeat('=', (4 - strlen($padded) % 4) % 4);
        $decoded = base64_decode($padded, true);

        return $decoded === false ? null : $decoded;
    }

    private static function invalidKey(): TokenVerificationException
    {
        return new TokenVerificationException(
            'JWKS contains a key outside the AuthOwl ES256 public-key schema',
            ErrorCode::JwksKeyInvalid
        );
    }
}
