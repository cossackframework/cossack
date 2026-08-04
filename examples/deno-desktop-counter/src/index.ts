import './desktop/bindings';
import { createDenoAdapter } from '@cossackframework/deno-adapter';
import { createApp } from '@cossackframework/framework/router';
import { App } from './App';
import { template } from './root';

export const env: Record<string, unknown> = Deno.env.toObject();
export const runtime = createDenoAdapter({ env });
export const app = createApp({ AppComponent: App, htmlTemplate: template, runtimeAdapter: runtime });

export default {
  fetch: (request: Request, requestEnv?: Record<string, unknown>) =>
    runtime.fetch(app, request, requestEnv),
};
if (import.meta.main && typeof (Deno as any).BrowserWindow !== 'function') {
  runtime.serve(app);
}
