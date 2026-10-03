import type { Context } from 'hono';

export function decodeRuntimeRouteParams(encoded: string | undefined): Record<string, string> {
  if (encoded === undefined) return {};
  const parsed: unknown = JSON.parse(encoded);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('WebSocket route params must be a JSON object');
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw new TypeError('WebSocket route params must contain strings');
    params[key] = value;
  }
  return params;
}

/** Give a custom page scope the original page params while retaining the live request context. */
export function withRuntimeRouteParams(
  context: Context,
  params: Record<string, string>,
): Context {
  const request = new Proxy(context.req, {
    get(target, property) {
      if (property === 'param') {
        return (key?: string) => key === undefined ? { ...params } : params[key];
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(context, {
    set(target, property, value) { return Reflect.set(target, property, value, target); },
    get(target, property) {
      if (property === 'req') return request;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
