import type { AccessRule } from './resource';

/** Who is acting. Built per request from the session; never from client input. */
export type Principal =
    | { readonly kind: 'anonymous' }
    | { readonly kind: 'user'; readonly id: string; readonly roles: readonly string[]; readonly permissions: readonly string[] }
    /** Host work such as migrations, imports and outbox delivery. */
    | { readonly kind: 'system'; readonly reason: string };

export const ANONYMOUS: Principal = Object.freeze({ kind: 'anonymous' });

export function systemPrincipal(reason: string): Principal {
    return Object.freeze({ kind: 'system', reason });
}

export function userPrincipal(id: string, roles: readonly string[], permissions: readonly string[]): Principal {
    return Object.freeze({ kind: 'user', id, roles: Object.freeze([...roles]), permissions: Object.freeze([...new Set(permissions)].sort()) });
}

/** Built-in permissions. Resource permissions are `<resource>:<action>`, such as `cms/posts:update`. */
export const PERMISSIONS = Object.freeze({
    /** Everything. Grant only to administrators. */
    all: '*',
    dashboard: 'cms:dashboard',
    manageUsers: 'cms:users',
    manageSchema: 'cms:schema',
    managePlugins: 'cms:plugins',
    manageSettings: 'cms:settings',
    /** Define collections, their fields and taxonomies. */
    manageCollections: 'cms:collections',
    /** Create, rename, move and delete categories, tags and other terms. */
    manageTerms: 'cms:terms',
    /** Edit and delete anyone's media. */
    manageMedia: 'cms:media',
    /** Upload media and edit one's own. */
    upload: 'cms:upload',
    /** Choose and customize the theme, and edit menus. */
    manageAppearance: 'cms:appearance',
    /** Define roles and choose the roles of users. Without it, user managers add users with the default role. */
    manageRoles: 'cms:roles',
    /** Approve, edit, mark as spam and delete comments. Moderators' own comments are approved at once. */
    moderateComments: 'cms:comments',
    /** Manage redirects under Tools. */
    manageRedirects: 'cms:redirects',
    /** Manage webhooks under Tools. */
    manageWebhooks: 'cms:webhooks',
});

/** Roles setup creates. Administrators can change them, except the administrator role itself. */
export const DEFAULT_ROLES = Object.freeze([
    { id: 'admin', name: 'Administrator', permissions: ['*'] },
    { id: 'editor', name: 'Editor', permissions: ['cms:dashboard', 'cms:terms', 'cms:media', 'cms:upload', 'cms:comments', 'cms/*', 'app/*'] },
    { id: 'author', name: 'Author', permissions: ['cms:dashboard', 'cms:upload', 'cms/posts:create'] },
    { id: 'subscriber', name: 'Subscriber', permissions: [] },
] as const);

/**
 * Permission patterns: `*` matches everything, `cms/*` every permission starting with `cms/`,
 * and `cms/posts:*` every action on one resource.
 */
export function permissionMatches(pattern: string, permission: string): boolean {
    if (pattern === '*' || pattern === permission) return true;
    return pattern.endsWith('*') && permission.startsWith(pattern.slice(0, -1));
}

export function hasPermission(principal: Principal, permission: string): boolean {
    if (principal.kind === 'system') return true;
    if (principal.kind !== 'user') return false;
    return principal.permissions.some(pattern => permissionMatches(pattern, permission));
}

/** Records an action is limited to: the principal's own, or those matching any of the conditions. */
export interface RecordScope {
    readonly owner: boolean;
    readonly where: readonly { readonly [field: string]: string | number | boolean }[];
}

/**
 * Evaluate a rule. `owner` means the action is allowed only on records the principal created,
 * which the host enforces with a query condition, not by trusting input.
 */
export function evaluateRule(rule: AccessRule, principal: Principal): 'allow' | 'owner' | 'deny' {
    const scope = ruleScope(rule, principal);
    return scope === 'allow' || scope === 'deny' ? scope : 'owner';
}

/** Like `evaluateRule`, with the record conditions of `owner` and `where` rules. */
export function ruleScope(rule: AccessRule, principal: Principal): 'allow' | 'deny' | RecordScope {
    if (principal.kind === 'system') return 'allow';
    if (rule === 'public') return 'allow';
    if (rule === 'none') return 'deny';
    if (rule === 'authenticated') return principal.kind === 'user' ? 'allow' : 'deny';
    if (rule === 'owner') return principal.kind === 'user' ? { owner: true, where: [] } : 'deny';
    if ('permission' in rule) return hasPermission(principal, rule.permission) ? 'allow' : 'deny';
    if ('where' in rule) return { owner: false, where: [rule.where] };
    let owner = false;
    const where: RecordScope['where'][number][] = [];
    for (const entry of rule.any) {
        const outcome = ruleScope(entry, principal);
        if (outcome === 'allow') return 'allow';
        if (outcome === 'deny') continue;
        owner ||= outcome.owner;
        where.push(...outcome.where);
    }
    return owner || where.length ? { owner, where } : 'deny';
}

export function principalId(principal: Principal): string {
    return principal.kind === 'user' ? principal.id : principal.kind === 'system' ? `system:${principal.reason}` : 'anonymous';
}
