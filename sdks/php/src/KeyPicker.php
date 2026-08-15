<?php

declare(strict_types=1);

namespace AuthOwl;

/** @internal Shared key-selection rule for every KeySource. */
final class KeyPicker
{
    /** @param list<Jwk> $keys */
    public static function pick(array $keys, ?string $kid): ?Jwk
    {
        if ($kid === null || $kid === '') {
            return $keys[0] ?? null;
        }
        foreach ($keys as $key) {
            if ($key->kid === $kid) {
                return $key;
            }
        }

        return null;
    }
}
