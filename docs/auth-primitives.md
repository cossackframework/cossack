---
title: "Credential and session primitives"
description: "Share password verification and session policy while keeping account and storage code in the application."
---

# Credential and session primitives

`cossack add auth` now composes the shared auth library with application models.
The application owns account lookup, roles, database access and password reset.
The library owns password encoding, credential verification, session expiry,
rotation and cookie headers. Auth imports Web APIs and Hono only.

## Password hashes

`hashPassword` and `verifyPassword` use PBKDF2-HMAC-SHA256 with 100,000
iterations, a random 16-byte salt and a 32-byte digest. The stored format is:

```text
pbkdf2-sha256$iterations$lowercase-salt-hex$lowercase-digest-hex
```

Inputs must be nonempty and fit within 1,024 UTF-8 bytes. The helpers never
truncate or normalize them. Malformed encodings and excessive stored work factors
are rejected before key derivation. The old `pbkdf2$salt$digest` format needs an
explicit application migration or a password reset.

Use `createPasswordHasher({ iterations, maxIterations, maxPasswordBytes })` to
configure these limits. `maxIterations` defaults to `iterations`. A stronger
accepted hash is never classified for downgrade. A custom `PasswordHasher` can
provide another server hashing implementation.

The default preserves the existing generated Workers setting. As checked on
2026-10-05, [workerd's default limit](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h)
is 100,000 iterations. Local simulator success does not establish production
limits. This factor is below the 600,000 PBKDF2-SHA256 iterations in
[OWASP's password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Verify the target runtime before increasing the factor or choosing a custom hasher.

## Credential verification

`createCredentialVerifier` takes typed `find`, `passwordHash` and `user`
callbacks. Account records can include secrets; the `user` callback returns the
safe application user only after successful verification. Missing accounts,
missing hashes and rejected passwords return `null`. Identifier normalization,
password policy and rate limiting belong to the application.

An optional `replacePasswordHash(record, expectedHash, replacement)` callback
upgrades a verified lower-cost hash. It must compare and replace atomically.
Return `true` only if the expected hash still matches. A lost conditional write
rejects that login before user mapping. A read followed by an unconditional write
can overwrite a concurrent password change.

This callback does not provide a transaction across later account lookup and
session creation. Compose stronger account consistency in application storage.
Capture request-scoped database facilities in callbacks or use the application's
request ORM scope.

## Persistent sessions

`createSessionManager` accepts an `AuthSessionStore` and returns `create`,
`validate`, `rotate`, `revoke` and `expiredCookie`. An `AuthSessionRecord` contains
`id`, `userId`, `kind: 'auth'`, `createdAt` and `expiresAt`. Times are Unix
milliseconds. New tokens use 32 random bytes encoded as 64 lowercase hex digits.

The default lifetime is seven days. Validation rejects exact expiry and never
refreshes it. Rotation explicitly starts a new lifetime. The storage contract is:

| Callback | Required behavior |
| --- | --- |
| `create(record, context)` | Insert a new record. Do not overwrite an existing token. |
| `read(id, context)` | Return an auth record or `null`. Preserve its original timestamps. |
| `replace(expected, replacement, now, context)` | Atomically replace the complete expected record only while it remains active. Exactly one concurrent replacement may win. |
| `revoke(id, context)` | Delete the auth record. Preserve records for other purposes. |

The generated adapter uses one conditional SQL `UPDATE`, matching token,
account, creation time, expiry and the canonical `{"type":"auth"}` metadata.
It also checks expiry at the write. One affected row means success. Its `DELETE`
targets that same auth purpose. Reset tokens cannot authenticate, rotate or be
removed by logout. Existing stores with other JSON encodings must adapt their
conditional matching or normalize the metadata explicitly.

Every callback receives the Hono request context. SQL, transactions and
cross-process atomicity remain storage responsibilities. See the generated
[adapter](../packages/scaffold/template/src/auth.ts) for the D1/SQLite composition.

## Compose the session middleware

Use the manager with `createAuth` so every new HTTP request checks stored expiry
before user resolution. Supply a safe user resolver and your store:

```typescript
import { createAuth, createSessionManager, type AuthSessionStore } from '@cossackframework/auth';
import { getCookie } from 'hono/cookie';

type PublicUser = { id: string; email: string };

export function configureSessions(
  store: AuthSessionStore,
  resolveUserById: (id: string) => Promise<PublicUser | null>,
) {
  const sessions = createSessionManager({ store });
  const auth = createAuth<PublicUser>({
    extractSessionId: c => getCookie(c, sessions.cookieName),
    validateSessionId: async (id, c) => (await sessions.validate(id, c))?.userId ?? null,
    resolveUserById,
    createSession: (user, c) => sessions.create(user.id, c),
  });
  return { auth, sessions };
}
```

Register `auth.middleware` in `src/bootstrap/middlewares.ts`. Login and OAuth
callbacks can reuse `auth.createSession`. Rotation returns `null` for an invalid
token or a lost conditional replacement. Choose the application's response for
that case.

Session operations return `Headers` after storage succeeds. Apply these headers
to the response. Default cookies use `session_id`, `Path=/`, `HttpOnly`, `Secure`
and `SameSite=Lax`. Configure the name, path, domain and same-site policy through
`cookie`. Clearing uses the same policy with `Max-Age=0`. Never copy tokens or
cookie headers into public page state.

## Diagnostics and limits

`AuthError` has a fixed `code`, `stage` and `message`. Use `error.toJSON()` for
logs. Raw crypto, lookup, mapping and storage exceptions are discarded. Codes
distinguish password, credential and session operations without exposing account
data. The [OAuth guide](./oauth.md#failure-diagnostics) describes
the separate `OAuthError` contract.

Operations that fail after a committed write do not roll that write back. A
session that expires during storage completion issues no cookie. Request
validation does not refresh the identity of an already-open WebSocket. Callback
cookie deletion does not provide atomic OAuth replay protection.

The packaged `credential-and-session-primitives` agent guide includes an
executable typed example. Its memory store illustrates callbacks; generated
Node SQLite and Cloudflare D1 tests verify persistent expiry, revocation and
concurrent rotation.
