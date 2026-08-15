<?php

declare(strict_types=1);

namespace AuthOwl;

/** Resolves the verification key named by a token's `kid`. */
interface KeySource
{
    /**
     * Return the key for $kid, or the first published key when $kid is null.
     *
     * @throws Exception\TokenVerificationException with JwksKeyNotFound when nothing matches.
     */
    public function resolveKey(?string $kid): Jwk;
}
