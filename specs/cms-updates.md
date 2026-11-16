# CMS updates: the update notice, the Update button, and the update server

Status: built 2026-11-15. The update server (a separate, private repository since 2026-11-16) is deployed at `cms.cossack.dev/update` since 2026-11-15. Part 4 of 4, after `specs/package-routes.md`,
`specs/cms-served-app.md` and `specs/upgrade-merges.md`. The update server is a
separate service that is built later; this spec fixes its contract.

## Why

Once the CMS is served from its package, an update is one command,
`cossack upgrade`. A site owner who does not use a terminal still cannot run it.
This spec gives the dashboard a notice that a new version exists and one button
that updates the site.

A running site cannot update itself: on Workers the code is a deployed bundle, and
on Node a rebuild needs the source. So the button does not change code. It asks
the project's own build pipeline to run `cossack upgrade`, and that pipeline
deploys as it does for any other commit.

## What is true today (2026-11-15)

- The CMS does not know which version is the latest, and it shows its own version
  nowhere. `@cossackframework/cms` and `cossack` are both at 0.9.0.
- `cossack upgrade` (`packages/cossack/src/commands/upgrade.js`) already moves the
  `@cossackframework/*` dependencies to a release (`--tag`, default `latest`),
  installs, and prints a plan as JSON (`--json`).
- The scaffold renders one workflow, `.github/workflows/preview.yml`, for
  Cloudflare projects (`scaffold/src/index.js` 132, 416). It is started by hand.
- Site exports exist (`packages/cms/src/server/site-export.ts`, Tools → Export).
- Outbox topics and the clock run background work (`cache.purge`, `plugin.job`,
  `packages/cms/src/server/schedules.ts`).
- Schema steps run when the new build starts, and an older build refuses a newer
  database (`specs/upgrade-merges.md`, "docs/upgrading.md").

## Decisions

### The update notice

- **The CMS asks the update server once a day.** A core clock job sends
  `GET <updates.url>?version=<installed>&channel=<channel>` and stores the answer
  in one settings row. The dashboard reads the row; it never calls the server
  while it renders a page. A failed check keeps the last answer and is retried the
  next day.
- **What is sent:** the installed CMS version and the channel. Nothing else: no
  site URL, no site name, no account, no plugin list. The docs say this.
- **Configuration, in `src/cms.config.ts`:**
  `updates: { check: true, url: 'https://cms.cossack.dev/update', channel: 'latest' }`.
  `check: false` turns the request off; the dashboard then shows only the installed
  version.
- **Where it shows:** Tools → Updates (new page), and the Tools menu entry reads
  `Updates (1)` while a newer version is known. Only for users who hold the new
  `cms:updates` permission (administrators hold every permission), on the main
  site; in a network, network administrators only. The page shows the
  installed version, the latest version, the release notes link, and whether the
  release is marked as a security fix.
- **The installed version** comes from the package's `package.json` at build time
  (a constant the package exports), not from a setting.

### The Update button

- **The button sends one request to an update hook.** The project sets two values
  in its environment, never in the database:
  - `CMS_UPDATE_HOOK_URL`: where to send the request;
  - `CMS_UPDATE_HOOK_TOKEN`: sent as `Authorization: Bearer <token>`.

  The body is
  `{ "event_type": "cossack-update", "client_payload": { "version": "<target>" } }`.
  This is GitHub's `repository_dispatch` shape, so the URL can be
  `https://api.github.com/repos/<owner>/<repo>/dispatches` with a fine-grained
  token, and any other pipeline can accept the same body.
- **Without a hook the button is not shown.** The page shows the command to run
  instead (`pnpm cossack upgrade`), and a link to the setup guide.
- **The scaffold renders the receiving workflow,**
  `.github/workflows/cossack-update.yml`, for every project with the cms feature.
  It runs on `repository_dispatch` (`cossack-update`) and on `workflow_dispatch`:
  1. check out, install with the locked dependencies;
  2. `pnpm cossack upgrade --tag <version> --json`;
  3. type-check, test and build;
  4. commit, then either open a pull request (the default) or push to the default
     branch. A repository variable, `COSSACK_UPDATE_MODE` (`pull-request` or
     `push`), chooses.

  The project's existing deploy (Workers Builds, or its own workflow) then ships
  the commit. The update workflow holds no deploy secret.
