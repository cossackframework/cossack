import { createAuthorizer } from '@cossackframework/auth';
import { defineServerMiddleware } from '@cossackframework/core';

const authorizer = createAuthorizer({
  onUnauthorized: (c, reason) => {
    // RPC needs a coded error instead of a redirect to an HTML login page.
    if (c.req.path === '/crpc' || c.req.path === '/upload' || c.req.path.startsWith('/ws/')) {
      return c.json({ error: reason === 'unauthenticated' ? 'Authentication required' : 'Forbidden',
        code: reason === 'unauthenticated' ? 'COSSACK_RPC_UNAUTHENTICATED' : 'COSSACK_RPC_FORBIDDEN' },
        reason === 'unauthenticated' ? 401 : 403);
    }
    return c.redirect(config('auth.redirectAfterLogout'));
  },
});

// Global auth.middleware resolves the session; this layout guard requires it.
export const requireProtectedUser = defineServerMiddleware(authorizer.requireUser);
