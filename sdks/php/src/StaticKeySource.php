<?php

declare(strict_types=1);

namespace AuthOwl;

use AuthOwl\Exception\TokenVerificationException;

/** Serves a fixed key set. Use in tests, or when keys arrive out of band. */
final class StaticKeySource implements KeySource
{
    /** @var list<Jwk> */
    private array $keys;

    public function __construct(string $jwksJson)
    {
        $this->keys = Jwks::parse($jwksJson);
    }

    public function resolveKey(?string $kid): Jwk
    {
        $key = KeyPicker::pick($this->keys, $kid);
        if ($key === null) {
            throw new TokenVerificationException(
                'No matching JWKS key for the token kid',
                ErrorCode::JwksKeyNotFound
            );
        }

        return $key;
    }
}
