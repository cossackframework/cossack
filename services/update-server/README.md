# The update server

The Cossack CMS asks this server once a day which version is the latest
(`specs/cms-updates.md`, `docs/cms/updates.md`). It is a Cloudflare Worker at
`https://cms.cossack.dev/update`.

```
GET /update?version=0.9.0&channel=latest
```

```json
{
  "channel": "latest",
  "latest": "0.10.0",
  "published": "2026-12-01T00:00:00Z",
  "notes": "https://github.com/cossackframework/cossack/releases/tag/0.10.0",
  "security": false,
  "hostTemplate": "0.10.0",
  "minimumFrom": "0.9.0"
}
```

- `security` is true when a release after the asked version, up to the latest, fixes a
  security problem.
- `hostTemplate` is the scaffold template the latest version needs.
- `minimumFrom` is the oldest version that can go to the latest in one step. It is left out
  when the asking site can.

The server only informs. A site's code always comes from the package registry through its
own project. The server sets no cookie, needs no authentication, and keeps no record of a
request: request logs are off in `wrangler.jsonc`.

## The release list

`releases.json` holds the published versions of each channel and is bundled with the
Worker. A release fills and ships it without a manual step:

1. `pnpm bump <version>` adds the version to `releases.json`, with the CMS's `hostTemplate`.
   Pass `--security` for a release that fixes a security problem and `--minimum-from <version>`
   when older sites must update in two steps. The entry is part of the release commit.
2. `publish.yml` refuses a tag that the list does not name (`scripts/verify-release-version.mjs`).
3. After the packages are on npm, its `update-server` job runs the tests here and deploys the
   Worker. The job needs the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit,
   and Workers Routes: Edit on the `cossack.dev` zone) and `CLOUDFLARE_ACCOUNT_ID`.

By hand, to correct an entry or to add one outside a release:

```bash
pnpm --filter cossack-update-server run release -- --version 0.10.0
```

```bash
pnpm --filter cossack-update-server run deploy
```

Options: `--channel`, `--notes <url>`, `--published <ISO date>`, `--security`,
`--host-template <version>` and `--minimum-from <version>`. A pre-release version goes to the
channel in its name (`0.11.0-canary.1` to `canary`) unless `--channel` says otherwise.

## Work on it

```bash
pnpm --filter cossack-update-server test
pnpm --filter cossack-update-server run dev
```

Deploying needs access to the `cossack.dev` zone on Cloudflare.
