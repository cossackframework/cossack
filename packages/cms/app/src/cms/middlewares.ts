import type { MiddlewareHandler } from 'hono';
// First, and before ../auth: this loads the CMS host and, through it, the page registry, whose
// API routes use `auth` when they load. Loading ../auth first would reach them half-way through it.
import { cmsMiddleware, cmsPrincipal } from './middleware';
import { auth } from '../auth';
import { authGuard } from '../middlewares/auth';

/**
 * The CMS's global middleware, in the order it must run: the CMS host goes on the context
 * before auth reads users from it, then the session, the principal and the sign-in guard.
 * A project lists it in src/bootstrap/middlewares.ts and adds its own after it.
 */
export const cmsMiddlewares: MiddlewareHandler[] = [cmsMiddleware, auth.middleware, cmsPrincipal, authGuard];
