/**
 * What a feature adds to a user's Profile tab, such as the CMS's field groups: the screen loads
 * `userFields` with the user and renders `UserFields` with what it returned. The CMS replaces
 * this module; here there is nothing to add.
 */
import type { Context } from 'hono';
import { Component, Cossack } from '@cossackframework/core';

/** What `UserFields` shows, as JSON; null when there is nothing to show. */
export type UserFieldsData = { readonly [key: string]: unknown };

export async function userFields(_c: Context, _userId: string): Promise<UserFieldsData | null> {
    return null;
}

/** The feature's boxes on the Profile tab, saved on their own. */
@Component()
export class UserFields extends Cossack {
    declare props: { userId: string; data: UserFieldsData };

    render() {
        return null;
    }
}
