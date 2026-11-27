---
title: "Project Structure"
description: "Overview of the Cossack project structure including src directories for pages, components, services, and configuration files."
---

# Project Structure

This section describes the folders and files in a Cossack project.

```
├── src
│   ├── bootstrap
│   │   └── middlewares.ts
│   ├── client
│   │   └── entry-client.ts
│   ├── components
│   ├── config
│   ├── middlewares
│   ├── pages
│   │   └── index.ts
│   ├── services
│   ├── App.ts
│   ├── index.ts
│   ├── root.ts
│   ├── style.css
│   └── vite-env.d.ts
├── public
├── .dev.vars          (Cloudflare; Node.js projects have .env and scripts/dev.js)
├── .gitignore
├── AGENTS.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vite.config.dev.ts
├── vitest.config.ts
├── wrangler.jsonc     (Cloudflare only)
└── README.md
```

New projects start with the files listed above; `components`, `middlewares` and
`services` are conventional folders that `cossack generate` and the features fill.
`package.json#cossack` records the project's runtime and features. A project does
not keep a record of the scaffold's files, and the sign-in pages, the dashboard and
the CMS are served from their packages instead of being copied into `src`.

# src
The `src` folder contains the application code. It can include frontend and backend code.
- `components`: Reusable components for pages.
- `pages`: Pages and layouts. See [Routing](/docs/routing.md) for page naming rules.
- `services`: Services that hold business logic or fetch data. The dependency injection system can provide these services to pages. See [Services](/docs/services.md).
- `middlewares`: Functions that run before or after a page handles a request. Use them for tasks such as authentication and logging. See [Middlewares](/docs/middlewares.md).
- `bootstrap/middlewares.ts`: The list of global middlewares that `createApp()` loads for every request.
- `config`: Configuration factories read with `config()`. See [Configuration](/docs/config.md).
- `client/entry-client.ts`: The browser entry point. It imports `style.css` and calls `createClientApp()`.
- `style.css`: Global application styles.
- `root.ts`: Exports the HTML document `template` (see [Customizing the HTML Template](/docs/customizing-html-template.md)).
- `index.ts`: The server entry point. It calls `createApp()` and exports the Worker's `fetch` handler (Cloudflare) or starts the Node.js server.
- `App.ts`: A component that wraps all pages. Use it for shared layout and structure.

`vite.config.ts` is one call, `export default cossackApp()` from `cossack/vite`. See [Vite plugins](/docs/vite-plugins.md) for its options. `vite.config.dev.ts` is an overlay for working against a linked local framework checkout: the Node.js `scripts/dev.js` applies it when `COSSACK_LOCAL` is set.

Import application files from `src` with the `@/` alias, for example `import { User } from '@/models/User'`. The preset and `tsconfig.json` both map `@/*` to `src/*`.