- **Conflicts never block silently.** If `cossack upgrade` reports conflicts, the
  workflow always opens a pull request with the plan in its description, also in
  `push` mode.
- **A backup first.** The form says that an older build cannot open the database
  after the update, and that going back means restoring a backup together with the
  older code. It links to Tools → Export, and the button works only after the
  person ticks "I have a backup". The button does not take the export itself: an
  export streams to the browser, and nothing keeps one on the server.
- **State.** One settings row holds `requestedVersion`, `requestedAt` and
  `requestedBy`. While it is set, the page shows "Update requested" and the button
  is disabled. The row clears when the running version is at least the requested
  one, or after 24 hours, or by hand ("Request again"). The page links to the
  repository's Actions page when the hook URL is a GitHub URL. The pipeline does
  not call the site back in this version.
- **Safety:**
  - Only `cms:updates` holders can press it. In a network, only network
    administrators.
  - The request is written to the activity log, with the user and the version.
  - The target version is the one stored by the update check. The browser cannot
    name another one.
  - The token never reaches the browser or the database.

### The update server

- **Address:** `https://cms.cossack.dev/update`. Until it exists, the check fails
  quietly and the dashboard shows only the installed version.
- **Request:** `GET /update?version=0.9.0&channel=latest`. No cookies, no body, no
  authentication.
- **Response (`application/json`, `Cache-Control: public, max-age=3600`):**

  ```json
  {
    "channel": "latest",
    "latest": "0.10.0",
    "published": "2026-12-01T00:00:00Z",
    "notes": "https://cossack.dev/releases/0.10.0",
    "security": false,
    "hostTemplate": "0.10.0",
    "minimumFrom": "0.9.0"
  }
  ```

  - `security` is true when any release after `version` up to `latest` fixes a
    security problem.
  - `hostTemplate` is the template the latest CMS needs. `cossack upgrade` handles
    it; the field is there so the page can say "this update also changes project
    files".
  - `minimumFrom` is the oldest version that can go to `latest` in one step. An
    older site is told to update in two steps. Omitted when there is no limit.
- **The server only informs.** The code always comes from the package registry
  through the project's lockfile and pipeline. A wrong answer from the server can
  show a wrong notice, and nothing more. The CMS accepts `latest` only when it is a
  valid version that is newer than the installed one.
- **Implementation:** a Cloudflare Worker on the custom domain `cms.cossack.dev`, in
  its own private repository (moved out of this one 2026-11-16: it is not open
  source). Its `releases.json` lists each channel's published versions and is
  bundled with the Worker. A release adds its version there and deploys the Worker
  by hand, after the packages are on npm; nothing in this repository names the list.
  It computes `security` and `minimumFrom` over the releases the asking site would
  skip. Request logs are off. Deploying needs access to the `cossack.dev` zone.

## Order

1. The installed-version constant, the `updates` options in `cms.config.ts`, the
   daily check job, the settings row. Tests with a stub server: newer, same,
   older, invalid answer, server down, `check: false`.
2. Tools → Updates and the taskbar badge, with the `updates.manage` permission.
3. The hook request, the confirm dialog with the export, the request state and the
   activity entry. Tests: no hook configured, the request body and header, a second
   press while one is pending, a user without the permission.
4. The scaffold's `cossack-update.yml`, asserted in `cms-recipe.test.js`.
5. Docs: `docs/cms/updates.md` (new: the notice, what is sent, the hook setup for
   GitHub, other pipelines, backups) and a link from `docs/upgrading.md`.
6. The update server, in its own repository. Deploying it is a separate, manual step.

## Done when

- A site with an older version and a stub update server shows the notice to an
  administrator, and to no one else.
- Pressing Update on a site with a hook sends one request with the stored version,
  after an export, and records it.
- In a test repository, the dispatch runs `cossack-update.yml` and opens a pull
  request that contains only the dependency and lockfile changes for a
  package-only release.
- With `check: false` the site sends no request.

## Not in this change

- Automatic updates without a click.
- Updating plugins from the dashboard (`cossack plugins upgrade` stays a command).
- Progress reported back from the pipeline to the dashboard.
- Pipelines other than GitHub Actions as rendered files. The hook body works with
  any of them.
