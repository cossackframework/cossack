import type { Context, MiddlewareHandler } from 'hono';

export interface AuthProvider<User> {
  extractSessionId: (c: Context) => string | undefined | Promise<string | undefined>;
  validateSessionId: (sessionId: string, c: Context) => Promise<string | null>;
  resolveUserById: (userId: string, c: Context) => Promise<User | null>;
}

export type LoginHandlerOptions<User> = {
  validateCredentials: (credentials: any, c: Context) => Promise<User | null>;
  createSession: (user: User, c: Context) => Promise<{ headers: Headers }>;
};

export type AuthKit<User> = {
  middleware: MiddlewareHandler<{ Variables: { user?: User } }>;
  createLoginHandler: (options: LoginHandlerOptions<User>) => MiddlewareHandler;
};

export function createAuth<User>(provider: AuthProvider<User>): AuthKit<User> {
  const middleware: MiddlewareHandler<{ Variables: { user?: User } }> = async (c, next) => {
    const sessionId = await provider.extractSessionId(c);
    if (!sessionId) {
      return await next();
    }

    const userId = await provider.validateSessionId(sessionId, c);
    if (!userId) {
      return await next();
    }

    const user = await provider.resolveUserById(userId, c);
    if (user) {
      c.set('user', user);
    }

    await next();
  };

  const createLoginHandler = (loginOptions: LoginHandlerOptions<User>): MiddlewareHandler => {
    return async (c: Context) => {
      const credentials = await c.req.json();
      const user = await loginOptions.validateCredentials(credentials, c);

      if (!user) {
        return c.json({ error: 'Invalid credentials' }, 401);
      }

      const { headers } = await loginOptions.createSession(user, c);
      const response = c.json({ success: true });
      
      headers.forEach((value, key) => {
        response.headers.append(key, value);
      });

      return response;
    };
  };

  return { middleware, createLoginHandler };
}
