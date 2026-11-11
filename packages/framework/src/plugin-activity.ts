import type { Context, MiddlewareHandler } from 'hono';

/** Property the middleware registry sets on a plugin's middleware: the plugin's name. */
export const PLUGIN_MIDDLEWARE_OWNER = 'cossackPlugin';

type PluginActivity = (plugin: string, c: Context) => boolean | Promise<boolean>;
let activity: PluginActivity | undefined;

/**
 * The application's `isPluginActive` (from `createApp`), kept for code that runs
 * outside the router's request pipeline, such as realtime replays in a Durable Object.
 */
export function setPluginActivity(predicate: PluginActivity | undefined): void {
  activity = predicate;
}

/**
 * Global middleware with each plugin's entries wrapped so they run only while the
 * plugin is active for the request; an inactive plugin's middleware passes through.
 * Application middleware is returned as it is.
 */
export function gatePluginMiddlewares(list: readonly MiddlewareHandler[], predicate: () => PluginActivity | undefined = () => activity): MiddlewareHandler[] {
  return list.map(middleware => {
    const plugin = (middleware as unknown as Record<string, unknown>)[PLUGIN_MIDDLEWARE_OWNER];
    if (typeof plugin !== 'string') return middleware;
    return async (c, next) => {
      const isActive = predicate();
      if (isActive && !await isActive(plugin, c)) return next();
      return middleware(c, next);
    };
  });
}

/**
 * Middleware that stops the request, without calling `next`, while the plugin
 * is inactive: for realtime replays of a plugin page's guards, matching the
 * router's gate on the plugin's routes.
 */
export function pluginActivityGate(plugin: string, predicate: () => PluginActivity | undefined = () => activity): MiddlewareHandler {
  return async (c, next) => {
    const isActive = predicate();
    if (isActive && !await isActive(plugin, c)) return c.notFound();
    return next();
  };
}
