import { describe, expect, it } from 'vitest';
import { holds, holdsAll, permissionMatches, validPermission } from '../app/src/lib/permissions';

describe('permission patterns', () => {
    it('matches a permission, a prefix pattern and everything', () => {
        expect(permissionMatches('user:read', 'user:read')).toBe(true);
        expect(permissionMatches('user:read', 'user:update')).toBe(false);
        expect(permissionMatches('user:*', 'user:update')).toBe(true);
        expect(permissionMatches('user:*', 'role:update')).toBe(false);
        expect(permissionMatches('*', 'anything:at-all')).toBe(true);
        expect(holds(['role:read', 'user:*'], 'user:delete')).toBe(true);
        expect(holds([], 'user:read')).toBe(false);
    });

    it('gives a role only what its manager holds, each pattern as written', () => {
        expect(holdsAll(['user:*'], ['user:read', 'user:delete'])).toBe(true);
        // A pattern is wider than the permissions it covers today: holding those is not holding it.
        expect(holdsAll(['user:read', 'user:create', 'user:update', 'user:delete'], ['user:*'])).toBe(false);
        expect(holdsAll(['user:*'], ['user:*'])).toBe(true);
        expect(holdsAll(['user:*'], ['*'])).toBe(false);
        expect(holdsAll(['*'], ['*', 'role:update'])).toBe(true);
    });

    it('accepts the listed permissions and patterns over them', () => {
        expect(validPermission('user:read')).toBe(true);
        expect(validPermission('user:*')).toBe(true);
        expect(validPermission('*')).toBe(true);
        expect(validPermission('billing:read')).toBe(false);
        expect(validPermission('billing:*')).toBe(false);
        expect(validPermission('report:*', ['report:read'])).toBe(true);
    });
});
