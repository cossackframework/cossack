# Plugin capabilities: files, mail, jobs, schedules, users, cache and secrets

Builds on `specs/cms-app-builder.md` (plugins as trusted build-time modules, grants in
`cms_grants`) and `specs/cms-cache.md` (the outbox as the durable after-commit path). The gap
found on 2026-11-07 (`plan-cms-feature-gaps.md`, group C1): a plugin reaches hooks, commands,
its own resources, its settings and a fenced `fetch`, so a generated store, booking, membership
or notification plugin cannot store a file, send an email, run work later or on a schedule, read
the site's members, keep a cache or hold a key. The Platform generates plugins against this
surface, so its shape comes before its first business app.

## Decisions

- **Capabilities are permissions.** A manifest asks in `permissions`: `files`, `mail`, `jobs`,
  `cache` (booleans), `users` (`read`, `write`) and `secrets` (names). They become the grants
  `capability:<name>`, `users:<action>` and `secret:<NAME>`, requested with resources, hosts and
  hooks, shown to the administrator, and an upgrade that asks for more waits for a new grant.
  Every `PluginContext` carries every member; a call checks that the plugin is active and the
  grant held and throws `CMS_FORBIDDEN` (not declared or not granted) or `CMS_UNAVAILABLE`
  (inactive, or the site has no storage or no mail). Nothing is checked at `register()`.
- **Files are library files the plugin owns.** `context.files` uploads through the
  `FileService` as the system principal with owner `plugin:<name>`, so the file shows in the
  media library and in "where used"; the plugin updates and deletes its own files, reads and
  lists any, and `url(file)` is the public address. Without storage: `CMS_UNAVAILABLE`.
- **Mail goes out as the site.** `context.mail.send({ to, subject, text, replyTo })` uses the
  site's sender; one recipient, a subject up to 200 characters and text up to 100 KB. The grant
  is the quota: a plugin that spams is revoked.
- **Jobs ride the outbox.** `context.jobs.handle(name, handler)` names handlers at register
  time; `context.jobs.enqueue(name, payload, { at | delayMs, key })` writes an outbox row with
  topic `plugin.job` and `available_at` as the run time. The row's action is the internal
  `cms.plugin.job`, with one host handler per plugin that runs the plugin's handler of that name;
  retries, backoff and dead letters are the outbox's. A `key` becomes the row ID, so the same key
  queues once (`enqueue` returns false the second time). Payloads are JSON up to 64 KB. The
  handler runs as the system principal `plugin:<name>`.
- **Schedules are jobs the clock queues.** The manifest's `schedules` (`name`, `cron`,
  `description`; needs `jobs`) are five-field UTC cron expressions as Cloudflare reads them
  (day of week 1 = Sunday to 7 = Saturday, names allowed; day of month and day of week match
  either). `CmsSchedules.tick()` runs from maintenance (on request at most once a minute, the
  Node timer, the Workers cron): each schedule has a `cms_schedules` row with its next time; when
  it is due, the tick queues the job `name` with `{ cron, scheduledAt }` under the ID
  `schedule:<plugin>:<name>:<scheduledAt>` and advances the row with a conditional update, so
  isolates never queue the same occurrence twice and missed occurrences collapse into one.
  `nextCronTime` (`src/cron.ts`, pure) finds the next minute by walking days, validated with the
  framework's `validateScheduleCron`.
- **Users: members, not accounts.** `read` gives `get`, `findByEmail` and `list` of the site's
  members with their emails and roles. `write` gives `create` (roles limited to the assignable
  set: roles whose every permission is the plugin's own, `<plugin>:…` or `<plugin>/…`, or none,
  such as `subscriber`; never a role holding anything of the host's or another plugin's) and
  `setMeta(id, value)` under the plugin's own key in the user's meta. Passwords, roles of existing users, status and deletion stay with
  administrators.
