# Project upkeep

## Vite config

`vite.config.ts` is one call. Do not add the framework's plugins by hand:

```ts
import { cossackApp } from 'cossack/vite';
export default cossackApp({ /* options */ });
```

The preset reads the recipe in `package.json#cossack` and adds the plugins for the runtime,
the features and each mounted package. A package adds its part through `cossack.vite` in its
own `package.json`. See `docs/vite-plugins.md`.

## Type checks

`cossack typecheck` (the project's `typecheck` script) writes the generated types
(`wrangler types` on Cloudflare, `.cossack/routes.ts`, `.cossack/config.d.ts`), then runs
`tsc --noEmit`.

## Upgrades

```bash
cossack upgrade                       # move Cossack dependencies, install, merge ejected copies
cossack upgrade --dry-run             # show the plan
cossack upgrade --conflicts=markers   # write conflict markers into an ejected copy
```

The recipe lives in `package.json#cossack`; no project records its scaffold files. An upgrade
changes dependencies and merges only ejected copies and plugins. It lists host steps
(changes a package needs in your files); the build stops with
`COSSACK_PACKAGE_HOST_OUTDATED` until you make them. See `docs/upgrading.md`.

## Ejecting a served file

```bash
cossack eject dashboard /auth/login                    # copy a served page into src/
cossack eject cms "src/pages/(site)/search/index.ts"
cossack eject --diff <path>                            # compare with the package
cossack eject --restore <path>                         # serve the package's file again
```

Only pages, layouts, loading states, configuration files and whole plugins can be ejected.
The copy is recorded in `.cossack/scaffold.json` so `cossack upgrade` can merge later changes.
