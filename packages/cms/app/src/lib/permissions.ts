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
