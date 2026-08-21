<?php

declare(strict_types=1);

namespace AuthOwl\Tests;

use AuthOwl\Cookie;
use AuthOwl\Exception\ConfigurationException;
use AuthOwl\Exception\MalformedPublishableKeyException;
use AuthOwl\Exception\PublishableKeyRequiredException;
use AuthOwl\Exception\SecretKeySuppliedException;
use AuthOwl\Exception\TokenVerificationException;
use AuthOwl\Jwks;
use AuthOwl\Membership;
use AuthOwl\PublishableKey;
use AuthOwl\StaticKeySource;
use AuthOwl\Verifier;
use AuthOwl\Webhook;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Runs the language-neutral AuthOwl conformance corpus against this SDK.
 *
 * These are the SAME vectors the TypeScript, Go, Python, and Rust SDKs
 * run. If a case here fails, this implementation has diverged from the contract
 * - fix the code, not the vector. See conformance/README.md.
 */
final class ConformanceTest extends TestCase
{
    private static function load(string $name): \stdClass
    {
        $path = dirname(__DIR__, 3) . '/conformance/vectors/' . $name;
        $raw = file_get_contents($path);
        self::assertIsString($raw, "could not read {$path}");

        return json_decode($raw, false, 512, JSON_THROW_ON_ERROR);
    }

    /** @return array<string, array{\stdClass}> */
    private static function provide(string $file, string $property = 'cases'): array
    {
        $cases = [];
        foreach (self::load($file)->{$property} as $case) {
            $cases[$case->name] = [$case];
        }

        return $cases;
    }

    // -----------------------------------------------------------------------

    /** @return array<string, array{\stdClass}> */
    public static function tokenCases(): array
    {
        return self::provide('jwt-verify.json');
    }

    #[DataProvider('tokenCases')]
    public function testTokenVerification(\stdClass $case): void
    {
        $vectors = self::load('jwt-verify.json');
        $verifier = new Verifier(
            issuer: $vectors->issuer,
            audience: $vectors->audience,
            keys: new StaticKeySource(json_encode($vectors->jwks, JSON_THROW_ON_ERROR)),
            clockToleranceSeconds: $case->clockToleranceSeconds ?? 60,
            clock: static fn (): float => (float) $case->now,
        );

        if (!$case->expect->ok) {
            try {
                $verifier->verify($case->token);
                self::fail("expected {$case->expect->code}, got a valid token");
            } catch (TokenVerificationException $error) {
                self::assertSame($case->expect->code, $error->errorCode->value);
            }

            return;
        }

        $verified = $verifier->verify($case->token);
        self::assertSame($case->expect->sub, $verified->subject);

        if ($case->expect->membership === null) {
            self::assertNull($verified->membership);

            return;
        }
        self::assertNotNull($verified->membership);
        self::assertSame($case->expect->membership->role, $verified->membership->role);
        $expectedRoles = $case->expect->membership->roles ?? null;
        self::assertSame($expectedRoles, $verified->membership->roles);
        self::assertSame($case->expect->membership->permissions, $verified->membership->permissions);
        $expectedTeams = $case->expect->membership->teams ?? null;
        self::assertSame($expectedTeams, $verified->membership->teams);
    }

    // -----------------------------------------------------------------------

    /** @return array<string, array{\stdClass}> */
    public static function jwksCases(): array
    {
        return self::provide('jwks-parse.json');
    }

    #[DataProvider('jwksCases')]
    public function testJwksParsing(\stdClass $case): void
    {
        $document = json_encode($case->document, JSON_THROW_ON_ERROR);

        if (!$case->expect->ok) {
            try {
                Jwks::parse($document);
                self::fail("expected {$case->expect->code}");
            } catch (TokenVerificationException $error) {
                self::assertSame($case->expect->code, $error->errorCode->value);
            }

            return;
        }
        self::assertCount($case->expect->keys, Jwks::parse($document));
    }

    // -----------------------------------------------------------------------

    /** @return array<string, array{\stdClass}> */
    public static function cookieCases(): array
    {
        return self::provide('cookie-name.json');
    }

    #[DataProvider('cookieCases')]
    public function testSessionCookieName(\stdClass $case): void
    {
        self::assertSame(
            $case->expect,
            Cookie::sessionName($case->projectId, $case->secure ?? false)
        );
    }

    // -----------------------------------------------------------------------

    /** @return array<string, array{\stdClass}> */
    public static function publishableKeyCases(): array
    {
        return self::provide('publishable-key.json');
    }

    #[DataProvider('publishableKeyCases')]
    public function testPublishableKey(\stdClass $case): void
    {
        if ($case->expect->ok) {
            $decoded = PublishableKey::decode($case->key);
            self::assertSame($case->expect->prefix, $decoded->prefix);
            self::assertSame($case->expect->env, $decoded->env);
            self::assertSame($case->expect->projectId, $decoded->projectId);

            return;
        }

        // Collapse the thrown type to the portable reason every SDK reports.
        $reasons = [
            PublishableKeyRequiredException::class => 'missing',
            SecretKeySuppliedException::class => 'secret_key',
            MalformedPublishableKeyException::class => 'malformed',
        ];
        try {
            PublishableKey::decode($case->key);
            self::fail("expected {$case->expect->reason}");
        } catch (\Throwable $error) {
            self::assertArrayHasKey($error::class, $reasons, 'unexpected exception: ' . $error::class);
            self::assertSame($case->expect->reason, $reasons[$error::class]);
        }
    }

    // -----------------------------------------------------------------------

    private static function toMembership(?\stdClass $raw): ?Membership
    {
        if ($raw === null) {
            return null;
        }

        return new Membership(
            role: $raw->role ?? '',
            permissions: $raw->permissions ?? [],
            teams: $raw->teams ?? null,
            roles: $raw->roles ?? null,
        );
    }

    /** @return array<string, array{\stdClass}> */
    public static function membershipHasCases(): array
    {
        return self::provide('membership-has.json', 'hasCases');
    }

    #[DataProvider('membershipHasCases')]
    public function testMembershipHas(\stdClass $case): void
    {
        $membership = self::toMembership($case->membership);
        $actual = $membership?->has(
            $case->params->role ?? null,
            $case->params->permission ?? null,
            $case->params->teamId ?? null,
        ) ?? false;

        self::assertSame($case->expect, $actual);
    }

    /** @return array<string, array{\stdClass}> */
    public static function membershipPermissionCases(): array
    {
        return self::provide('membership-has.json', 'hasPermissionCases');
    }

    #[DataProvider('membershipPermissionCases')]
    public function testMembershipHasPermission(\stdClass $case): void
    {
        $membership = self::toMembership($case->membership);
        self::assertSame($case->expect, $membership?->hasPermission($case->permission) ?? false);
    }

    // -----------------------------------------------------------------------

    /** @return array<string, array{\stdClass}> */
    public static function webhookCases(): array
    {
        return self::provide('webhook-verify.json');
    }

    #[DataProvider('webhookCases')]
    public function testWebhookVerification(\stdClass $case): void
    {
        $call = static fn (): bool => Webhook::verify(
            rawBody: $case->rawBody,
            timestamp: $case->timestamp,
            signatureHeader: $case->signatureHeader,
            secrets: $case->secrets,
            now: $case->now,
            toleranceSeconds: $case->toleranceSeconds ?? 300,
        );

        if ($case->expect->throws ?? false) {
            // Local misconfiguration is LOUD; only untrusted input degrades to false.
            $this->expectException(ConfigurationException::class);
            $call();

            return;
        }
        self::assertSame($case->expect->result, $call());
    }
}
