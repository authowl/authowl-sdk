<?php

declare(strict_types=1);

namespace AuthOwl;

/**
 * The active-organization membership carried by a verified token.
 *
 * Every method here is pure: decisions are made against the claim the verified
 * token already carries, so the client and server paths can never disagree
 * about what a membership grants.
 */
final class Membership
{
    /**
     * @param string        $role        Primary role key (owner/admin/member, or a project role).
     * @param list<string>  $permissions Effective permission ids: `org:sys_*` system claims
     *                                   plus custom `org:<feature>:<action>` ids.
     * @param list<string>|null $teams   Team ids held in the ACTIVE organization.
     *                                   NULL (not an empty list) when the token carries no
     *                                   `teams` claim at all, which is what a token minted
     *                                   before teams shipped looks like. An absent claim is
     *                                   never read as "any team".
     * @param list<string>|null $roles   Every role the member holds. NULL (not an empty list)
     *                                   when the token carries no `roles` claim, which is what
     *                                   an older AuthOwl token looks like. Role checks then fall
     *                                   back to the primary role.
     */
    public function __construct(
        public readonly string $role = '',
        public readonly array $permissions = [],
        public readonly ?array $teams = null,
        public readonly ?array $roles = null,
    ) {
    }

    /** Whether the member holds $role as one of their roles. */
    public function hasRole(string $role): bool
    {
        if ($this->roles === null) {
            return $this->role === $role;
        }

        return in_array($role, $this->roles, true);
    }

    /** Whether the permission claim includes $permission. Exact match only. */
    public function hasPermission(string $permission): bool
    {
        if ($permission === '') {
            return false;
        }

        return in_array($permission, $this->permissions, true);
    }

    /**
     * Whether the team claim includes $teamId.
     *
     * Teams are pure grouping: belonging to one grants nothing on its own, so
     * this is for the application's own gating, never an authority check.
     */
    public function hasTeam(string $teamId): bool
    {
        if ($teamId === '' || $this->teams === null) {
            return false;
        }

        return in_array($teamId, $this->teams, true);
    }

    /**
     * Whether the membership satisfies EVERY supplied criterion (AND).
     *
     * Asking nothing grants nothing: a query with no criteria returns false.
     */
    public function has(?string $role = null, ?string $permission = null, ?string $teamId = null): bool
    {
        if ($role === null && $permission === null && $teamId === null) {
            return false;
        }
        if ($role !== null && !$this->hasRole($role)) {
            return false;
        }
        if ($permission !== null && !$this->hasPermission($permission)) {
            return false;
        }
        if ($teamId !== null && !$this->hasTeam($teamId)) {
            return false;
        }

        return true;
    }

    /** Decode the `membership` claim, or null when the token carries none. */
    public static function fromClaim(mixed $raw): ?self
    {
        if (!$raw instanceof \stdClass) {
            return null;
        }
        $claim = (array) $raw;

        $role = isset($claim['role']) && is_string($claim['role']) ? $claim['role'] : '';
        $permissions = self::stringList($claim['permissions'] ?? null) ?? [];
        // Absent stays null so teams cannot match a claim that never mentioned
        // them, and roles can fall back to the primary only for older tokens.
        $teams = self::stringList($claim['teams'] ?? null);
        $roles = self::stringList($claim['roles'] ?? null);

        if (
            $role === ''
            && $permissions === []
            && ($teams === null || $teams === [])
            && ($roles === null || $roles === [])
        ) {
            return null;
        }

        return new self(role: $role, permissions: $permissions, teams: $teams, roles: $roles);
    }

    /**
     * Non-string entries are DROPPED rather than failing the whole claim, so one
     * malformed entry cannot deny an otherwise valid membership.
     *
     * @return list<string>|null
     */
    private static function stringList(mixed $value): ?array
    {
        if (!is_array($value) || !array_is_list($value)) {
            return null;
        }

        return array_values(array_filter($value, 'is_string'));
    }
}
