<?php

declare(strict_types=1);

namespace AuthOwl;

/**
 * Why a token was refused.
 *
 * These codes are shared VERBATIM with every other AuthOwl SDK (see
 * conformance/vectors/jwt-verify.json), so a log line from PHP means the same
 * thing as one from Go or TypeScript. Match on the code, never the message.
 */
enum ErrorCode: string
{
    case TokenVerificationFailed = 'TOKEN_VERIFICATION_FAILED';
    case TokenConfigInvalid = 'TOKEN_CONFIG_INVALID';
    case TokenMalformed = 'TOKEN_MALFORMED';
    case TokenAlgorithmUnsupported = 'TOKEN_ALGORITHM_UNSUPPORTED';
    case TokenSignatureInvalid = 'TOKEN_SIGNATURE_INVALID';
    case TokenClaimInvalid = 'TOKEN_CLAIM_INVALID';
    case JwksFetchFailed = 'JWKS_FETCH_FAILED';
    case JwksFetchTimeout = 'JWKS_FETCH_TIMEOUT';
    case JwksHttpError = 'JWKS_HTTP_ERROR';
    case JwksResponseTooLarge = 'JWKS_RESPONSE_TOO_LARGE';
    case JwksDocumentInvalid = 'JWKS_DOCUMENT_INVALID';
    case JwksTooManyKeys = 'JWKS_TOO_MANY_KEYS';
    case JwksKeyInvalid = 'JWKS_KEY_INVALID';
    case JwksDuplicateKid = 'JWKS_DUPLICATE_KID';
    case JwksKeyNotFound = 'JWKS_KEY_NOT_FOUND';
}
