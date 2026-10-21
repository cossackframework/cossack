# Forms: a block-based form builder with per-form submission tables

Builds on `specs/cms-essentials.md` (collections, comments, webhooks, outbox) and
`specs/cms-layout.md` (nested blocks). Status: implemented on branch `cms-foundation`, 2026-10-21. See [Outcome](#outcome).

A form is an entry of a built-in `forms` collection whose `body` is blocks: inputs are
block types, and the core containers lay them out. Every form stores its submissions in a
schemaless table of its own, typed from the form's inputs, so a form with 100k
submissions is one table with its own indexes, not rows in a shared table as in Gravity
Forms. The site and the API name a form by its slug (`/api/cms/forms/<slug>`); the table
is named by the form's ID, so renaming a form never moves data. Plugins extend forms the way Gravity Forms does: filters on validation, on the
data before it is stored, on the confirmation and on each notification, and an action
after the submission is committed.

## Decisions

### Model (client-safe, `packages/cms`)

- **Inputs are blocks.** A `BlockDeclaration` gains `input?: { kind: InputKind }`.
  `InputKind` is `string`, `text`, `email`, `url`, `phone`, `number`, `boolean`, `date`,
  `choice`, `choices`. A block with `input` collects one value named by its `name` data
  field; the host validates and stores it under that name. Input blocks go only inside a
  form: `validateBlocks` takes `{ allowed, form }` and rejects an input block at any
  depth unless `form` is set, which a blocks field sets with `form: true` (the forms
  collection's `body`). The block picker offers them there alone. Plugins ship input
  blocks like any block (`stripe/amount`), and they render through `ui.ts` as now.
- **Core input blocks**, category `form` (label "Form fields", after `widgets`):
  `form/text`, `form/email`, `form/url`, `form/phone`, `form/textarea`, `form/number`,
  `form/date`, `form/select`, `form/radio`, `form/checkbox` (one boolean),
  `form/checkboxes` (multiple choice), `form/consent` (a required checkbox with its own
  text), `form/hidden`. Every input declares `label`, `name` (`[a-z][a-zA-Z0-9]{0,39}`,
  a field name, filled from the label in camel case when empty, distinct within the
  form, not one of the submission's own names), `description` and `required`, through
  `inputFields()`, which plugins use too. Text kinds add `placeholder`, `defaultValue`,
  `minLength`, `maxLength` and (one-line text) `pattern`; number adds `min`, `max` and
  `step`; choice kinds take `options` (one per line, `value|Label` or just the label).
  Several choices from a list is `form/checkboxes`; a multi-select can come later. Submit
  is not a block: the form's settings hold the button label and it renders last.
- **Conditions are a block attribute.** `Block.when?: { action?: 'show' | 'hide';
  match?: 'all' | 'any'; rules: { field, op, value? }[] }`, validated by core beside
  `layout` and `style`, allowed only in a form, naming only the form's inputs. Operators: `is`, `isNot`, `contains`, `empty`, `notEmpty`, `gt`, `lt`,
  `in`. Any block in a form can carry one, so a paragraph or a whole group shows or
  hides; a hidden container hides its children. `formVisibility(blocks, types, values)`
  is the one evaluation (hidden inputs count as empty, so dependent conditions follow),
  used by the client script, by the server when it validates, and by the editor's
  preview. Hidden inputs are not required and their values are not stored.
- **The `forms` collection** is built in (`formsModule`), private, not publishable, no
  path: `title`; `slug` (derived from the title, unique, names the form on the site and
  in the API, free to change); `enabled` (boolean); `body` (blocks with `form: true`,
  up to 48 inputs); `settings` (a group: `submitLabel`, `confirmation` of `message` or
  `redirect`, `message` markdown, `redirectUrl`, `closedMessage`, `limit`, `opensAt`,
  `closesAt`, `requireSignIn`, `oncePerUser`, `oncePerEmail` naming an email input,
  `store` submissions on or off, `recordIp`, `turnstile` on or off); `notifications`
  (`{ rules: [...] }`, see below). Editors manage forms through `cms/forms:*`. Saving a
  form checks its settings and rules against its inputs.
- **Submissions are a resource per form, one table each.** `submissionResource(form,
  inputs)` builds `cms/form_<form id>` (the ID without hyphens), stored by the usual
  `storageName` in its own FastDB collection `r__cms__form_<form id>`, never in a shared
  submissions table. It sits in the host's `cms` namespace, so no plugin name can clash,
  and collection names starting with `form_` are refused. The host's migrate step
  creates the collection with its indexes and records the declaration hash, as it does
  for collections; FastDB's auto-create on insert is only the safety net behind the
  lazy hash check at submit time. Fields: one per input, typed from its `input.kind`
  (`choices` a list of strings, `number` a number, `boolean` a boolean, the rest text;
  text kinds searchable, up to 16), plus `status` (`new`, `read`, `spam`, `trash`,
  indexed with the time), `note`, and `meta`: `ip`, `userAgent`, `referrer`, `page` (the
  page the form was on), `locale`. The submitting user is `_owner`; `_createdAt` is the
  time. Revisions off. Access: read, update and delete by `cms:submissions`; create
  `none`, the host writes with `system:forms`. A new or changed input is an additive
  step, so saving a form never rewrites rows; a removed input keeps its stored values.
- **Validation is one pure function.** `validateSubmission(form, types, raw, options)`
  takes the posted strings, applies conditions, checks each visible input by its kind
  and its block data, and returns `{ values, errors }` keyed by input name. The site's
  client script and the host run the same function.
- **Notification rules.** `{ id, label, to, subject, body, replyTo?, when? }`, at most
  10 per form. `to`, `subject`, `body` and `replyTo` take merge tags: `{field:name}`,
  `{all_fields}`, `{form:title}`, `{submission:id}`, `{submission:url}`,
  `{user:email}`, `{site:title}`, `{site:url}`. A rule with `to: {field:email}` is the
  autoresponder. `when` is a condition like a block's. `renderMergeTags` is client-safe.

### Host

- **Registry.** `cms.forms` (`CmsForms`) loads a form by slug or ID and keeps its
  submission resource in step: it compares the declaration hash with `cms_schema_state`
  and migrates that one resource when they differ, then `cms.resource()` serves it.
  Submission resources stay out of `cms.resources`, so Tools → Schema and the content
  API's resource list do not grow with every form. A saved form is also synced from the
  outbox, and a deleted form's table is dropped there. Schemaless resources now rebuild
  an index whose definition changed (full-text search over a new text input) instead of
  blocking.
- **`cms.forms.submit(slug, raw, context)`.** Same-origin check by the route; then: the
  form is enabled and open (`opensAt`, `closesAt`, `limit` against the kept count), sign-in
  when required (`oncePerUser` implies it), the bot check through `context.botCheck` when
  the form asks for Turnstile, one submission per address and form every five seconds.
  The trap field and a `startedAt` under two seconds ago mark the submission `spam`: kept
  when the form keeps submissions, no hooks or notifications, answered like any other.
  Validation runs `validateSubmission`, then `cms.form.validate`, then
  `cms.form.before-submit` (checked again), then one per user or email. With `store` on,
  one batch writes the row, a `cms_form_sends` receipt (also the throttle and the
  reconciler's proof) and the outbox event; with it off, the receipt and the event alone,
  so notifications still run. The limit and the once rules count kept submissions only.
  The response is the confirmation after `cms.form.confirmation`; merge tags in a message
  are filled with the answers escaped for Markdown.
- **Extension points**, versioned like the existing ones and listed in `EXTENSION_POINTS`
  so plugin manifests can name them:
  - `cms.form.validate` filter: `(errors, { form, values, actor })`, 2 s.
  - `cms.form.before-submit` filter: `(values, { form, errors: none, actor })`, 2 s.
  - `cms.form.confirmation` filter: `(confirmation, { form, submission })`, 2 s.
  - `cms.form.notification` filter: `(message | null, { form, submission, rule })`, 2 s;
    null cancels.
  - `cms.form.submitted` action: `({ eventId, form, submission, values, actor, at })`,
    10 s, run from the outbox. The outbox row's topic is `form.submitted`; the
    dispatcher maps topics to points instead of assuming `after-commit`.
- **Notifications and webhooks** are the host's own `cms.form.submitted` handlers, so
  they retry with the outbox. Mail goes through `CmsOptions.mail` (`{ send(message) }`)
  and `mailFrom`, which the scaffold wires to the `EMAIL` binding; without it rules are
  skipped and logged once. `cms_form_mail` records each email by event, rule and
  address, so a retry sends only what failed. Webhooks gain the event `form.submitted`,
  sent to webhooks for all collections or for Forms, with the form and the submission.
- **Submission management** on `cms.forms`, with `cms:submissions`: `list` (new and read,
  or one status, newest first with a cursor; or a full-text search), `counts`,
  `newCounts` for the navigation, `submission`, `setStatus` (read, new, spam, trash),
  `delete`, `setNote`, and `csv`, which streams pages of 100 with the input labels as
  headers and quotes cells that would run as spreadsheet formulas. `maintain` empties
  trash older than 30 days and forgets old receipts, sent-mail records and post results.

### Site and API

- **Placing a form.** A `core/form` block (widgets, shipped by `formsModule`) with `form`
  naming a form by slug. Site pages give each one its `FormView` (`RenderedBlock.form`):
  the form's blocks rendered, each input block with its `InputView` (name, value, error,
  choices) and each conditional block with `shown`; the closed message, sign-in link or
  the returning post's notice; `_started`; the Turnstile key; input kinds for the script.
  Starting values are the inputs' defaults, hidden inputs from the page's query, then
  `cms.form.prefill`. Entries, the home page, previews, the site editor's draft view and widget
  areas place forms. A theme overrides `blocks['core/form']` or any
  input block, or wraps `formBlock` and `inputBlock` from `cms/form-view.ts`.
- **Rendering.** `coreBlock` renders `core/form` and `form/*` through `cms/form-view.ts`:
  label, control, help and error, plain HTML with `novalidate` that posts without
  JavaScript. A conditional block is wrapped in `data-cms-when`, marked `data-hidden` while
  hidden; `blocks.css` hides those only under `@media (scripting: enabled)`, so without
  JavaScript every field shows and the server applies the conditions. The trap field
  `_website` sits off screen.
- **Routes.** `POST /api/cms/forms/<slug>` accepts form data or JSON, same-origin only.
  A form post returns 303 to `_page` with `?form=<slug>&result=<key>#form-<slug>`, and the
  page shows the confirmation, or the errors with what was typed, from a one-time
  `cms_form_results` row (a refresh does not resubmit); a redirect confirmation goes to
  its page. With `Accept: application/json` the answer is `{ confirmation }` (a message as
  HTML, or a URL) or the usual error JSON with `fields`. `GET /api/cms/forms/<slug>`
  returns the form for headless sites; `GET /api/cms/forms/<slug>/submissions` lists for
  an application password or session with `cms:submissions`.
- **Client script.** `cms/form.client.ts`, loaded by the form's `ref` once a form is on
  the page: applies conditions as values change, shows `validateSubmission`'s messages
  as fields are left and on sending, posts the form data asking for JSON, then shows the
  confirmation in place or follows the redirect. It writes only into elements rendered
  empty and toggles attributes, so hydration markers stay intact.
- **Scaffold wiring.** `modules` include `formsModule`; `cmsFor` passes the `EMAIL`
  binding and `MAIL_FROM` as the host's mail; maintenance runs `cms.forms.maintain()`.

### Dashboard

- **Forms** in the content navigation after Comments, labelled with the new-submission
  count, for `cms/forms:*` or `cms:submissions`; the generic collection entry is left
  out. `/dashboard/forms` lists forms with their slug, fields, kept and new submissions,
  and whether they are accepting.
- **The form editor is the entry editor** at `/dashboard/content/forms/<id>`, with what a
  form needs: the block tree offers input blocks (other fields never do) and a
  conditional logic control on each block's General tab, listing the form's inputs; the
  slug shows with how to place the form; `notifications` is a list of emails (name,
  recipients, reply-to, subject, message, an optional condition) with a merge-tag list;
  a link opens the submissions. A separate screen would duplicate the editor's autosave,
  revisions and validation for no gain.
- **Submissions** at `/dashboard/forms/<id>/submissions`: tabs (all, unread, read, spam,
  trash) with counts, search, a table of the first four inputs and the time, bulk
  actions, cursor pages, Export CSV (`/api/cms/forms/<slug>/submissions/export`, UTF-8
  with a byte order mark). One submission at `.../submissions/<submission>` (the URL
  notification emails link to): every answer, the details, a note, status actions; opening
  a new one marks it read. Permission `cms:submissions`, granted to Editors by default.

### Out of scope now

File inputs (needs private media), multi-page forms, payments, saved partial entries,
per-field unique indexes chosen in the editor. Each fits the model later: a file input
is a block with `input.kind: 'file'`, a page break a container.

## Order

1. Model: `input` on declarations, `Block.when` and `visibleBlocks`, the core input
   blocks, `forms` collection, `submissionResource`, `validateSubmission`, merge tags,
   notification rules, hooks. Unit tests in `essentials-unit.test.ts` style.
2. Host: registry and storage sync, `submitForm`, outbox topics, mail option,
   notifications, webhooks, submissions management and export, maintenance. FastDB tests.
3. Site: `core/form`, input renderers, CSS, routes, result rows, client script.
4. Dashboard: navigation, form list and editor, submissions screen, CSV.
5. Generated-app test, README and `agent-docs.json`.

## Done when

- An editor creates a contact form with name, email, a subject select, a message and a
  "call me" checkbox that reveals a phone input, places it on a page with `core/form`,
  and the page submits with JavaScript off and on.
- A submission lands in the form's own table `r__cms__form_<id>` with the typed values, IP, user agent and
  status `new`; the dashboard shows it under Forms (1), marks it read and exports CSV.
- A filled honeypot stores `spam` and sends nothing; a submission past the form's
  `limit` gets the closed message.
- A notification rule emails the admin with merge tags filled and an autoresponder
  reaches the submitted email, both delivered from the outbox and not sent twice on
  a retry.
- A plugin registers `cms.form.validate` to reject a domain and `cms.form.submitted`
  to receive the event; its manifest names both points.
- Adding an input to a live form migrates the resource without touching rows, and the
  old submissions still list.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| Model (`packages/cms`) | `BlockDeclaration.input`, `INPUT_KINDS`, `Block.when` (`blockConditionProblem`), `validateBlocks(…, { allowed, form })` with names from labels (`inputName`), distinct and unreserved names and conditions on the form's inputs; `field.blocks` `form: true`; `FORM_BLOCKS`, `FORM_EMBED_BLOCK`, `inputFields`; `formInputs`, `ruleMatches`, `conditionShows`, `formVisibility`, `visibleBlocks`, `formDataValues`, `validateSubmission`, `displayValue`; the `forms` collection and `formsModule` with `FORM_SETTINGS` checks; `submissionResource` (`cms/form_<id>`); `notificationProblems`, `MERGE_TAGS`, `renderMergeTags`, `escapeMarkdown`; six form extension points; `cms:submissions` | `forms-unit.test.ts` |
| Host | `cms.forms` (`CmsForms`): per-form table sync and drop, `submit` (schedule, limit, sign-in, bot check, throttle, trap and fill time, validation hooks, once rules, one atomic batch), `closed`, `prefill`, notifications once per event, rule and address, `form.submitted` webhooks, `list`, `counts`, `inboxCounts`, `submission`, `setStatus`, `delete`, `setNote`, `csv`, `maintain`, post results; outbox topics; `CmsOptions.mail` and `mailFrom`; repository `insert` and time cursors; schemaless index rebuilds; host step 8 (`cms_form_sends`, `cms_form_mail`, `cms_form_results`); the `cms.forms.submit` reconciler | `forms.test.ts` against live FastDB; `schema.test.ts`, `unit.test.ts` |
| Site (scaffold) | `core/form` and `form/*` renderers (`cms/form-view.ts`), `FormView` and `InputView` from `cms/site-forms.ts`, `cms/form.client.ts`, `blocks.css` rules, `POST`/`GET /api/cms/forms/<slug>`, the submissions API and CSV export, forms on entries, the home page, previews and widget areas | `generated-runtime-cms-forms.test.js` on Node and Workers, and in Chromium |
| Dashboard (scaffold) | Forms navigation with the new count; `/dashboard/forms`; the submissions inbox and one submission; the entry editor's input picker, conditional logic control, notification list, slug line and submissions link; form icons | `generated-runtime-cms-forms.test.js` (HTTP and Chromium) |
| Plugins | Form hooks in manifests and the plugin policy lint (`EXTENSION_POINT_EXPORTS`); input blocks from plugins | `forms-unit.test.ts`, `plugin-policy.test.js` |
| Docs | `cms-forms` guide in `agent-docs.json`; README data contract | `fastdb-cms-guide-coverage.test.js` |

Left for later: a multi-select dropdown, and a drag-and-drop form canvas beyond the block
tree.
