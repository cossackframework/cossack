import { input, type InputOf } from '@cossackframework/core/input';

// Inbound action contracts are separate from browser validation rules.
// Passwords are never normalized or truncated. Match the shared hasher's limit.
// Match the generated users.email VARCHAR(191) on every database provider.
const email = input.string({ required: true, email: true, maxLength: 191 });
const password = input.string({ required: true, minLength: 8, maxLength: 1024 })
    .refine(value => new TextEncoder().encode(value).length <= 1024, 'Password exceeds its size limit.');

// The bot check's token, when Turnstile is on (see auth-bot-check.ts).
const turnstile = input.string({ maxLength: 4096 }).optional();

export const loginInput = input.object({ email, password, turnstile });
export type LoginInput = InputOf<typeof loginInput>;

export const registerInput = input.object({ name: input.string({ maxLength: 191 }), email, password, turnstile });
export type RegisterInput = InputOf<typeof registerInput>;

export const resetRequestInput = input.object({ email, turnstile });
export type ResetRequestInput = InputOf<typeof resetRequestInput>;

// The confirmation is checked against the password by the action, which says which one is wrong.
export const resetPasswordInput = input.object({ token: input.string({ required: true, maxLength: 191 }), password, confirm: input.string({ required: true, maxLength: 1024 }) });
export type ResetPasswordInput = InputOf<typeof resetPasswordInput>;


/**
 * A page to return to after signing in, from a `redirect` query: a path on this site outside
 * /auth. Anything else, such as another site's address, gives null.
 */
export function returnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value === '/auth' || value.startsWith('/auth/') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}
