// src/config/auth.ts
//
// Auth configuration. Read values anywhere with `config('auth.<key>')`:
//
//   config('auth.redirectAfterLogin')   // '/dashboard'
//   config('auth.redirectAfterLogout')  // '/auth/login'
//
// Both defaults are env-overridable.
import type { EnvFunction } from '@cossackframework/framework/config';
import { authOptions } from '../auth-options';

export interface AuthConfig {
  /** Where to send users after a successful login or registration. */
  redirectAfterLogin: string;
  /** Where to send users after logout, or when an unauthenticated user hits a private route. */
  redirectAfterLogout: string;
}

// Register the typed shape so `config('auth.redirectAfterLogin')` infers `string`.
declare module '@cossackframework/framework/config' {
  interface CossackConfigRegistry {
    auth: AuthConfig;
  }
}

export default ({ env }: { env: EnvFunction }): AuthConfig => ({
  // The default is the project's choice (src/dashboard.config.ts): the dashboard, or the home page without one.
  redirectAfterLogin: env('AUTH_REDIRECT_AFTER_LOGIN', authOptions.redirectAfterLogin),
  redirectAfterLogout: env('AUTH_REDIRECT_AFTER_LOGOUT', '/auth/login'),
});
