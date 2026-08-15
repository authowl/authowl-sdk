<?php

declare(strict_types=1);

namespace AuthOwl;

use AuthOwl\Exception\TokenVerificationException;

/**
 * Fetches and caches a project's published JWKS.
 *
 * An unknown `kid` may be a freshly rotated key, so this forces ONE
 * cache-bypassing refetch to try to pick it up. That forced refetch is
 * rate-limited: a flood of bogus-kid tokens must not become a flood of outbound
 * requests, which would be a cheap amplification lever against the issuer.
 * Legitimate rotation is unaffected - the server keeps signing with the old kid
 * long enough for the normal TTL refresh to carry the new one.
 */
final class RemoteKeySource implements KeySource
{
    public const CACHE_TTL_SECONDS = 300;
    public const FETCH_TIMEOUT_SECONDS = 5;
    public const FORCE_REFETCH_COOLDOWN_SECONDS = 60;

    /** @var list<Jwk>|null */
    private ?array $keys = null;
    private float $fetchedAt = 0.0;
    private float $lastForcedAt = -INF;

    /** @var callable():float */
    private $clock;

    public function __construct(public readonly string $uri, ?callable $clock = null)
    {
        $this->clock = $clock ?? static fn (): float => microtime(true);
    }

    public function resolveKey(?string $kid): Jwk
    {
        $key = KeyPicker::pick($this->load(false), $kid);
        if ($key !== null) {
            return $key;
        }

        $now = ($this->clock)();
        if ($now - $this->lastForcedAt >= self::FORCE_REFETCH_COOLDOWN_SECONDS) {
            $this->lastForcedAt = $now;
            $key = KeyPicker::pick($this->load(true), $kid);
            if ($key !== null) {
                return $key;
            }
        }

        throw new TokenVerificationException(
            'No matching JWKS key for the token kid',
            ErrorCode::JwksKeyNotFound
        );
    }

    /** @return list<Jwk> */
    private function load(bool $force): array
    {
        $now = ($this->clock)();
        if (!$force && $this->keys !== null && $now - $this->fetchedAt < self::CACHE_TTL_SECONDS) {
            return $this->keys;
        }

        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "accept: application/json\r\n",
                'timeout' => self::FETCH_TIMEOUT_SECONDS,
                'ignore_errors' => true,
            ],
        ]);

        // Read one byte past the ceiling so an oversized body is detected rather
        // than silently truncated into something that might still parse.
        $body = @file_get_contents($this->uri, false, $context, 0, Jwks::MAX_BYTES + 1);
        if ($body === false) {
            throw new TokenVerificationException('Failed to fetch JWKS', ErrorCode::JwksFetchFailed);
        }
        if (!$this->lastResponseWasSuccessful($http_response_header ?? [])) {
            throw new TokenVerificationException(
                'JWKS fetch returned a non-success status',
                ErrorCode::JwksHttpError
            );
        }
        if (strlen($body) > Jwks::MAX_BYTES) {
            throw new TokenVerificationException(
                'JWKS response exceeds the 64 KiB limit',
                ErrorCode::JwksResponseTooLarge
            );
        }

        $keys = Jwks::parse($body);
        $this->keys = $keys;
        $this->fetchedAt = ($this->clock)();

        return $keys;
    }

    /** @param list<string> $headers */
    private function lastResponseWasSuccessful(array $headers): bool
    {
        foreach ($headers as $header) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $match) === 1) {
                $status = (int) $match[1];

                return $status >= 200 && $status <= 299;
            }
        }

        return false;
    }
}
