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
