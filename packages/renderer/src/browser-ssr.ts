import type { TemplateResult } from './cossack-html';

/** Import renderer/server explicitly to serialize HTML in a browser. */
export const renderToString = (_result: TemplateResult, _opts: { hydrate?: boolean } = {}): string => {
  throw new Error('Browser HTML serialization requires @cossackframework/renderer/server. Use render() or hydrate() for DOM updates.');
};
