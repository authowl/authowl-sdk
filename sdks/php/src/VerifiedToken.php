<?php

declare(strict_types=1);

namespace AuthOwl;

/** The result of a successful verification. */
final class VerifiedToken
{
    /**
     * @param string|null          $subject    The signed-in user id, or null when absent.
     * @param Membership|null      $membership The active-org membership, or null when absent.
     * @param array<string, mixed> $claims     The full verified claim set.
     */
    public function __construct(
        public readonly ?string $subject,
        public readonly ?Membership $membership,
        public readonly array $claims,
    ) {
    }
}
