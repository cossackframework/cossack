# @cossackframework/scaffold

Node-only recipe engine shared by `cossack` and `create-cossack-app`.

It owns the application templates, preset and feature registries, dependency
resolution, dashboard modules, conflict-safe change sets, and schema-v2
scaffold manifests.

```js
import { createApp, addFeature } from '@cossackframework/scaffold';

const project = await createApp('my-app', {
  adapter: 'cloudflare',
  preset: 'minimal',
  interactive: false,
});

await addFeature(project.projectDir, 'dashboard', {
  features: ['users', 'sessions'],
  interactive: false,
});
```
