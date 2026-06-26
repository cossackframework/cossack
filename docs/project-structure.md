---
title: "Project Structure"
description: "Overview of the Cossack project structure including src directories for pages, components, services, and configuration files."
---

# Project Structure

In this section, we will go through the project structure of our framework. We will explain the purpose of each folder and file, and how they are organized.

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
The `src` folder contains all the source code of our application. This is where we will write all our frontend and backend code.
- `components`: This folder contains all the reusable components that we can use in our pages. These components can be used to build our UI and can be shared across different pages.
- `storage`: This folder contains all the code related to storage, such as R2 and KV.
- `pages`: This folder contains all the pages and layouts of our application. The naming convention for the pages is documented in the [Routing](/docs/routing.md) section.
- `services`: This folder contains all the reuseable services that can be used across different pages. These services can be used to handle business logic, data fetching, and other functionalities that are not directly related to the UI. These services can be injected into our pages by our dependency injection system, which allows us to easily manage our dependencies and keep our code organized. Refer to the [Services](/docs/services.md) section for more details on how to create and use services in our framework.
- `middlewares`: This folder contains all the middlewares that we can use in our application. Middlewares are functions that can be executed before or after a request is handled by a page. They can be used to handle authentication, logging, and other functionalities that are not directly related to the UI. Refer to the [Middlewares](/docs/middlewares.md) section for more details on how to create and use middlewares in our framework.
- `client`: This folder contains all the code that will be executed on the client side.
- `style.css`: This file contains the global styles for our application. We can import this file in our pages to apply the global styles.
- `root.ts`: This file contains the root component of our application. This is where we can define the global layout and structure of our application.
- `index.ts`: This is the entry point of our application. This is where we will initialize our application and start the server.
- `App.ts`: A special component that can be used to wrap all the pages. This is useful for defining global layouts and structures that are shared across all pages.
