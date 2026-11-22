// src/lib/permissions.ts
//
// Permissions the Roles screen offers. CMS permissions are patterns: `*` grants everything,
// `cms/*` every collection, and `cms/posts:update` one action on one collection. Collections
// made in the dashboard are covered by `cms/*` and their own `cms/<name>:<action>`.

export const PERMISSIONS = [
    '*',
    'cms:dashboard',
    'cms:users',
    'cms:roles',
    'cms:appearance',
    'cms:settings',
    'cms:collections',
    'cms:plugins',
    'cms:schema',
    'cms:terms',
    'cms:media',
    'cms:upload',
    'cms:comments',
    'cms:redirects',
    'cms:webhooks',
    'cms:updates',
    'cms:submissions',
    'cms:html',
    'cms/*',
    'cms/posts:read',
    'cms/posts:create',
    'cms/posts:update',
    'cms/posts:delete',
    'cms/pages:read',
    'cms/pages:create',
    'cms/pages:update',
    'cms/pages:delete',
    'cms/patterns:read',
    'cms/patterns:create',
    'cms/patterns:update',
    'cms/patterns:delete',
    'app/*',
] as const;

export type Permission = (typeof PERMISSIONS)[number] | (string & {});

export const ALL_PERMISSIONS: Permission[] = ['*'];

const LABELS: Record<string, string> = {
    '*': 'Everything (administrator)',
    'cms:dashboard': 'Use the content dashboard',
    'cms:users': 'Manage users',
    'cms:roles': 'Define roles and choose users’ roles',
    'cms:appearance': 'Choose the theme and edit menus',
    'cms:settings': 'Change site settings',
    'cms:collections': 'Define collections, fields and taxonomies',
    'cms:plugins': 'Enable and disable plugins',
    'cms:schema': 'Apply schema migrations',
    'cms:terms': 'Manage categories, tags and other terms',
    'cms:media': 'Edit and delete anyone\'s media',
    'cms:upload': 'Upload media',
    'cms:comments': 'Moderate comments',
    'cms:redirects': 'Manage redirects',
    'cms:webhooks': 'Manage webhooks',
    'cms:updates': 'See update notices and request an update of the site',
    'cms:submissions': 'Read and handle form submissions',
    'cms:html': 'Add and change Custom HTML blocks, which run as written on the site',
    'cms/*': 'Read and edit every collection, including others\' entries',
    'cms/posts:read': 'Read draft posts',
    'cms/posts:create': 'Write posts',
    'cms/posts:update': 'Edit others\' posts',
    'cms/posts:delete': 'Delete others\' posts',
    'cms/pages:read': 'Read draft pages',
    'cms/pages:create': 'Create pages',
    'cms/pages:update': 'Edit pages',
    'cms/pages:delete': 'Delete pages',
    'cms/patterns:read': 'See patterns',
    'cms/patterns:create': 'Create patterns',
    'cms/patterns:update': 'Edit patterns',
    'cms/patterns:delete': 'Delete patterns',
    'app/*': 'Every application resource',
};

/** A readable name for a permission, with the permission itself for unknown ones. */
export function permissionLabel(permission: string): string {
    return LABELS[permission] ?? permission;
}

/**
 * Permission patterns: `*` matches everything, `cms/*` every permission starting with `cms/`,
 * and `cms/posts:*` every action on one resource. The same rule as the CMS's own `permissionMatches`.
 */
export function permissionMatches(pattern: string, permission: string): boolean {
    if (pattern === '*' || pattern === permission) return true;
    return pattern.endsWith('*') && permission.startsWith(pattern.slice(0, -1));
}

/** Whether one of the held patterns gives the permission. */
export function holds(held: readonly string[], permission: string): boolean {
    return held.some(pattern => permissionMatches(pattern, permission));
}

/** Whether the held patterns give every one of the permissions, each as written. */
export function holdsAll(held: readonly string[], permissions: readonly string[]): boolean {
    return permissions.every(permission => holds(held, permission));
}

/** A permission a role may hold: any pattern of lowercase names, as plugins add their own. */
export function validPermission(permission: string): boolean {
    return /^(?:\*|[a-z][a-z0-9:/._*-]{0,127})$/.test(permission);
}
