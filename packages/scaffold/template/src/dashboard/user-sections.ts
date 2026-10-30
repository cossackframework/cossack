/**
 * Sections a feature adds to a user's screen, such as the CMS's field groups: each shows as a
 * card on the Profile tab and links to its own screen. The CMS replaces this module.
 */
import type { Context } from 'hono';

export interface UserSection {
    id: string;
    title: string;
    description?: string;
    href: string;
}

export async function userSections(_c: Context, _userId: string): Promise<UserSection[]> {
    return [];
}
