---
title: "Project Structure"
description: "Overview of the Cossack project structure including src directories for pages, components, services, and configuration files."
---

# Project Structure

This section describes the folders and files in a Cossack project.

```
├── src
│   ├── client
│   ├── components
│   ├── storage
│   ├── pages
│   ├── services
│   ├── middlewares
│   └── App.ts
│   └── index.ts
│   └── root.ts
│   └── style.css
├── public
├── scripts
├── .env
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.ts
├── wrangler.jsonc
└── README.md
```

# src
The `src` folder contains the application code. It can include frontend and backend code.
- `components`: Reusable components for pages.
- `storage`: Code for storage services such as R2 and KV.
- `pages`: Pages and layouts. See [Routing](/docs/routing.md) for page naming rules.
- `services`: Services that hold business logic or fetch data. The dependency injection system can provide these services to pages. See [Services](/docs/services.md).
- `middlewares`: Functions that run before or after a page handles a request. Use them for tasks such as authentication and logging. See [Middlewares](/docs/middlewares.md).
- `client`: Code that runs in the browser.
- `style.css`: Global application styles.
- `root.ts`: The root component. Use it to define the global layout.
- `index.ts`: The application entry point. It starts the server.
- `App.ts`: A component that wraps all pages. Use it for shared layout and structure.
