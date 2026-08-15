<?php

declare(strict_types=1);

namespace AuthOwl;

use AuthOwl\Exception\TokenVerificationException;
use OpenSSLAsymmetricKey;

/** A published ES256 verification key. */
final class Jwk
{
    /**
     * The fixed DER prefix of a P-256 SubjectPublicKeyInfo, up to and including
     * the uncompressed-point marker (0x04). Appending the raw 32-byte X and Y
     * coordinates yields a complete SPKI that OpenSSL can import - and OpenSSL
     * rejects a point that is not on the curve while parsing it, which is the
     * check an off-curve key attack needs to trip.
     */
    private const SPKI_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d03010703420004';

    public function __construct(
        public readonly string $kid,
        public readonly string $x,
        public readonly string $y,
        public readonly OpenSSLAsymmetricKey $publicKey,
    ) {
    }

    /** Build an OpenSSL public key from raw P-256 coordinates. */
    public static function fromCoordinates(string $kid, string $x, string $y, string $rawX, string $rawY): self
    {
        $der = hex2bin(self::SPKI_PREFIX) . $rawX . $rawY;
        $pem = "-----BEGIN PUBLIC KEY-----\n"
            . chunk_split(base64_encode($der), 64, "\n")
            . "-----END PUBLIC KEY-----\n";

        $key = openssl_pkey_get_public($pem);
        if ($key === false) {
            throw new TokenVerificationException(
                'JWKS contains a key outside the AuthOwl ES256 public-key schema',
                ErrorCode::JwksKeyInvalid
            );
        }

        return new self($kid, $x, $y, $key);
    }
}
