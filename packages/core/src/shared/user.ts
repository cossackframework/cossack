// src/shared/user.ts

/**
 * The authenticated user, exposed as `this.user` on components and
 * `c.get('user')` on the Hono context.
 *
 * Defaults to `{ id: string }`. Applications extend it from
 * `src/models/User.ts` via declaration merging so `this.user` reflects the
 * app's real user shape — core never imports the application, the merge is
 * resolved by the TypeScript compiler across packages:
 *
 * ```ts
 * // src/models/User.ts
 * declare module '@cossackframework/core' {
 *   interface User {
 *     email: string;
 *     name: string;
 *   }
 * }
 * ```
 */
export interface User {
    id: string;
}

/** Extra user fields an application chooses to expose to the browser. */
export type PublicUserProjection = (user: User) => Record<string, unknown>;

let publicUserProjection: PublicUserProjection | undefined;

/**
 * Configure which user fields reach the browser hydration payload. By default
 * only `id` is serialized. `id` is always taken from the real user. The
 * framework sets this from `createApp({ publicUser })`.
 */
export function setPublicUserProjection(projection: PublicUserProjection | undefined): void {
    publicUserProjection = projection;
}

/** The browser-visible projection of a user: `{ id }` plus any opted-in fields. */
export function toPublicUser(user: User | undefined): User | undefined {
    if (!user) return undefined;
    return { ...publicUserProjection?.(user), id: user.id } as User;
}
