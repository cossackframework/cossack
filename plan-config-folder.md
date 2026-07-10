# Plan - Default `config` Folder

Currently, we are using `env` variables for all configuration. Most of the time, we will be using `wrangler.jsonc` `vars` for configuration. 
However, for advanced app with a lot of configuration, this will become cumbersome.

## Proposal

We will make `config` folder like Laravel's `config` folder, actually we already have in the `packages/framework/src/config` and `packages/create-cossack-app/template/src/config` but it for storing `middlewares` only, and actually `middlewares.ts` is doing side effect, it is not a configuration file, it is a code file so let's create `bootstrap` folder and move `middlewares.ts` to `bootstrap` folder.

All the configuration file will be stored in the `config` folder, which is just return an object, and we will use `config` function to get the configuration value.

Example:

```ts
// config/app.ts
export default {
    name: 'My App',
    env: env('APP_ENV', 'production'),
}
```

```ts
// config/database.ts
export default {
    driver: env('DB_CONNECTION', 'mysql'),

    connections: {
        mysql: {
            host: env('DB_HOST', 'localhost'),
            port: env('DB_PORT', 3306),
            username: env('DB_USERNAME', 'root'),
            password: env('DB_PASSWORD', ''),
            database: env('DB_DATABASE', 'myapp'),
        }
    }
}
```

In order to get the configuration value, we will use `config` function:

```ts
import { config } from '@cossackjs/framework'

const appName = config('app.name') // My App
const dbDriver = config('database.driver') // mysql
```

For the `env` and `config` function, we might leverage ALS (Asynchronous Local Storage).
