/**
 * Sections the CMS adds to a user's screen: one card per field group attached to users, linking
 * to the user's Fields screen. Replaces the scaffold's empty module.
 */
import type { Context } from 'hono';
import { hasPermission, PERMISSIONS } from '@cossackframework/cms';

export interface UserSection {
    id: string;
    title: string;
    description?: string;
    href: string;
}

export async function userSections(c: Context, userId: string): Promise<UserSection[]> {
    if (!hasPermission(c.get('principal'), PERMISSIONS.manageUsers)) return [];
    return c.get('cms').fieldGroupsFor({ kind: 'users' }).map(group => ({
        id: `group-${group.id}`, title: group.title, ...(group.description ? { description: group.description } : {}),
        href: `/dashboard/users/${encodeURIComponent(userId)}/fields#group-${group.id}-title`,
    }));
}
