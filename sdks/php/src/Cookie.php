<?php

declare(strict_types=1);

namespace AuthOwl;

/** Session cookie-name derivation. */
final class Cookie
{
    /**
     * The exact session-cookie name the AuthOwl server sets for a project.
     *
     *   dev  (http):  p_<idNoDashes>.session_token
     *   prod (https): __Secure-p_<idNoDashes>.session_token
     *
     * Note the DOT joining the prefix and the name, and the `__Secure-` (not
     * `__Host-`) prefix - both are easy to get wrong by hand, and getting either
     * wrong means reading a cookie the server never set.
     *
     * $secure must reflect the SERVER's cookie mode: derive it from the API
     * URL's scheme (https => true), not from the local request.
     */
    public static function sessionName(string $projectId, bool $secure = false): string
    {
        // Lowercased because the server's name always is: `projects.id` is a
        // Postgres `uuid`, which renders lowercase, and the engine builds the
        // cookie prefix from it. Cookie names are case-SENSITIVE, so a
        // mixed-case id names a cookie nothing ever set and the request reads
        // as signed out with nothing in any log.
        $name = 'p_' . strtolower(str_replace('-', '', $projectId)) . '.session_token';

        return $secure ? '__Secure-' . $name : $name;
    }
}
