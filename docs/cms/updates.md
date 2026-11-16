---
title: 'Updates'
description: 'How a CMS site learns about new versions, and how the Update button asks the project to update itself.'
---

# Updates

The CMS is a package of your project. A new version reaches a site in three steps: the project's dependencies change, the project is built, and the build is deployed. A running site cannot do these steps to itself. So the dashboard tells you when a version is available, and one button asks your project's pipeline to do the work.

## The update notice

Once a day the site asks an update server which version is the latest. Tools → Updates shows the installed version, the latest one, the release notes, and whether the release fixes a security problem. The Tools menu shows `Updates (1)` while a newer version is known.

- **What is sent:** the installed CMS version and the channel. Nothing about the site: no address, no name, no account, no plugin list.
- **Who sees it:** users whose role has the `cms:updates` permission (administrators have every permission), on the main site. In a network the software is shared by every site, so only network administrators see it.
- **When it runs:** with the site's scheduled upkeep, never while a page renders. If the server does not answer, the last answer is kept and the site asks again the next day.

Configure it in `src/cms.config.ts`:

```ts
export const options: CmsProjectConfig = {
    updates: {
        check: true,                               // false: the site sends no request
        url: 'https://cms.cossack.dev/update',     // the update server
        channel: 'latest',                         // or a pre-release channel
    },
};
```

The update server only informs. Code always comes from the package registry, through your project's lockfile and pipeline. A wrong answer can show a wrong notice and nothing more. Cossack's server sets no cookie and keeps no record of a request. You can run your own and name it in `updates.url`: it answers `GET <url>?version=<installed>&channel=<channel>` with JSON, `{ "latest": "0.10.0" }` and optionally `published` (an ISO date), `notes` (a link), `security` (true or false), `hostTemplate` and `minimumFrom` (versions).

## The Update button

The button appears under Tools → Updates when the site has an update hook. It sends one request to the hook. Your pipeline then runs `cossack upgrade`, checks the result, and opens a pull request or pushes, as you set it up.

Set two values in the site's environment (`.dev.vars` or `.env` locally, secrets in production). They are never stored in the database and never sent to the browser.

| Name | Value |
| --- | --- |
| `CMS_UPDATE_HOOK_URL` | Where to send the request. |
| `CMS_UPDATE_HOOK_TOKEN` | Sent as `Authorization: Bearer <token>`. |

The request body is:

```json
{ "event_type": "cossack-update", "client_payload": { "version": "0.10.0" } }
```

The version is the one the update check stored. The browser cannot name another.

### With GitHub

`cossack add cms` writes `.github/workflows/cossack-update.yml`. To connect the button to it:

1. Create a fine-grained personal access token for the repository with **Contents: read and write**.
2. Set `CMS_UPDATE_HOOK_URL` to `https://api.github.com/repos/<owner>/<repository>/dispatches`.
3. Set `CMS_UPDATE_HOOK_TOKEN` to the token.
4. In the repository settings, allow GitHub Actions to create pull requests.

The workflow:

1. Installs the locked dependencies.
2. Runs `cossack upgrade --tag <version>`, which updates the dependencies and merges the project's files with your edits.
3. Type-checks and builds.
4. Opens a pull request with the plan in its description.

To push to the default branch instead, set the repository variable `COSSACK_UPDATE_MODE` to `push`. The workflow still opens a pull request when a file needs you (a merge conflict, a plugin that could not be upgraded) or when a check fails. Your normal deploy ships the commit. The workflow holds no deploy secret.

You can also start the workflow by hand from the Actions tab.

### With another pipeline

Any service that accepts an HTTP request can be the hook. It receives the body above with the bearer token. Run these commands in the project:

```bash
pnpm install --frozen-lockfile
pnpm exec cossack upgrade --tag <version> --json
```

Then test, commit and deploy as you do for any change.

### Without a hook

The page shows the command to run in the project:

```bash
pnpm cossack upgrade
```

## After you press Update

The page shows "Update requested" with the version and the time, and a link to the pipeline's progress when the hook is GitHub. The request ends when the site runs the requested version, or after a day. "Request again" clears it sooner. The request is written to the activity log with the user and the version.

## Backups

Take a backup before an update: Tools → Export, or a copy of the database. An update may change the database, and an older build cannot open it afterwards. Going back to an older version means restoring the backup together with the older code. The button asks you to confirm that you have one. See [Upgrading](/docs/upgrading.md).

## Networks

One network runs one version of the CMS, so there is one notice and one request for all its sites. They are on the network host, for network administrators.
