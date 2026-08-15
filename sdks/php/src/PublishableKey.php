<?php

declare(strict_types=1);

namespace AuthOwl;

use AuthOwl\Exception\MalformedPublishableKeyException;
use AuthOwl\Exception\PublishableKeyRequiredException;
use AuthOwl\Exception\SecretKeySuppliedException;

/** The decoded form of a `pk_live_…` / `pk_test_…` key. */
final class PublishableKey
{
    private const PATTERN = '/^(pk_(live|test))_([0-9a-fA-F-]{36})_([A-Za-z0-9]{20,})$/';

    public function __construct(
        public readonly string $prefix,
        public readonly string $env,
        public readonly string $projectId,
    ) {
    }

    /**
     * Validate a publishable key and extract its project id.
     *
     * Throws SecretKeySuppliedException for anything starting `sk_`. That check
     * runs FIRST, before any shape validation: a secret key must never be
     * reported as merely "malformed", because the fix is to rotate it.
     */
    public static function decode(string $key): self
    {
        if ($key === '') {
            throw new PublishableKeyRequiredException('publishableKey is required');
        }
        if (preg_match('/^sk_/i', $key) === 1) {
            throw new SecretKeySuppliedException(
                'A secret key was passed where a publishable key was expected. '
                . 'Never embed secret keys in client code.'
            );
        }
        if (preg_match(self::PATTERN, $key, $match) !== 1) {
            throw new MalformedPublishableKeyException(
                'publishableKey is malformed; expected pk_(live|test)_<uuid>_<base62>'
            );
        }

        // The project id is lowercased for the same reason prefix and env are:
        // PATTERN accepts `[0-9a-fA-F-]`, so an upper-case uuid is a VALID key,
        // and returning it verbatim yields an id that never equals the lowercase
        // Postgres `uuid` the server puts in a JWT `aud` or names its cookie
        // after.
        return new self(strtolower($match[1]), strtolower($match[2]), strtolower($match[3]));
    }
}
