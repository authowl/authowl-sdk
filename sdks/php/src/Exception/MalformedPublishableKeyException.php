<?php

declare(strict_types=1);

namespace AuthOwl\Exception;

/** A publishable key did not match `pk_(live|test)_<uuid>_<base62>`. */
final class MalformedPublishableKeyException extends AuthOwlException
{
}
