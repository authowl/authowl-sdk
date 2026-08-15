<?php

declare(strict_types=1);

namespace AuthOwl\Exception;

/**
 * Local configuration is wrong.
 *
 * Thrown rather than returned as a denial: a misconfigured backend that
 * silently rejects every request is far harder to debug than one that fails
 * loudly at the point of the mistake.
 */
final class ConfigurationException extends AuthOwlException
{
}
