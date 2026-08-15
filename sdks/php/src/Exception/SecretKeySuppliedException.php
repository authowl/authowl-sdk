<?php

declare(strict_types=1);

namespace AuthOwl\Exception;

/**
 * A `sk_` key reached a function that expects a publishable key.
 *
 * A hard rule across every AuthOwl SDK. A leaked secret key compromises the
 * whole project, so it is refused BEFORE any shape validation rather than
 * quietly reported as malformed - the fix is to rotate it, not correct a typo.
 */
final class SecretKeySuppliedException extends AuthOwlException
{
}
