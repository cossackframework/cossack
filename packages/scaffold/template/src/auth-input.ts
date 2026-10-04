import { input, type InputOf } from '@cossackframework/core/input';

// Inbound action contracts are separate from browser validation rules.
// Passwords are never normalized or truncated. Match the shared hasher's limit.
// Match the generated users.email VARCHAR(191) on every database provider.
const email = input.string({ required: true, email: true, maxLength: 191 });
const password = input.string({ required: true, minLength: 8, maxLength: 1024 })
    .refine(value => new TextEncoder().encode(value).length <= 1024, 'Password exceeds its size limit.');

export const loginInput = input.object({ email, password });
export type LoginInput = InputOf<typeof loginInput>;

export const registerInput = input.object({ name: input.string({ maxLength: 191 }), email, password });
export type RegisterInput = InputOf<typeof registerInput>;

export const resetRequestInput = input.object({ email });
export type ResetRequestInput = InputOf<typeof resetRequestInput>;

export const resetPasswordInput = input.object({ token: input.string({ required: true, maxLength: 191 }), password });
export type ResetPasswordInput = InputOf<typeof resetPasswordInput>;
