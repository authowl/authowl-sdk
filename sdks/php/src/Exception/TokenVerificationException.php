<?php

declare(strict_types=1);

namespace AuthOwl\Exception;

use AuthOwl\ErrorCode;

/** A project JWT, or the JWKS backing it, was refused. */
final class TokenVerificationException extends AuthOwlException
{
    public function __construct(string $message, public readonly ErrorCode $errorCode)
    {
        // \Exception::$code is an int and already taken, so the AuthOwl code
        // lives on its own readonly property.
        parent::__construct(sprintf('%s (%s)', $message, $errorCode->value));
    }
}