- **Cache is a namespace.** `context.cache` is the host's `CmsCache` with keys prefixed
  `plugin:<name>:` (plugin keys up to 150 characters): `get`, `set(key, value, ttlMs)`, `delete`,
  `remember`.
- **Secrets are bindings the plugin names.** `permissions.secrets` lists names matching
  `^[A-Z][A-Z0-9_]{1,63}$` outside the host's own (`ROMEDB_*`, `APP_*`, `CMS_*`, `CLOUDFLARE_*`,
  `SMTP_*`, `S3_*`, `TURNSTILE_*`, `OAUTH_*`, `MAIL_FROM`, `EMAIL`, `AI`). `createCMS({ secrets })`
  takes a lookup; the application passes its bindings (`env[name]` when it is a string).
  `context.secrets.get(name)` returns the value or undefined. The policy lint requires a literal
  name that the manifest declares, and reports a use of `context.files`, `mail`, `jobs`, `users`,
  `cache` or `secrets` the manifest does not ask for.
- **Realtime is not a capability.** A plugin ships a realtime component of its own
  (`@Component({ transport: 'durable-object' })` in its files), as the CMS does for co-editing;
  plugin files are application source. Documented, not built.
- **Not built.** An AI provider (`plan-cms-feature-gaps.md` C7, its own spec); a payments provider
  (C4); mail quotas; a jobs screen (group B's jobs view lists outbox rows, plugin jobs among them).

## Order

1. `src/cron.ts` and its tests; manifest keys, problems and `requestedGrants`.
2. Host: `CmsOptions.secrets`, the capabilities module (`server/capabilities.ts`), the context
   members, `CmsSchedules` with schema step 22 and the maintenance tick, the `plugin.job` topic.
3. The policy lint, docs (`manifest.md`, `plugins.md`), the fixture plugin and the generated-app
   test, the live test.

## Done when

- A plugin declaring every capability is refused each one before its grant and served each one
  after; revoking it refuses them again.
- A job queued twice with one key runs once; a failing handler is retried and reported under the
  plugin's name; a schedule under a fake clock queues one occurrence per due minute and none
  twice when two hosts tick together.
- A plugin that names an undeclared secret, or uses `context.mail` without asking for it, fails
  `cossack plugins check`.
- The fixture plugin in a generated application queues a job from its command and the job's
  output reaches the diagnostics; its schedule row exists after the first maintenance.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| Declarations (2026-11-07) | `permissions.files|mail|jobs|cache|users|secrets`, `schedules`, `CAPABILITIES`, `requestedGrants` with `capability:<name>`, `users:<action>`, `secret:<NAME>`; `src/cron.ts` (`parseCron`, `nextCronTime`, `cronProblem`) on the framework's `validateScheduleCron` | `cron-unit.test.ts`, `capabilities-unit.test.ts` |
| Host | `CmsOptions.secrets`; `server/capabilities.ts` (`pluginCapabilities`: files as owner `plugin:<name>`, mail as the site, jobs on the outbox topic `plugin.job` and the internal action `cms.plugin.job` with one handler per plugin, members with assignable roles and `_p_<plugin>` meta, a `plugin:<name>:` cache namespace, declared secrets); `CmsSchedules` with `cms_schedules` (step 22) ticked from maintenance, skipped in exports; `Outbox.enqueue` with `availableAt` and `ignoreDuplicate` | `capabilities-unit.test.ts` (fakes), live `capabilities.test.ts` (grant and revoke, files, members, jobs with keys and retries, two hosts ticking one schedule, the missed-occurrence skip) |
| Tools and docs | Policy lint: a context member without its permission and a secret outside `permissions.secrets` fail `cossack plugins check` (`cachePurge` added to the point map); `manifest.md`, `plugins.md#capabilities`, `index.md`; the fixture plugin queues a job from its command and declares a schedule; the application passes `env` lookups as `secrets` | `plugin-policy.test.js`, `generated-runtime-cms-plugins.test.js` |
