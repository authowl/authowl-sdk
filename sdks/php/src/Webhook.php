<?php

declare(strict_types=1);

namespace AuthOwl;

use AuthOwl\Exception\ConfigurationException;

/** Webhook signature verification. */
final class Webhook
{
    public const DEFAULT_TOLERANCE_SECONDS = 300;
    public const MAX_TOLERANCE_SECONDS = 3600;
    public const MAX_BODY_BYTES = 1048576;
    public const MAX_SIGNATURES = 4;
    public const MAX_SECRETS = 2;
    public const MAX_HEADER_LENGTH = 1024;

    /**
     * Verify an AuthOwl webhook HMAC before parsing or acting on its body.
     *
     * $rawBody must be the EXACT request bytes. Do not parse and re-serialize
     * the JSON first - re-serialization reorders keys and breaks the HMAC.
     *
     * Returns false for anything wrong with the untrusted request. Throws
     * ConfigurationException only for invalid LOCAL configuration, so a broken
     * endpoint fails loudly instead of silently dropping every delivery.
     *
     * @param list<string> $secrets Current and, during rotation overlap, previous secret.
     */
    public static function verify(
        string $rawBody,
        string $timestamp,
        string $signatureHeader,
        array $secrets,
        ?int $now = null,
        int $toleranceSeconds = self::DEFAULT_TOLERANCE_SECONDS,
    ): bool {
        self::validateSecrets($secrets);

        if ($toleranceSeconds < 0 || $toleranceSeconds > self::MAX_TOLERANCE_SECONDS) {
            throw new ConfigurationException(
                'Webhook toleranceSeconds must be an integer from 0 to 3600.'
            );
        }

        if (strlen($rawBody) > self::MAX_BODY_BYTES) {
            return false;
        }
        if (preg_match('/^(0|[1-9]\d{0,10})$/', $timestamp) !== 1) {
            return false;
        }

        $current = $now ?? time();
        if (abs($current - (int) $timestamp) > $toleranceSeconds) {
            return false;
        }

        $supplied = self::parseSignatures($signatureHeader);
        if ($supplied === []) {
            return false;
        }

        $signed = $timestamp . '.' . $rawBody;
        $matched = false;
        foreach ($secrets as $secret) {
            $expected = hash_hmac('sha256', $signed, $secret, true);
            foreach ($supplied as $candidate) {
                // No early exit: comparing every candidate keeps the work
                // independent of where a match occurs.
                if (hash_equals($expected, $candidate)) {
                    $matched = true;
                }
            }
        }

        return $matched;
    }

    /** @param list<string> $secrets */
    private static function validateSecrets(array $secrets): void
    {
        $count = count($secrets);
        if ($count < 1 || $count > self::MAX_SECRETS || count(array_unique($secrets)) !== $count) {
            throw new ConfigurationException(
                'Webhook secrets must contain one or two unique whsec_ values.'
            );
        }
        foreach ($secrets as $secret) {
            if (!is_string($secret) || preg_match('/^whsec_[A-Za-z0-9_-]{1,256}$/', $secret) !== 1) {
                throw new ConfigurationException(
                    'Webhook secrets must contain one or two unique whsec_ values.'
                );
            }
        }
    }

    /** @return list<string> */
    private static function parseSignatures(string $header): array
    {
        if (strlen($header) > self::MAX_HEADER_LENGTH) {
            return [];
        }
        $entries = explode(',', $header);
        if (count($entries) > self::MAX_SIGNATURES) {
            return [];
        }

        $signatures = [];
        foreach ($entries as $entry) {
            if (preg_match('/^v1=([a-f0-9]{64})$/i', trim($entry), $match) !== 1) {
                continue;
            }
            $raw = hex2bin($match[1]);
            if ($raw !== false) {
                $signatures[] = $raw;
            }
        }

        return $signatures;
    }
}
